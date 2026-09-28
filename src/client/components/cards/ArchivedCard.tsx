import { useState } from "react";
import type { CardData } from "../../../shared/types";

type Archived = Extract<CardData, { card: "archived" }>;

export function ArchivedCard({ data, onUndo }: { data: Archived; onUndo: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="mx-auto flex w-[86%] items-center justify-between rounded-2xl bg-ios-grouped px-3.5 py-2.5 text-[13.5px]">
      <span>
        {data.undone ? "Restored" : "Archived"} {data.count} thread{data.count === 1 ? "" : "s"}
      </span>
      {!data.undone && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onUndo().finally(() => setBusy(false));
          }}
          className="font-semibold text-imessage disabled:opacity-50"
        >
          {busy ? "Undoing…" : "Undo"}
        </button>
      )}
    </div>
  );
}
