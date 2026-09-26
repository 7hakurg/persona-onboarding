import { useState } from "react";
import type { CallEndReason, CardData } from "../../../shared/types";
import { formatClock } from "../../lib/copy";

type Call = Extract<CardData, { card: "call" }>;

const LABEL: Record<CallEndReason, string> = {
  completed: "Call ended",
  user_hangup: "Call ended",
  declined: "Declined call",
  no_answer: "Missed call",
  mic_denied: "Call couldn't start — mic blocked",
  connection_failed: "Call failed",
  dropped: "Call dropped",
  max_duration: "Call ended — time limit",
  page_closed: "Call ended",
  moderated: "Call ended",
  budget_exhausted: "Calls unavailable",
};

export function CallCard({ data }: { data: Call }) {
  const [open, setOpen] = useState(false);
  const missed = data.outcome === "no_answer" || data.outcome === "declined";
  return (
    <div className="mx-auto w-[86%] rounded-2xl bg-ios-grouped px-3.5 py-2.5 text-[13.5px]">
      <div className="flex items-center gap-2">
        <span className={`grid size-7 place-items-center rounded-full ${missed ? "bg-ios-red/15 text-ios-red" : "bg-ios-green/15 text-ios-green"}`} aria-hidden>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" /></svg>
        </span>
        <span className="font-semibold">{LABEL[data.outcome]}</span>
        {data.durationMs > 0 && <span className="text-neutral-500">· {formatClock(data.durationMs)}</span>}
        {data.transcript.length > 0 && (
          <button type="button" className="ml-auto text-imessage" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "Hide" : "Transcript"}
          </button>
        )}
      </div>
      {open && (
        <ol className="mt-2 max-h-56 space-y-1.5 overflow-y-auto border-t border-neutral-200 pt-2">
          {data.transcript.map((line, i) => (
            <li key={i}>
              <span className="font-semibold">{line.speaker === "user" ? "You" : "Assistant"}: </span>
              {line.text}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
