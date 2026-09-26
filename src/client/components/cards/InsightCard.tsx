import type { CardData } from "../../../shared/types";

type Insight = Extract<CardData, { card: "insight" }>;

export function InsightCard({ data }: { data: Insight }) {
  return (
    <div className="w-[82%] rounded-2xl bg-gradient-to-br from-[#eef4ff] to-[#f6efff] p-3.5 shadow-sm ring-1 ring-black/5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-imessage">Inbox · {data.email}</p>
      <p className="mt-1 text-[28px] font-bold leading-none tracking-tight">
        {data.unreadCount}
        <span className="ml-1.5 text-[13px] font-medium text-neutral-500">unread this week</span>
      </p>
      {data.topSenders.length > 0 && (
        <ul className="mt-2.5 space-y-1">
          {data.topSenders.map((s) => (
            <li key={s.name} className="flex justify-between text-[13px]">
              <span className="truncate pr-2">{s.name}</span>
              <span className="tabular-nums text-neutral-500">{s.count}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2.5 text-[14.5px] leading-snug">{data.insight}</p>
    </div>
  );
}
