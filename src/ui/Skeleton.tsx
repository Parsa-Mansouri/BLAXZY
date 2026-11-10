import type { HTMLAttributes } from "react";
import { cn } from "./cn";

/** Placeholder block while content loads. Size it with className (e.g. `h-4 w-40`). */
export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-control bg-fill-4 motion-reduce:animate-none",
        className,
      )}
      {...rest}
    />
  );
}
