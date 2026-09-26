interface QuickRepliesProps {
  options: string[];
  onPick: (label: string) => void;
}

export function QuickReplies({ options, onPick }: QuickRepliesProps) {
  if (options.length === 0) return null;
  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto px-3 pb-2 pt-1" role="group" aria-label="Suggested replies">
      {options.map((label) => (
        <button
          key={label}
          type="button"
          onClick={() => onPick(label)}
          className="pop-in shrink-0 rounded-full border border-imessage/40 bg-white px-3.5 py-1.5 text-[14px] font-medium text-imessage transition active:scale-95 active:bg-imessage/10"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
