import type { SessionState } from "../../shared/types";
import { agentDisplayName, slotText } from "../lib/derive";
import { Avatar } from "./Avatar";
import { InsightCard } from "./cards/InsightCard";
import { StatusBar } from "./StatusBar";

interface HomeScreenProps {
  state: SessionState;
  onOpenChat: () => void;
  onConnectGmail: () => void;
  gmailEnabled: boolean;
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function HomeScreen({ state, onOpenChat, onConnectGmail, gmailEnabled }: HomeScreenProps) {
  const agent = agentDisplayName(state);
  const user = slotText(state.slots.userName)?.replace(/\?$/, "");
  const goal = slotText(state.slots.helpGoal);
  const gmail = state.gmail;
  const facts: [string, string][] = [
    ["Your name", user ?? "Not shared yet"],
    ["Helping with", goal ?? "Tell me anytime"],
    ["Gmail", gmail.status === "connected" || gmail.status === "connected_limited" ? gmail.email : "Not connected"],
  ];
  return (
    <div className="flex h-full flex-col bg-ios-grouped">
      <StatusBar />
      <div className="no-scrollbar flex-1 overflow-y-auto px-5 pb-6 pt-4">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-neutral-500">{greeting()}</p>
        <h1 className="mt-0.5 text-[30px] font-bold leading-tight tracking-tight">{user ? `Hi, ${user}` : "Welcome in"} 👋</h1>
        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-white p-3.5 shadow-sm">
          <Avatar name={agent} size={44} />
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-semibold">{agent}</p>
            <p className="text-[13px] text-neutral-500">Your assistant · online</p>
          </div>
          <button type="button" onClick={onOpenChat} className="rounded-full bg-imessage px-4 py-2 text-[14px] font-semibold text-white">
            Message
          </button>
        </div>
        {gmail.status === "connected" && (
          <div className="mt-4 [&>div]:w-full">
            <InsightCard data={{ card: "insight", email: gmail.email, unreadCount: gmail.snapshot.unreadCount, topSenders: gmail.snapshot.topSenders, insight: gmail.insight }} />
          </div>
        )}
        <h2 className="mb-1.5 mt-6 px-1 text-[13px] font-semibold uppercase tracking-wide text-neutral-500">What {agent} knows</h2>
        <dl className="divide-y divide-neutral-100 rounded-2xl bg-white shadow-sm">
          {facts.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-4 px-4 py-3 text-[15px]">
              <dt className="text-neutral-500">{k}</dt>
              <dd className="truncate text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        {gmail.status !== "connected" && gmail.status !== "connected_limited" && gmailEnabled && (
          <button type="button" onClick={onConnectGmail} className="mt-4 w-full rounded-2xl bg-white py-3 text-[15px] font-semibold text-imessage shadow-sm">
            Connect Gmail
          </button>
        )}
      </div>
    </div>
  );
}
