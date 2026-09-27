import type { SessionState } from "../../shared/types";
import { quickReplies } from "../../shared/selectors";
import { agentDisplayName, isCallLive } from "../lib/derive";
import { Avatar } from "./Avatar";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { QuickReplies } from "./QuickReplies";
import { StatusBar } from "./StatusBar";

interface MessagesScreenProps {
  state: SessionState;
  reconnecting: boolean;
  gmailEnabled: boolean;
  onSend: (text: string) => Promise<boolean>;
  onCall: () => void;
  onConnectGmail: () => void;
  onBack?: () => void;
  onReset: () => void;
}

export function MessagesScreen({ state, reconnecting, gmailEnabled, onSend, onCall, onConnectGmail, onBack, onReset }: MessagesScreenProps) {
  const name = agentDisplayName(state);
  const chips = quickReplies(state);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <StatusBar />
      <header className="relative flex shrink-0 flex-col items-center border-b border-neutral-200/80 bg-neutral-50/90 pb-2 pt-1 backdrop-blur">
        {onBack ? (
          <button type="button" onClick={onBack} className="absolute left-3 top-4 text-[17px] text-imessage" aria-label="Back to home">
            ‹ Home
          </button>
        ) : (
          <button type="button" onClick={onReset} className="absolute left-3 top-5 rounded-full px-2 py-1 text-[13px] font-medium text-imessage active:bg-imessage/10">
            Start over
          </button>
        )}
        <Avatar name={name} size={48} />
        <p className="mt-1 text-[12px] font-medium">
          {name} <span className="text-neutral-400">›</span>
        </p>
        <button
          type="button"
          onClick={onCall}
          disabled={isCallLive(state)}
          aria-label={`Call ${name}`}
          className="absolute right-4 top-5 grid size-9 place-items-center rounded-full text-imessage transition active:bg-imessage/10 disabled:text-neutral-300"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" /></svg>
        </button>
        {reconnecting && <p className="mt-1 text-[11px] text-ios-red">Reconnecting…</p>}
      </header>
      <MessageList messages={state.messages} typing={state.turnPending} gmail={state.gmail} gmailEnabled={gmailEnabled} onConnectGmail={onConnectGmail} />
      <QuickReplies options={chips} onPick={(label) => void onSend(label)} />
      <Composer disabled={reconnecting} placeholder="iMessage" onSend={onSend} />
    </div>
  );
}
