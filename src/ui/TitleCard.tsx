import type { ReactNode } from "react";
import { cn } from "./cn";

export interface TitleCardProps {
  /** The film's title, set large in the display weight. */
  title: string;
  /** Small line under the title (hero only), e.g. "Script · Step 2 of 4". */
  line?: ReactNode;
  /** `tile`: a 16:9 shelf frame. `hero`: a letterboxed Up Next frame, 240-280px tall on wide screens. */
  size?: "tile" | "hero";
  /** Content under the title block, e.g. the hero's Continue button. */
  action?: ReactNode;
  className?: string;
}

/**
 * Artwork for a project that has no imagery yet: a film's title frame. The title sits in the
 * bottom-left of a grey frame and is sized from the frame's width, so a shelf of these reads
 * like a shelf of films. It is never a stand-in for a generated still.
 */
export function TitleCard({ title, line, size = "tile", action, className }: TitleCardProps) {
  const hero = size === "hero";
  return (
    <div
      className={cn(
        "@container relative w-full overflow-hidden rounded-artwork bg-elevated",
        hero
          ? "aspect-video shell:aspect-auto shell:h-[clamp(15rem,18vw,17.5rem)]"
          : "aspect-video",
        className,
      )}
    >
      <div
        className={cn(
          "absolute inset-0 flex flex-col justify-end",
          hero ? "p-6 shell:px-8 shell:py-7" : "artwork-pad",
        )}
      >
        <p
          className={cn(
            "line-clamp-3 break-words text-label",
            hero ? "max-w-[70%] artwork-title-hero" : "max-w-[88%] artwork-title",
          )}
        >
          {title}
        </p>
        {line ? <p className="mt-1.5 text-callout text-label-2">{line}</p> : null}
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </div>
  );
}
