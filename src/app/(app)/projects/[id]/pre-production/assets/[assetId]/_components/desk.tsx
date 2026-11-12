"use client";

import type { ReactNode } from "react";
import { cn } from "@/ui";

/**
 * The "mixing desk" pieces of the request-changes sheets (detection review, script changes),
 * shared by the asset screen's photo roles, look review and spec card.
 */

/** The small mono capitals over each part of a panel. */
export function Caps({
  id,
  as: Tag = "span",
  className,
  children,
}: {
  id?: string;
  as?: "span" | "h3" | "h4" | "p";
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag
      id={id}
      className={cn("font-mono text-meta tracking-caps text-label-2 uppercase", className)}
    >
      {children}
    </Tag>
  );
}

/** The square tick of the desk's tiles (round for a one-of choice). */
export function CheckMark({ on, round = false }: { on: boolean; round?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center border transition-colors motion-reduce:transition-none",
        round ? "rounded-full" : "rounded-[3px]",
        on ? "border-brand bg-brand" : "border-outline",
      )}
    >
      {on ? (
        round ? (
          <span className="size-1.5 rounded-full bg-ground" />
        ) : (
          <svg viewBox="0 0 10 10" className="size-2.5 text-ground" fill="none">
            <path d="M2 5.2 4.2 7.4 8 2.8" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        )
      ) : null}
    </span>
  );
}

const TILE_ON = "border-brand bg-brand/10 text-label";
const TILE_OFF = "border-outline-quiet bg-elevated text-label-2 hover:border-outline";

/** A one-of choice as a tile: round tick, its name and an optional line under it. */
export function ChoiceTile({
  label,
  line,
  on,
  disabled,
  onPick,
  size = "regular",
  action = false,
  className,
}: {
  label: ReactNode;
  line?: ReactNode;
  on: boolean;
  disabled?: boolean;
  onPick: () => void;
  /** `large`: the two side tiles that open a panel ("Something's wrong" / "I'd like it different"). */
  size?: "regular" | "large";
  /** A tile that does something at once (no tick, not a choice to keep). */
  action?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role={action ? undefined : "radio"}
      aria-checked={action ? undefined : on}
      disabled={disabled}
      onClick={onPick}
      className={cn(
        "flex flex-col items-start justify-between rounded-item border text-left focus-ring transition-colors motion-reduce:transition-none",
        size === "large" ? "min-h-28 gap-3 p-4" : "min-h-16 gap-2 p-3",
        on ? TILE_ON : TILE_OFF,
        className,
      )}
    >
      {action ? null : <CheckMark on={on} round />}
      <span className="flex flex-col gap-1">
        <span
          className={cn(
            "text-balance text-label",
            size === "large" ? "text-heading-sm" : "text-body",
          )}
        >
          {label}
        </span>
        {line ? <span className="text-secondary text-pretty text-label-2">{line}</span> : null}
      </span>
    </button>
  );
}

/** A many-of choice as a square tile: square tick in the corner, its name at the bottom. */
export function CheckTile({
  label,
  on,
  disabled,
  onToggle,
}: {
  label: ReactNode;
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "relative flex aspect-square flex-col items-start justify-end rounded-item border p-3 pt-8 text-left text-secondary text-pretty hyphens-auto focus-ring transition-colors motion-reduce:transition-none",
        on ? TILE_ON : TILE_OFF,
      )}
    >
      <span className="absolute top-2.5 left-2.5">
        <CheckMark on={on} />
      </span>
      {label}
    </button>
  );
}
