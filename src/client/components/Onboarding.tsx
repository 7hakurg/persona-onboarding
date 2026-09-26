import { useCallback, useEffect, useRef, useState } from "react";
import { LiveCall, type ClientEndReason } from "../call/live-call";
import { ERROR_COPY } from "../lib/copy";
import { agentDisplayName } from "../lib/derive";
import { useSession } from "../session/useSession";
import { ActiveCall } from "./ActiveCall";
import { BehindTheScenes } from "./BehindTheScenes";
import { HomeScreen } from "./HomeScreen";
import { InCallPill } from "./InCallPill";
import { IncomingCall } from "./IncomingCall";
import { MessagesScreen } from "./MessagesScreen";
import { PhoneFrame } from "./PhoneFrame";
import { Toast } from "./Toast";

type Caption = { speaker: "user" | "assistant"; text: string } | null;

const GMAIL_POPUP = "width=520,height=680";

function useGmailPopupMessages(onStatus: (status: string) => void): void {
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin) return;
      const data = e.data as { type?: string; status?: string } | null;
      if (data?.type === "persona-gmail" && typeof data.status === "string") onStatus(data.status);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onStatus]);
}

export function Onboarding({ gmailEnabled }: { gmailEnabled: boolean }) {
  const session = useSession();
  const { state } = session;
  const [toast, setToast] = useState<string | null>(null);
  const [view, setView] = useState<"chat" | "home">("chat");
  const [minimized, setMinimized] = useState(false);
  const [caption, setCaption] = useState<Caption>(null);
  const callRef = useRef<LiveCall | null>(null);
  const graduated = state?.graduatedAt != null;
  const callStatus = state?.call.status ?? "idle";

  useEffect(() => {
    if (graduated) setView("home");
  }, [graduated]);

  // Server is the authority: if it ended the call, tear down local media.
  useEffect(() => {
    if (callStatus !== "connecting" && callStatus !== "active" && callRef.current) {
      callRef.current.dispose();
      callRef.current = null;
      setCaption(null);
      setMinimized(false);
    }
  }, [callStatus]);

  useEffect(() => {
    const onPageHide = () => {
      if (callRef.current) navigator.sendBeacon("/api/call-ended");
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  const onGmailStatus = useCallback((status: string) => {
    if (status === "error") setToast("Gmail couldn't connect — try the button again.");
  }, []);
  useGmailPopupMessages(onGmailStatus);

  const send = useCallback(
    async (text: string) => {
      const res = await session.sendMessage(text);
      if (!res.ok) setToast(ERROR_COPY[res.error]);
      return res.ok;
    },
    [session],
  );

  const requestCall = async () => {
    const res = await session.requestCall();
    if (!res.ok && res.error !== "unavailable") setToast(ERROR_COPY[res.error]);
  };

  const accept = () => {
    const call = new LiveCall({
      exchange: (sdp) => session.acceptCall(sdp),
      onFailure: (reason: ClientEndReason) => void session.endCall(reason),
      onCaption: (speaker, text) => setCaption({ speaker, text }),
      onConnected: () => undefined,
    });
    callRef.current = call;
    setMinimized(false);
    void call.start();
  };

  const hangup = () => {
    callRef.current?.hangup();
    callRef.current = null;
    void session.endCall("user_hangup");
  };

  const connectGmail = () => {
    const popup = window.open("/auth/google/start", "persona-gmail", GMAIL_POPUP);
    if (!popup) location.href = "/auth/google/start";
  };

  const reset = async () => {
    callRef.current?.dispose();
    await fetch("/api/reset", { method: "POST" });
    location.reload();
  };

  const name = agentDisplayName(state);
  const since = state?.call.status === "active" ? state.call.since : null;
  const inCall = callStatus === "connecting" || callStatus === "active";

  return (
    <main className="flex min-h-dvh items-center justify-center gap-8 sm:p-6">
      <PhoneFrame>
        {!state ? (
          <p className="m-auto text-[15px] text-neutral-500" role="status">
            Connecting…
          </p>
        ) : view === "home" && graduated ? (
          <HomeScreen state={state} gmailEnabled={gmailEnabled} onConnectGmail={connectGmail} onOpenChat={() => setView("chat")} />
        ) : (
          <MessagesScreen
            state={state}
            reconnecting={session.status === "reconnecting"}
            gmailEnabled={gmailEnabled}
            onSend={send}
            onCall={() => void requestCall()}
            onConnectGmail={connectGmail}
            {...(graduated ? { onBack: () => setView("home") } : {})}
          />
        )}
        {callStatus === "ringing" && <IncomingCall name={name} onAccept={accept} onDecline={() => void session.declineCall()} />}
        {inCall && !minimized && (
          <ActiveCall
            name={name}
            since={since}
            caption={caption}
            level={() => callRef.current?.level() ?? 0}
            onMute={(m) => callRef.current?.setMuted(m)}
            onSpeaker={(l) => callRef.current?.setSpeaker(l)}
            onMinimize={() => setMinimized(true)}
            onHangup={hangup}
          />
        )}
        {inCall && minimized && <InCallPill since={since} onOpen={() => setMinimized(false)} />}
        <Toast message={toast} onDone={() => setToast(null)} />
      </PhoneFrame>
      <BehindTheScenes state={state} onReset={() => void reset()} />
    </main>
  );
}
