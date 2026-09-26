import { useEffect, useRef } from "react";
import type { ChatMessage, GmailState } from "../../shared/types";
import { formatTime } from "../lib/copy";
import { CallCard } from "./cards/CallCard";
import { GmailCard } from "./cards/GmailCard";
import { InsightCard } from "./cards/InsightCard";

interface MessageListProps {
  messages: ChatMessage[];
  typing: boolean;
  gmail: GmailState;
  gmailEnabled: boolean;
  onConnectGmail: () => void;
}

const GAP_FOR_TIMESTAMP_MS = 10 * 60_000;

function Card({ m, gmail, gmailEnabled, onConnectGmail }: { m: ChatMessage } & Omit<MessageListProps, "messages" | "typing">) {
  switch (m.data?.card) {
    case "gmail":
      return <GmailCard gmail={gmail} enabled={gmailEnabled} onConnect={onConnectGmail} />;
    case "insight":
      return <InsightCard data={m.data} />;
    case "call":
      return <CallCard data={m.data} />;
    default:
      return null;
  }
}

export function MessageList({ messages, typing, gmail, gmailEnabled, onConnectGmail }: MessageListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  useEffect(() => {
    // Scroll only the list itself; scrollIntoView would also scroll the phone frame.
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: mounted.current ? "smooth" : "auto" });
    mounted.current = true;
  }, [messages.length, typing]);

  return (
    <div ref={listRef} className="no-scrollbar flex-1 overflow-y-auto px-4 pb-2 pt-3" role="log" aria-live="polite" aria-label="Conversation">
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const next = messages[i + 1];
        const showTime = !prev || m.at - prev.at > GAP_FOR_TIMESTAMP_MS;
        const out = m.role === "user";
        const tail = !next || next.role !== m.role || next.kind !== "text";
        return (
          <div key={m.id} className="pop-in">
            {showTime && <p className="my-2.5 text-center text-[11px] font-medium text-neutral-400">{formatTime(m.at)}</p>}
            <div className={`flex ${out ? "justify-end" : "justify-start"} ${tail ? "mb-2" : "mb-0.5"}`}>
              {m.kind === "card" ? (
                <div className="flex w-full flex-col items-start gap-1.5">
                  {m.text && m.data?.card !== "insight" && m.data?.card !== "call" && <div className="bubble bubble-in">{m.text}</div>}
                  <Card m={m} gmail={gmail} gmailEnabled={gmailEnabled} onConnectGmail={onConnectGmail} />
                </div>
              ) : (
                <div className={`bubble ${out ? "bubble-out" : "bubble-in"} ${tail ? (out ? "tail-out" : "tail-in") : ""}`}>{m.text}</div>
              )}
            </div>
          </div>
        );
      })}
      {typing && (
        <div className="mb-2 flex justify-start" aria-label="Assistant is typing">
          <div className="bubble bubble-in tail-in flex items-center gap-1 py-3">
            <span className="typing-dot size-2 rounded-full bg-neutral-500" />
            <span className="typing-dot size-2 rounded-full bg-neutral-500" />
            <span className="typing-dot size-2 rounded-full bg-neutral-500" />
          </div>
        </div>
      )}
    </div>
  );
}
