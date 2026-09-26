import { useEffect, useRef, useState } from "react";
import { formatClock } from "../lib/copy";
import { Avatar } from "./Avatar";
import { StatusBar } from "./StatusBar";

interface ActiveCallProps {
  name: string;
  since: number | null;
  caption: { speaker: "user" | "assistant"; text: string } | null;
  level: () => number;
  onMute: (muted: boolean) => void;
  onSpeaker: (loud: boolean) => void;
  onMinimize: () => void;
  onHangup: () => void;
}

function useTicker(since: number | null): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  return since === null ? "connecting…" : formatClock(now - since);
}

function Bars({ level }: { level: () => number }) {
  const refs = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const l = level();
      refs.current.forEach((el, i) => {
        if (el) el.style.transform = `scaleY(${0.15 + l * (0.6 + 0.4 * Math.sin(Date.now() / 120 + i))})`;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [level]);
  return (
    <div className="flex h-10 items-center gap-1" aria-hidden>
      {Array.from({ length: 7 }, (_, i) => (
        <span key={i} ref={(el) => void (refs.current[i] = el)} className="h-full w-1.5 origin-center rounded-full bg-white/80 transition-transform duration-75" />
      ))}
    </div>
  );
}

function Control({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button type="button" aria-label={label} aria-pressed={active} onClick={onClick} className={`grid size-[68px] place-items-center rounded-full transition active:scale-95 ${active ? "bg-white text-black" : "bg-white/15 text-white"}`}>
        {children}
      </button>
      <span className="text-[12px] text-white/80">{label}</span>
    </div>
  );
}

export function ActiveCall({ name, since, caption, level, onMute, onSpeaker, onMinimize, onHangup }: ActiveCallProps) {
  const [muted, setMuted] = useState(false);
  const [loud, setLoud] = useState(true);
  const timer = useTicker(since);
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-gradient-to-b from-[#3b4a66] via-[#1f2638] to-[#0d0f16] text-white" role="dialog" aria-label={`Call with ${name}`}>
      <StatusBar dark />
      <div className="mt-10 flex flex-col items-center">
        <Avatar name={name} size={80} />
        <p className="mt-3 text-[28px] font-light">{name}</p>
        <p className="mt-0.5 text-[15px] tabular-nums text-white/60">{timer}</p>
        <div className="mt-5">
          <Bars level={level} />
        </div>
      </div>
      <div className="mx-6 mt-6 min-h-24 text-center" aria-live="polite">
        {caption && (
          <p className="text-[16px] leading-snug text-white/90">
            <span className="text-white/50">{caption.speaker === "user" ? "You: " : ""}</span>
            {caption.text}
          </p>
        )}
      </div>
      <div className="mt-auto mb-14 grid grid-cols-3 gap-y-6 px-10">
        <Control label="mute" active={muted} onClick={() => { setMuted(!muted); onMute(!muted); }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />{muted && <path d="M3 3l18 18" />}</svg>
        </Control>
        <Control label="speaker" active={loud} onClick={() => { setLoud(!loud); onSpeaker(!loud); }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /></svg>
        </Control>
        <Control label="messages" onClick={onMinimize}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3C6.5 3 2 6.6 2 11c0 2.4 1.3 4.6 3.4 6.1L4.5 21l4.2-2.2c1 .3 2.1.4 3.3.4 5.5 0 10-3.6 10-8s-4.5-8.2-10-8.2z" /></svg>
        </Control>
        <div className="col-start-2 flex flex-col items-center gap-1.5">
          <button type="button" aria-label="End call" onClick={onHangup} className="grid size-[68px] place-items-center rounded-full bg-ios-red transition active:scale-95">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="white" style={{ transform: "rotate(135deg)" }}><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" /></svg>
          </button>
          <span className="text-[12px] text-white/80">end</span>
        </div>
      </div>
    </div>
  );
}
