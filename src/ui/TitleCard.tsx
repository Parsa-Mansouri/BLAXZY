import type { ReactNode } from "react";
import { cn } from "./cn";

export interface TitleCardProps {
  /** The film's title, set large on the frame. */
  title: string;
  /** Small line under the title (hero only). */
  line?: ReactNode;
  /** `tile`: a 16:9 frame. `hero`: a taller frame for a featured film. */
  size?: "tile" | "hero";
  /** Content under the title block, e.g. a Continue button. */
  action?: ReactNode;
  className?: string;
}

/**
 * Artwork for a project that has no imagery yet: the film's title on a flat dark frame,
 * bottom-left. It is never a stand-in for a generated still. For tiles with hover actions use
 * PictureTile with `overlay={title}` instead.
 */
export function TitleCard({ title, line, size = "tile", action, className }: TitleCardProps) {
  const hero = size === "hero";
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-card bg-elevated",
        hero ? "min-h-80 rounded-block" : "aspect-video",
        className,
      )}
    >
      <div
        className={cn(
          "flex flex-col justify-end",
          hero ? "min-h-80 gap-5 p-10" : "absolute inset-0 p-5",
        )}
      >
        <p
          className={cn(
            "line-clamp-3 text-balance break-words text-label",
            hero ? "max-w-[80%] text-display" : "max-w-[92%] text-heading-sm",
          )}
        >
          {title}
        </p>
        {line ? <div className="text-meta text-label-2">{line}</div> : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  );
}
