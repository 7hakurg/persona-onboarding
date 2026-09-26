/** Soft two-tone ring using WebAudio; silently does nothing if audio is blocked. */
export function startRingtone(): () => void {
  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContext();
  } catch {
    return () => undefined;
  }
  const audio = ctx;
  let stopped = false;
  const ring = () => {
    if (stopped) return;
    const now = audio.currentTime;
    for (const [i, freq] of [440, 480].entries()) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.06, now + 0.05 + i * 0.01);
      gain.gain.setValueAtTime(0.06, now + 1.2);
      gain.gain.linearRampToValueAtTime(0, now + 1.3);
      osc.connect(gain).connect(audio.destination);
      osc.start(now);
      osc.stop(now + 1.35);
    }
    navigator.vibrate?.([400, 200, 400]);
  };
  void audio.resume().catch(() => undefined);
  ring();
  const id = setInterval(ring, 3000);
  return () => {
    stopped = true;
    clearInterval(id);
    void audio.close().catch(() => undefined);
  };
}
