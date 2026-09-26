import { useEffect } from "react";

interface ToastProps {
  message: string | null;
  onDone: () => void;
}

export function Toast({ message, onDone }: ToastProps) {
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(onDone, 3500);
    return () => clearTimeout(id);
  }, [message, onDone]);
  if (!message) return null;
  return (
    <div role="alert" className="pop-in absolute inset-x-4 top-14 z-40 rounded-2xl bg-neutral-900/90 px-4 py-2.5 text-center text-[14px] text-white shadow-lg backdrop-blur">
      {message}
    </div>
  );
}
