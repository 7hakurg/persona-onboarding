import type { SessionState, Slot } from "../../shared/types";
import { missingSlots, phaseOf } from "../../shared/selectors";
import { formatTime } from "../lib/copy";

interface BehindTheScenesProps {
  state: SessionState | null;
  onReset: () => void;
}

function slotLine(slot: Slot<string>): string {
  switch (slot.status) {
    case "filled":
      return `✓ ${slot.value} (${slot.source})`;
    case "defaulted":
      return `✓ ${slot.value} (default)`;
    case "pending_confirmation":
      return `? ${slot.value} (confirming)`;
    case "parked":
      return `— parked after ${slot.attempts} tries`;
    default:
      return "…";
  }
}

export function BehindTheScenes({ state, onReset }: BehindTheScenesProps) {
  if (!state) return null;
  const rows: [string, string][] = [
    ["Phase", phaseOf(state)],
    ["Agent name", slotLine(state.slots.agentName)],
    ["User name", slotLine(state.slots.userName)],
    ["Help goal", slotLine(state.slots.helpGoal)],
    ["Gmail", state.gmail.status],
    ["Call", state.call.status === "ended" ? `ended · ${state.call.reason}` : state.call.status],
    ["Call attempts", String(state.callAttempts)],
    ["Still missing", missingSlots(state).join(", ") || "nothing"],
  ];
  return (
    <aside className="hidden h-[min(844px,calc(100dvh-48px))] w-[340px] flex-col rounded-3xl bg-white/70 p-5 shadow-sm ring-1 ring-black/5 backdrop-blur lg:flex" aria-label="Behind the scenes">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Behind the scenes</h2>
        <button type="button" onClick={onReset} className="rounded-full border border-neutral-300 px-3 py-1 text-[12.5px] font-medium hover:bg-white">
          Start over
        </button>
      </div>
      <p className="mt-1 text-[12.5px] leading-snug text-neutral-500">Live session state. Try to break it: hang up mid-call, refuse to answer, skip ahead, refresh.</p>
      <dl className="mt-4 space-y-1.5 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-neutral-500">{k}</dt>
            <dd className="truncate text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <h3 className="mb-1.5 mt-5 text-[12px] font-semibold uppercase tracking-wide text-neutral-500">Event log</h3>
      <ol className="no-scrollbar flex-1 space-y-1 overflow-y-auto font-mono text-[11.5px] leading-snug text-neutral-700">
        {[...state.events].reverse().map((e, i) => (
          <li key={`${e.at}-${i}`}>
            <span className="text-neutral-400">{formatTime(e.at)}</span> {e.type} <span className="text-neutral-500">{e.detail}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
