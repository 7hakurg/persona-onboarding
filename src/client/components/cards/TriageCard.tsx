import { useState } from "react";
import type { TriageItem } from "../../../shared/types";

export interface GmailActions {
  draft: (threadId: string) => Promise<void>;
  archive: (threadIds: string[]) => Promise<void>;
  undoArchive: (messageId: string) => Promise<void>;
}

interface TriageCardProps {
  items: TriageItem[];
  archivedIds: ReadonlySet<string>;
  actions: GmailActions;
}

const URGENCY: Record<TriageItem["urgency"], string> = { high: "bg-ios-red", medium: "bg-amber-400", low: "bg-neutral-300" };

export function TriageCard({ items, archivedIds, actions }: TriageCardProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };
  const open = items.filter((i) => !archivedIds.has(i.threadId));
  const archivable = open.filter((i) => i.action === "archive").map((i) => i.threadId);
  return (
    <div className="w-[88%] overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
      <p className="border-b border-neutral-100 px-3.5 py-2.5 text-[13px] font-semibold">What needs you</p>
      <ul className="divide-y divide-neutral-100">
        {items.map((item) => {
          const archived = archivedIds.has(item.threadId);
          return (
            <li key={item.threadId} className={`px-3.5 py-2.5 ${archived ? "opacity-40" : ""}`}>
              <div className="flex items-center gap-2">
                <span className={`size-2 shrink-0 rounded-full ${URGENCY[item.urgency]}`} aria-label={`${item.urgency} urgency`} />
                <p className="truncate text-[13.5px] font-semibold">{item.from}</p>
                <p className="truncate text-[12.5px] text-neutral-500">· {item.subject}</p>
              </div>
              <p className="mt-0.5 text-[13.5px] leading-snug">{item.summary}</p>
              {!archived && (
                <div className="mt-1.5 flex gap-3 text-[13px] font-semibold text-imessage">
                  <button type="button" disabled={busy !== null} onClick={() => void run(`d:${item.threadId}`, () => actions.draft(item.threadId))} className="disabled:opacity-50">
                    {busy === `d:${item.threadId}` ? "Drafting…" : "Draft reply"}
                  </button>
                  <button type="button" disabled={busy !== null} onClick={() => void run(`a:${item.threadId}`, () => actions.archive([item.threadId]))} className="disabled:opacity-50">
                    {busy === `a:${item.threadId}` ? "Archiving…" : "Archive"}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {archivable.length > 1 && (
        <button type="button" disabled={busy !== null} onClick={() => void run("all", () => actions.archive(archivable))} className="w-full border-t border-neutral-100 py-2.5 text-[13.5px] font-semibold text-imessage disabled:opacity-50">
          Archive the {archivable.length} low-priority ones
        </button>
      )}
    </div>
  );
}
