import type { CSSProperties, ReactNode } from "react";
import { fileSrc } from "@/lib/file-src";
import { cn } from "@/ui";

export type PosterShape = "landscape" | "portrait";

/** Class names are literal so Tailwind can see them. */
const SHAPES: Record<PosterShape, string> = {
  landscape: "aspect-video",
  portrait: "aspect-[9/16]",
};

/**
 * A clip's poster as a card, like the kit's PictureTile but in the film's own shape (16:9 or
 * 9:16) and with the poster contained on black, never cropped. Its actions live on a panel that
 * slides up over the WHOLE picture on hover and on keyboard focus (360ms); the card takes focus,
 * so keyboard users reveal the panel and then Tab into its buttons.
 */
export function PosterTile({
  label,
  shape,
  posterFileId,
  dim = false,
  placeholder,
  coverHeading,
  coverLine,
  actions,
  caption,
  status,
  className,
  style,
}: {
  /** Accessible name of the card. */
  label: string;
  shape: PosterShape;
  posterFileId: string | null;
  /** Something newer is being made: the poster steps back. */
  dim?: boolean;
  /** Shown on an empty frame: a few muted words ("Rendering", "No clip yet"). */
  placeholder?: string;
  coverHeading?: ReactNode;
  coverLine?: ReactNode;
  /** Buttons or links; one white button at most. */
  actions: ReactNode;
  caption?: ReactNode;
  /** At most one status line. */
  status?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
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
          "relative w-full overflow-hidden rounded-card",
          SHAPES[shape],
          posterFileId ? "bg-ground" : "bg-elevated",
        )}
      >
        {posterFileId ? (
          // eslint-disable-next-line @next/next/no-img-element -- a redirect to a presigned URL
          <img
            src={fileSrc(posterFileId)}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            className={cn("absolute inset-0 size-full object-contain", dim && "opacity-40")}
          />
        ) : null}
        {placeholder ? (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-meta text-label-3">
            {placeholder}
          </div>
        ) : null}
        <div className="absolute inset-0 flex cover-panel flex-col justify-between gap-3 bg-elevated-2 p-4 sm:p-5">
          <div className="flex min-w-0 flex-col gap-1.5">
            {coverHeading ? (
              <div className="line-clamp-3 text-[22px] leading-[26px] font-semibold tracking-[-0.02em] break-words text-label">
                {coverHeading}
              </div>
            ) : null}
            {coverLine}
          </div>
          <div className="flex flex-wrap gap-2 [&>*]:flex-1">{actions}</div>
        </div>
      </div>
      {caption || status ? (
        <div className="flex min-w-0 flex-col gap-1 px-0.5">
          {caption ? (
            <div className="line-clamp-2 text-row font-semibold tracking-[-0.01em]">{caption}</div>
          ) : null}
          {status}
        </div>
      ) : null}
    </div>
  );
}
