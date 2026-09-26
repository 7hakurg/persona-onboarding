import { useState, type FormEvent, type KeyboardEvent } from "react";

const MAX_CHARS = 1000;

interface ComposerProps {
  disabled: boolean;
  placeholder: string;
  onSend: (text: string) => Promise<boolean>;
}

export function Composer({ disabled, placeholder, onSend }: ComposerProps) {
  const [text, setText] = useState("");
  const trimmed = text.trim();
  const tooLong = text.length > MAX_CHARS;

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!trimmed || tooLong || disabled) return;
    const sent = text;
    setText("");
    const ok = await onSend(sent);
    if (!ok) setText(sent);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <form onSubmit={submit} className="flex items-end gap-2 border-t border-neutral-100 bg-white/95 px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 backdrop-blur">
      <div className={`flex min-h-9 flex-1 items-end rounded-[20px] border px-3.5 py-1.5 ${tooLong ? "border-ios-red" : "border-neutral-300"}`}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={placeholder}
          aria-label="Message"
          disabled={disabled}
          className="max-h-28 w-full resize-none bg-transparent text-[16px] leading-6 outline-none placeholder:text-neutral-400 disabled:opacity-50"
        />
      </div>
      <button
        type="submit"
        aria-label="Send"
        disabled={!trimmed || tooLong || disabled}
        className="mb-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-imessage text-white transition disabled:bg-neutral-300"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
      </button>
      {tooLong && <span className="sr-only" role="alert">Message is over {MAX_CHARS} characters.</span>}
    </form>
  );
}
