import { fileSrc } from "@/lib/file-src";
import { cn, StoredImage } from "@/ui";

/**
 * An asset's sheet as a small frame (6px corners; callers set a larger radius on large frames). The image covers the frame; without one the frame stays
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
        "relative aspect-video shrink-0 overflow-hidden rounded-paper bg-elevated",
        className,
      )}
    >
      {fileId ? (
        <StoredImage
          src={fileSrc(fileId)}
          alt={alt}
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
    </div>
  );
}
