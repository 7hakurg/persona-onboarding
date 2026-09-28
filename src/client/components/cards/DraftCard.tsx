import { useState } from "react";
import type { CardData } from "../../../shared/types";

type Draft = Extract<CardData, { card: "draft" }>;

export function DraftCard({ data }: { data: Draft }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="w-[88%] rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-black/5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Draft · not sent</p>
      <p className="mt-1 truncate text-[13.5px]">
        <span className="text-neutral-500">To </span>
        {data.to}
      </p>
      <p className="truncate text-[13.5px] font-semibold">{data.subject}</p>
      <p className={`mt-1.5 whitespace-pre-wrap text-[14px] leading-snug ${open ? "" : "line-clamp-4"}`}>{data.body}</p>
      <div className="mt-2 flex items-center justify-between text-[13px] font-semibold text-imessage">
        <button type="button" onClick={() => setOpen((o) => !o)}>{open ? "Show less" : "Show all"}</button>
        <a href={data.gmailUrl} target="_blank" rel="noopener noreferrer">Review in Gmail ↗</a>
      </div>
    </div>
  );
}
