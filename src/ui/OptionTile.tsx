"use client";

import type { CSSProperties, ReactNode } from "react";
import { Check, Plus } from "lucide-react";
import { cn } from "./cn";

export interface OptionTileProps {
  /** The option's name, under the picture. */
  label: string;
  selected?: boolean;
  onSelect?: () => void;
  /**
   * A real example picture. No real example images exist yet: leave it unset and the tile shows
   * a neutral "Example image" placeholder. Drop an image URL in here later and nothing else
   * changes.
   */
  src?: string;
  /** Alternative text for `src`. Defaults to empty (the label already names the option). */
  alt?: string;
  /** `example` (default) shows a picture; `other` is the dashed "Other" tile with a plus. */
  kind?: "example" | "other";
  /**
   * Picture shape, as a CSS aspect ratio such as "16 / 9" (default) or "9 / 16". With `width`,
   * frame options can show their real proportions side by side.
   */
  aspectRatio?: string;
  /** Fixed tile width, e.g. "288px" for a landscape frame next to a "162px" portrait one. */
  width?: string;
  /**
   * Fill the tile's grid cell: the picture grows to the cell's height instead of keeping
   * `aspectRatio` (use in a grid whose rows share the free height, e.g. `auto-rows-[minmax(180px,1fr)]`,
   * so tiles are as large as the screen allows). A real `src` is cropped to fit (object-cover).
   */
  fill?: boolean;
  disabled?: boolean;
  className?: string;
  /** For `stagger(i)` with `className="enter"`. */
  style?: CSSProperties;
}

/**
 * A picture option (Style questions): the picture, then the name with a tick when chosen. The
 * chosen tile gets a 2px white ring and a white, heavier name. A toggle button (`aria-pressed`).
 */
export function OptionTile({
  label,
  selected = false,
  onSelect,
  src,
  alt = "",
  kind = "example",
  aspectRatio = "16 / 9",
  width,
  fill = false,
  disabled,
  className,
  style,
}: OptionTileProps) {
  const other = kind === "other";
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      style={{ ...style, width }}
      className={cn(
        "group/option flex max-w-full min-w-0 press flex-col gap-2.5 rounded-tile text-left focus-ring",
        fill && "h-full",
        "disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
    >
      <span
        style={fill ? undefined : { aspectRatio }}
        className={cn(
          fill && "min-h-28 flex-1",
          "relative flex w-full items-center justify-center overflow-hidden rounded-tile text-meta text-label-3",
          "transition-[box-shadow,border-color] duration-(--dur-press)",
          other ? "border border-dashed border-outline" : "bg-elevated",
          selected
            ? "ring-2 ring-accent"
            : "group-hover/option:ring-1 group-hover/option:ring-outline",
        )}
      >
        {other ? (
          <Plus aria-hidden="true" className="size-6 text-label-2" strokeWidth={1.5} />
        ) : src ? (
          // Example pictures are small static files; next/image is not needed here.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={alt} className="absolute inset-0 size-full object-cover" />
        ) : (
          <span>Example image</span>
        )}
      </span>
      <span
        className={cn(
          "flex items-center gap-2 px-0.5 text-row transition-colors duration-(--dur-press)",
          selected ? "font-semibold text-label" : "font-medium text-label-2",
        )}
      >
        <span className="min-w-0">{label}</span>
        <Check
          aria-hidden="true"
          className={cn("size-3.5 shrink-0 text-label", !selected && "invisible")}
          strokeWidth={2}
        />
      </span>
    </button>
  );
}

export interface OptionRowProps {
  children: ReactNode;
  selected?: boolean;
  onSelect?: () => void;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** A text option without a picture (e.g. a length): dark row, white when chosen. */
export function OptionRow({
  children,
  selected = false,
  onSelect,
  disabled,
  className,
  style,
}: OptionRowProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      style={style}
      className={cn(
        "flex min-h-13 w-full press items-center rounded-tile px-5 text-left text-row focus-ring",
        "disabled:pointer-events-none disabled:opacity-40",
        selected ? "bg-accent text-on-accent" : "bg-elevated text-label hover:bg-fill-4",
        className,
      )}
    >
      {children}
    </button>
  );
}
