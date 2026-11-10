import type { HTMLAttributes } from "react";
import { cn } from "./cn";

/** Placeholder block. Size it with className (e.g. `h-4 w-40`). */
export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-shimmer rounded-sm bg-hover",
        "bg-[linear-gradient(100deg,transparent_30%,var(--pressed)_50%,transparent_70%)] bg-[length:250%_100%]",
        className,
      )}
      {...rest}
    />
  );
}
