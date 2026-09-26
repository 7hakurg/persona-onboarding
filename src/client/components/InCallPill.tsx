import { useEffect, useState } from "react";
import { formatClock } from "../lib/copy";

export function InCallPill({ since, onOpen }: { since: number | null; onOpen: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <button type="button" onClick={onOpen} className="pop-in absolute left-1/2 top-2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full bg-ios-green px-4 py-1.5 text-[13px] font-semibold text-white shadow-lg sm:top-11">
      <span className="size-2 animate-pulse rounded-full bg-white" />
      Return to call {since !== null && <span className="tabular-nums">{formatClock(now - since)}</span>}
    </button>
  );
}
