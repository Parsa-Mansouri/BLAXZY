import { ImageOff } from "lucide-react";
import { fileSrc } from "@/lib/file-src";
import { cn } from "@/ui";

/**
 * An asset's sheet as a small frame on black. The image is contained, never stretched; without
 * one the frame stays empty so the layout does not move.
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
        "relative aspect-video shrink-0 overflow-hidden rounded-control bg-elevated",
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
      ) : (
        <div className="flex size-full items-center justify-center text-label-3">
          <ImageOff aria-hidden strokeWidth={1.25} className="size-5" />
        </div>
      )}
    </div>
  );
}
