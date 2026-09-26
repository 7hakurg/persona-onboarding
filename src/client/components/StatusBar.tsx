import { useEffect, useState } from "react";

interface StatusBarProps {
  dark?: boolean;
}

export function StatusBar({ dark = false }: StatusBarProps) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  const time = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/i, "");
  return (
    <div className={`hidden h-12 shrink-0 items-end justify-between px-8 pb-1.5 text-[15px] font-semibold sm:flex ${dark ? "text-white" : "text-black"}`} aria-hidden>
      <span>{time}</span>
      <span className="flex items-center gap-1.5">
        <svg width="18" height="11" viewBox="0 0 18 11" fill="currentColor"><rect x="0" y="7" width="3" height="4" rx="1" /><rect x="5" y="5" width="3" height="6" rx="1" /><rect x="10" y="2.5" width="3" height="8.5" rx="1" /><rect x="15" y="0" width="3" height="11" rx="1" /></svg>
        <svg width="25" height="12" viewBox="0 0 25 12" fill="none"><rect x="0.5" y="0.5" width="21" height="11" rx="3.5" stroke="currentColor" opacity="0.4" /><rect x="2" y="2" width="16" height="8" rx="2" fill="currentColor" /><rect x="23" y="4" width="1.5" height="4" rx="0.75" fill="currentColor" opacity="0.4" /></svg>
      </span>
    </div>
  );
}
