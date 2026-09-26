import { useEffect } from "react";
import { startRingtone } from "../call/ringtone";
import { Avatar } from "./Avatar";
import { StatusBar } from "./StatusBar";

interface IncomingCallProps {
  name: string;
  onAccept: () => void;
  onDecline: () => void;
}

export function IncomingCall({ name, onAccept, onDecline }: IncomingCallProps) {
  useEffect(() => startRingtone(), []);
  return (
    <div className="slide-up absolute inset-0 z-30 flex flex-col bg-gradient-to-b from-[#2b3a55] via-[#1c2233] to-[#0d0f16] text-white" role="dialog" aria-label={`Incoming call from ${name}`}>
      <StatusBar dark />
      <div className="mt-16 flex flex-col items-center">
        <Avatar name={name} size={96} />
        <p className="mt-4 text-[32px] font-light tracking-tight">{name}</p>
        <p className="mt-1 text-[15px] text-white/60">Persona Audio…</p>
      </div>
      <div className="mt-auto mb-20 flex justify-around px-10">
        <div className="flex flex-col items-center gap-2">
          <button type="button" onClick={onDecline} aria-label="Decline" className="grid size-[72px] place-items-center rounded-full bg-ios-red transition active:scale-95">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="white" style={{ transform: "rotate(135deg)" }}><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" /></svg>
          </button>
          <span className="text-[13px]">Decline</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <button type="button" onClick={onAccept} aria-label="Accept" className="ring-pulse grid size-[72px] place-items-center rounded-full bg-ios-green transition active:scale-95">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="white"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" /></svg>
          </button>
          <span className="text-[13px]">Accept</span>
        </div>
      </div>
    </div>
  );
}
