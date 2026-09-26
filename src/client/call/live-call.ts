import type { AcceptCallResult } from "../../shared/rpc";

export type ClientEndReason = "user_hangup" | "mic_denied" | "connection_failed";

export interface LiveCallOptions {
  exchange: (sdp: string) => Promise<AcceptCallResult>;
  onFailure: (reason: ClientEndReason) => void;
  onCaption: (speaker: "user" | "assistant", text: string) => void;
  onConnected: () => void;
}

const ICE_TIMEOUT_MS = 5_000;
const DISCONNECT_GRACE_MS = 6_000;
const MAX_CAPTION_CHARS = 180;

/** Browser side of a GPT-Live WebRTC call. The server owns the session; this only moves audio and shows captions. */
export class LiveCall {
  private pc: RTCPeerConnection | null = null;
  private mic: MediaStream | null = null;
  private readonly audio: HTMLAudioElement;
  private analyser: AnalyserNode | null = null;
  private audioCtx: AudioContext | null = null;
  private disposed = false;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private captions = { user: "", assistant: "" };
  private dc: RTCDataChannel | null = null;

  /** Must be constructed synchronously inside the Accept click so audio playback is unlocked. */
  constructor(private readonly opts: LiveCallOptions) {
    this.audio = new Audio();
    this.audio.autoplay = true;
    void this.audio.play().catch(() => undefined);
    try {
      this.audioCtx = new AudioContext();
    } catch {
      this.audioCtx = null;
    }
  }

  async start(): Promise<void> {
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      this.fail("mic_denied");
      return;
    }
    if (this.disposed) return this.dispose();
    try {
      await this.connect();
    } catch {
      this.fail("connection_failed");
    }
  }

  setMuted(muted: boolean): void {
    this.mic?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  setSpeaker(loud: boolean): void {
    this.audio.volume = loud ? 1 : 0.55;
  }

  /** 0..1 output level for the waveform. */
  level(): number {
    if (!this.analyser) return 0;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    let sum = 0;
    for (const v of data) sum += v;
    return Math.min(1, sum / data.length / 110);
  }

  /** Politely ask the session to close, then tear down locally. */
  hangup(): void {
    try {
      if (this.dc?.readyState === "open") this.dc.send(JSON.stringify({ type: "session.close" }));
    } catch {
      // channel already gone
    }
    setTimeout(() => this.dispose(), 400);
  }

  dispose(): void {
    if (this.disposed && !this.pc) return;
    this.disposed = true;
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
    this.mic?.getTracks().forEach((t) => t.stop());
    this.dc?.close();
    this.pc?.close();
    this.pc = null;
    this.audio.srcObject = null;
    void this.audioCtx?.close().catch(() => undefined);
  }

  private async connect(): Promise<void> {
    const pc = new RTCPeerConnection();
    this.pc = pc;
    pc.addEventListener("track", (e) => this.attachRemote(e.streams[0] ?? new MediaStream([e.track])));
    for (const track of this.mic!.getAudioTracks()) pc.addTrack(track, this.mic!);
    this.dc = pc.createDataChannel("oai-events");
    this.dc.addEventListener("message", (e) => this.onEvent(String(e.data)));
    pc.addEventListener("connectionstatechange", () => this.onConnectionState(pc.connectionState));
    await pc.setLocalDescription(await pc.createOffer());
    await this.gatherIce(pc);
    const sdp = pc.localDescription?.sdp;
    if (!sdp) throw new Error("No local SDP");
    const res = await this.opts.exchange(sdp);
    if (this.disposed) return;
    if (!res.ok) {
      // The server already ended the call and will follow up in chat.
      this.dispose();
      return;
    }
    await pc.setRemoteDescription({ type: "answer", sdp: res.answerSdp });
  }

  private gatherIce(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        pc.removeEventListener("icegatheringstatechange", check);
        clearTimeout(timer);
        resolve();
      };
      const check = () => pc.iceGatheringState === "complete" && done();
      const timer = setTimeout(done, ICE_TIMEOUT_MS);
      pc.addEventListener("icegatheringstatechange", check);
    });
  }

  private attachRemote(stream: MediaStream): void {
    this.audio.srcObject = stream;
    void this.audio.play().catch(() => undefined);
    if (this.audioCtx) {
      void this.audioCtx.resume().catch(() => undefined);
      const source = this.audioCtx.createMediaStreamSource(stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 64;
      source.connect(this.analyser);
    }
  }

  private onConnectionState(state: RTCPeerConnectionState): void {
    if (this.disposed) return;
    if (state === "connected") {
      if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
      this.opts.onConnected();
    } else if (state === "failed") {
      this.fail("connection_failed");
    } else if (state === "disconnected" && !this.disconnectTimer) {
      this.disconnectTimer = setTimeout(() => this.fail("connection_failed"), DISCONNECT_GRACE_MS);
    }
  }

  private onEvent(data: string): void {
    let event: { type?: string; delta?: unknown };
    try {
      event = JSON.parse(data) as { type?: string; delta?: unknown };
    } catch {
      return;
    }
    if (event.type === "session.closed") return this.dispose();
    const speaker = event.type === "session.input_transcript.delta" ? "user" : event.type === "session.output_transcript.delta" ? "assistant" : null;
    if (!speaker || typeof event.delta !== "string") return;
    const other = speaker === "user" ? "assistant" : "user";
    const prev = this.captions[speaker];
    const joined = prev && !/^\s/.test(event.delta) && !/^[.,!?]/.test(event.delta) ? `${prev} ${event.delta}` : prev + event.delta;
    this.captions = { ...this.captions, [speaker]: joined.slice(-MAX_CAPTION_CHARS), [other]: "" };
    this.opts.onCaption(speaker, this.captions[speaker].trim());
  }

  private fail(reason: ClientEndReason): void {
    if (this.disposed) return;
    this.dispose();
    this.opts.onFailure(reason);
  }
}
