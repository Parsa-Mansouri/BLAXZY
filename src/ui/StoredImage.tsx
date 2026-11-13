import type { ComponentPropsWithRef } from "react";

export type StoredImageProps = Omit<ComponentPropsWithRef<"img">, "src" | "alt"> & {
  /** The picture's address, usually `fileSrc(id)`. */
  src: string;
  /** Always set: "" for a picture that only decorates. */
  alt: string;
};

/**
 * A picture from the file store. `/api/files/[id]` needs the session and redirects to a
 * short-lived presigned URL, so `next/image` cannot optimise or cache it; this is the one place
 * the plain `<img>` lives. Lazy and async by default (pass `loading="eager"` for a picture the
 * screen opens on), and never draggable. Everything else (ref, width, height, className,
 * handlers) passes through.
 */
export function StoredImage({
  src,
  alt,
  loading = "lazy",
  decoding = "async",
  draggable = false,
  ...rest
}: StoredImageProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- presigned redirect, see above
    <img
      src={src}
      alt={alt}
      loading={loading}
      decoding={decoding}
      draggable={draggable}
      {...rest}
    />
  );
}
