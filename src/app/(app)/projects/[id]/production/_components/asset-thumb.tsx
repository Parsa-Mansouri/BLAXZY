import { fileSrc } from "@/lib/file-src";
import { cn } from "@/ui";

/**
 * An asset's sheet as a small frame. The image covers the frame; without one the frame stays
 * as a flat empty tile so the layout does not move (never a fake image).
 */
export function AssetThumb({
  fileId,
  alt = "",
  className,
}: {
  fileId: string | null;
  alt?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative aspect-video shrink-0 overflow-hidden rounded-[8px] bg-elevated",
        className,
      )}
    >
      {fileId ? (
        // eslint-disable-next-line @next/next/no-img-element -- stored media behind a redirect
        <img
          src={fileSrc(fileId)}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
    </div>
  );
}
