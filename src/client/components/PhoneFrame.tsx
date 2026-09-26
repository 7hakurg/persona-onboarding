import type { ReactNode } from "react";

interface PhoneFrameProps {
  children: ReactNode;
}

/** A device bezel on larger screens; on phones the app simply fills the viewport. */
export function PhoneFrame({ children }: PhoneFrameProps) {
  return (
    <div className="relative h-dvh w-full overflow-hidden bg-white sm:h-[min(844px,calc(100dvh-48px))] sm:w-[390px] sm:rounded-[54px] sm:border-[12px] sm:border-neutral-900 sm:shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)]">
      <div className="pointer-events-none absolute left-1/2 top-2 z-50 hidden h-[30px] w-[118px] -translate-x-1/2 rounded-full bg-neutral-900 sm:block" aria-hidden />
      <div className="relative flex h-full flex-col">{children}</div>
    </div>
  );
}
