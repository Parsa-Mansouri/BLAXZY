"use client";

import type { CSSProperties, ReactNode } from "react";
import { Plus } from "lucide-react";
import { cn } from "./cn";
import { Tick } from "./Feedback";
import { StoredImage } from "./StoredImage";

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
  /** `example` (default) shows a picture; `other` is the "Not what you have in mind?" tile with a plus. */
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
 * chosen tile gets a 2px brand ring, a white heavier name and a brand tick that draws in. A
 * toggle button (`aria-pressed`).
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
        "disabled:pointer-events-none",
        className,
      )}
    >
      <span
        style={fill ? undefined : { aspectRatio }}
        className={cn(
          fill && "min-h-28 flex-1",
          "relative flex w-full items-center justify-center overflow-hidden rounded-tile bg-elevated text-meta text-label-3",
          "transition-[box-shadow] duration-(--dur-press)",
          selected
            ? "ring-2 ring-brand"
            : "group-hover/option:ring-1 group-hover/option:ring-outline",
        )}
      >
        {other ? (
          <Plus aria-hidden="true" className="size-(--icon-lg) text-label-2" />
        ) : src ? (
          // Example pictures are small static files; next/image is not needed here.
          <StoredImage src={src} alt={alt} className="absolute inset-0 size-full object-cover" />
        ) : (
          <span>Example image</span>
        )}
      </span>
      <span
        className={cn(
          "flex items-center gap-2 px-0.5 text-row text-pretty transition-colors duration-(--dur-press)",
          selected ? "font-semibold text-label" : "font-medium text-label-2",
          disabled && "text-label-3",
        )}
      >
        <span className="min-w-0">{label}</span>
        {/* Rendered only when chosen, so the tick draws in at that moment. */}
        {selected ? <Tick /> : <span aria-hidden="true" className="size-(--icon) shrink-0" />}
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

/**
 * A text option without a picture (e.g. a length): a dark row; when chosen, a 2px brand ring,
 * a heavier white label and a brand tick that draws in at the trailing end.
 */
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
        "flex min-h-13 w-full press items-center gap-3 rounded-tile bg-elevated px-5 text-left text-row focus-ring",
        "transition-[box-shadow,background-color] duration-(--dur-press)",
        "disabled:pointer-events-none disabled:text-label-3",
        selected
          ? "font-semibold text-label ring-2 ring-brand ring-inset"
          : "text-label hover:bg-fill-4",
        className,
      )}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {selected ? <Tick /> : null}
    </button>
  );
}
