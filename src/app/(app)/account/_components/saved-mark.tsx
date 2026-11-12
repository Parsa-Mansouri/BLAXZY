import type { ReactNode } from "react";
import { Check } from "lucide-react";

/** A quiet confirmation of what was just saved: the tick settles in (250ms) beside a short line. */
export function SavedMark({ children }: { children: ReactNode }) {
  return (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 text-secondary text-label-2 transition-[opacity,scale] duration-(--dur-swap) ease-out starting:scale-90 starting:opacity-0"
    >
      <Check aria-hidden="true" strokeWidth={1.5} className="size-(--icon) text-done" />
      {children}
    </span>
  );
}
