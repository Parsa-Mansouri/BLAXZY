import type { CSSProperties, ReactNode } from "react";
import { cn } from "./cn";

export type PictureAspect = "video" | "portrait" | "square";

const aspects: Record<PictureAspect, string> = {
  video: "aspect-video",
  portrait: "aspect-[4/5]",
  square: "aspect-square",
};

export interface PicturePlaceholderProps {
  /** e.g. "No image yet", "Image placeholder", "Example image". Empty for a bare tile. */
  label?: string;
  /** A dashed outline instead of the flat tile: something the user still has to add. */
  dashed?: boolean;
  aspect?: PictureAspect;
  className?: string;
}

/**
 * A picture that does not exist yet. Never fake a generated image: a flat dark tile with a small
 * muted label, or a dashed outline for "No image yet".
 */
export function PicturePlaceholder({
  label,
  dashed = false,
  aspect = "video",
  className,
}: PicturePlaceholderProps) {
  return (
    <div
      className={cn(
        "flex w-full items-center justify-center rounded-tile p-4 text-center text-meta text-label-3",
        dashed ? "border border-dashed border-separator-opaque" : "bg-elevated",
        aspects[aspect],
        className,
      )}
    >
      {label ? <span>{label}</span> : null}
    </div>
  );
}

export interface PictureTileProps {
  /** Accessible name of the tile, read when it takes focus, e.g. the film's or asset's name. */
  label: string;
  /** The picture: an <img>, a video poster, or a PicturePlaceholder-like element. */
  picture?: ReactNode;
  /** Shown on the picture when there is none: a flat tile with this small muted label. */
  placeholder?: string;
  /** Dashed outline for the placeholder (the user still has to add an image). */
  dashed?: boolean;
  /** Text set on the picture itself, bottom-left (Home's film tiles carry the title here). */
  overlay?: ReactNode;
  aspect?: PictureAspect;
  /** Heading on the action panel, e.g. the asset's name. */
  coverHeading?: ReactNode;
  /** A status line on the action panel. */
  coverLine?: ReactNode;
  /** The actions on the panel: buttons or links. One white button at most. */
  actions: ReactNode;
  /** Lay the actions out side by side (film tiles) instead of stacked (asset tiles). */
  actionsInline?: boolean;
  /** Under the picture: the name. */
  caption?: ReactNode;
  /** Under the name: at most one StatusLine. */
  status?: ReactNode;
  className?: string;
  /** For `stagger(i)` with the `enter` class. */
  style?: CSSProperties;
}

/**
 * A card with a picture. Its actions live on a panel that slides up and covers the WHOLE picture
 * on hover and on keyboard focus (360ms). The tile itself takes focus, so keyboard users reveal
 * the panel and then Tab into its buttons.
 */
export function PictureTile({
  label,
  picture,
  placeholder,
  dashed = false,
  overlay,
  aspect = "video",
  coverHeading,
  coverLine,
  actions,
  actionsInline = false,
  caption,
  status,
  className,
  style,
}: PictureTileProps) {
  return (
    <div
      tabIndex={0}
      role="group"
      aria-label={label}
      style={style}
      className={cn(
        "group/tile cover-host flex min-w-0 flex-col gap-3 rounded-card focus-ring",
        className,
      )}
    >
      <div
        className={cn(
          "relative overflow-hidden rounded-card",
          dashed && !picture ? "border border-dashed border-separator-opaque" : "bg-elevated",
          aspects[aspect],
        )}
      >
        {picture ? (
          <div className="absolute inset-0 [&>img]:size-full [&>img]:object-cover">{picture}</div>
        ) : placeholder ? (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-meta text-label-3">
            {placeholder}
          </div>
        ) : null}
        {overlay ? (
          <div className="absolute inset-0 flex items-end p-5 text-heading-sm text-label">
            <span className="line-clamp-3 break-words">{overlay}</span>
          </div>
        ) : null}
        <div className="absolute inset-0 flex cover-panel flex-col justify-between gap-3 bg-elevated-2 p-4 sm:p-5">
          <div className="flex min-w-0 flex-col gap-1.5">
            {coverHeading ? (
              <div className="text-[22px] leading-[26px] font-semibold tracking-[-0.02em] break-words text-label">
                {coverHeading}
              </div>
            ) : null}
            {coverLine}
          </div>
          <div
            className={cn(
              "flex gap-2",
              actionsInline ? "flex-wrap [&>*:first-child]:flex-1" : "flex-col [&>*]:w-full",
            )}
          >
            {actions}
          </div>
        </div>
      </div>
      {caption || status ? (
        <div className="flex min-w-0 flex-col gap-1 px-0.5">
          {caption ? (
            <div className="truncate text-row font-semibold tracking-[-0.01em]">{caption}</div>
          ) : null}
          {status}
        </div>
      ) : null}
    </div>
  );
}
