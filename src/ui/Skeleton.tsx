import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

/**
 * Placeholder block while content loads. Size it with className (e.g. `h-4 w-40`). It pulses
 * slowly and stands still under reduced motion. Shape skeletons like the real screen: the
 * primitives below give the page header, text lines, tiles, rows and buttons their real sizes.
 */
export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-tile bg-elevated motion-reduce:animate-none", className)}
      {...rest}
    />
  );
}

/**
 * The region that holds a loading skeleton: announced once as "Loading" and hidden from
 * assistive tech otherwise. Wrap every `loading.tsx` in it.
 */
export function SkeletonRegion({
  children,
  label = "Loading",
  className,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <div role="status" aria-label={label} className={cn("flex flex-col", className)}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** Where a PageHeader will be: the 48px title, the 48x3 rule and one line of description. */
export function SkeletonHeader({
  description = true,
  actions = 0,
  className,
}: {
  description?: boolean;
  /** How many header buttons to stand in for (40px capsules on the right). */
  actions?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4", className)}
    >
      <div className="flex min-w-0 flex-col">
        <Skeleton className="h-12 w-72 max-w-full rounded-row" />
        <div className="mt-3 h-0.75 w-12 rounded-mark bg-fill" />
        {description ? <Skeleton className="mt-3 h-5.5 w-96 max-w-full rounded-row" /> : null}
      </div>
      {actions > 0 ? (
        <div className="flex gap-2">
          {Array.from({ length: actions }, (_, i) => (
            <Skeleton key={i} className="h-(--btn) w-32 rounded-capsule" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Lines of text at the body size; the last line is shorter, like real running text. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("flex max-w-(--measure) flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className={cn("h-4 rounded-row", i === lines - 1 && lines > 1 ? "w-3/5" : "w-full")}
        />
      ))}
    </div>
  );
}

/** A picture tile with its caption line(s) underneath, as in PictureTile and OptionTile. */
export function SkeletonTile({
  aspect = "video",
  caption = true,
  status = false,
  className,
  style,
}: {
  aspect?: "video" | "portrait" | "square";
  caption?: boolean;
  status?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div aria-hidden="true" style={style} className={cn("flex min-w-0 flex-col gap-3", className)}>
      <Skeleton
        className={cn(
          "w-full rounded-card",
          aspect === "video"
            ? "aspect-video"
            : aspect === "portrait"
              ? "aspect-[4/5]"
              : "aspect-square",
        )}
      />
      {caption ? <Skeleton className="h-5 w-1/2 rounded-row" /> : null}
      {status ? <Skeleton className="h-4 w-1/3 rounded-row" /> : null}
    </div>
  );
}

/** The rows of a FocusLayout list (SelectRow sizes): 60px tall, or 56px with `size="regular"`. */
export function SkeletonRows({
  rows = 5,
  size = "large",
  className,
}: {
  rows?: number;
  size?: "regular" | "large";
  className?: string;
}) {
  return (
    <div aria-hidden="true" className={cn("flex flex-col gap-0.5", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className={cn("flex items-center px-3.5", size === "large" ? "min-h-15" : "min-h-14")}
        >
          <Skeleton className={cn("h-4 rounded-row", i % 2 === 0 ? "w-2/3" : "w-1/2")} />
        </div>
      ))}
    </div>
  );
}

/** A button-sized capsule: `large` 48px (the primary action), `regular` 40px. */
export function SkeletonButton({
  size = "large",
  className,
}: {
  size?: "regular" | "large";
  className?: string;
}) {
  return (
    <Skeleton
      className={cn(
        "rounded-capsule",
        size === "large" ? "h-(--btn-lg) w-40" : "h-(--btn) w-32",
        className,
      )}
    />
  );
}
