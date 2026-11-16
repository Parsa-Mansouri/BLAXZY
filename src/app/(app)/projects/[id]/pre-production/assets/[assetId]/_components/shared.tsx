"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ImageOff } from "lucide-react";
import type { Asset } from "@/server/assets";
import type { GuidedQuestion } from "@/server/damis";
import { fileSrc } from "@/lib/file-src";
import { cn, StoredImage } from "@/ui";
import { CreditLine } from "@/app/(app)/_components/values";
import { PICTURE_MAX_H } from "../../../_lib/fill";
import type { ArtworkShape } from "../_lib/asset-view";

export type { GuidedQuestion };

export interface AssetInfo {
  id: string;
  kind: Asset["kind"];
  name: string;
  description: string | null;
  removed: boolean;
}

export interface Limits {
  prompt: number;
  answer: number;
  note: number;
  name: number;
  description: number;
}

export type Orientation = "landscape" | "portrait";

const ASPECTS: Record<ArtworkShape, string> = {
  landscape: "aspect-video",
  portrait: "aspect-[9/16]",
  sheet: "aspect-video",
  "16:9": "aspect-video",
  "9:16": "aspect-[9/16]",
  "1:1": "aspect-square",
  "4:3": "aspect-[4/3]",
  "3:4": "aspect-[3/4]",
};

export type { ArtworkShape };

/**
 * A stored image in a box of known shape, contained on black so it never distorts or shifts the
 * layout. Without a file the box is an empty frame (with `children` centred in it).
 */
export function Artwork({
  fileId,
  alt,
  shape,
  size = "hero",
  dimmed = false,
  className,
  children,
  overlay,
}: {
  fileId: string | null;
  alt: string;
  shape: ArtworkShape;
  size?: "hero" | "inset";
  dimmed?: boolean;
  className?: string;
  children?: ReactNode;
  /** Laid exactly over the picture (not its letterbox), e.g. the marks while asking for changes. */
  overlay?: ReactNode;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-card",
        ASPECTS[shape],
        size === "hero" && PICTURE_MAX_H,
        fileId ? "bg-ground" : "bg-elevated",
        className,
      )}
    >
      {fileId ? (
        // A redirect to a presigned URL that changes per request: next/image cannot cache it.
        <StoredImage
          ref={imageRef}
          src={fileSrc(fileId)}
          loading="eager"
          alt={alt}
          className={cn(
            "absolute inset-0 size-full object-contain transition-opacity duration-(--dur-base)",
            dimmed && "opacity-45",
          )}
        />
      ) : null}
      {children ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
          {children}
        </div>
      ) : null}
      {fileId && overlay ? <FitToImage imageRef={imageRef}>{overlay}</FitToImage> : null}
    </div>
  );
}

type Box = { left: number; top: number; width: number; height: number };

/**
 * A layer over the part of its box an `object-contain` image actually covers, so positions on it
 * are positions on the picture. Fills the nearest positioned ancestor (the image box) and follows
 * its size; shows nothing until the image has loaded.
 */
export function FitToImage({
  imageRef,
  children,
}: {
  imageRef: RefObject<HTMLImageElement | null>;
  children: ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<Box | null>(null);

  useEffect(() => {
    const box = boxRef.current;
    const image = imageRef.current;
    if (!box || !image) return;
    const update = () => {
      const bw = box.clientWidth;
      const bh = box.clientHeight;
      const nw = image.naturalWidth;
      const nh = image.naturalHeight;
      if (!bw || !bh || !nw || !nh) {
        setFit(null);
        return;
      }
      const scale = Math.min(bw / nw, bh / nh);
      const width = nw * scale;
      const height = nh * scale;
      setFit({ left: (bw - width) / 2, top: (bh - height) / 2, width, height });
    };
    // The observer reports once on observe, which covers an image that loaded before this ran.
    const observer = new ResizeObserver(update);
    observer.observe(box);
    image.addEventListener("load", update);
    return () => {
      observer.disconnect();
      image.removeEventListener("load", update);
    };
  }, [imageRef]);

  return (
    <div ref={boxRef} className="pointer-events-none absolute inset-0">
      {fit ? (
        <div className="pointer-events-auto absolute" style={fit}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** The empty frame's quiet content when an image could not be made. */
export function MissingImage({ label }: { label: string }) {
  return (
    <>
      <ImageOff aria-hidden="true" strokeWidth={1.5} className="size-5 text-label-3" />
      <span className="text-meta text-label-3">{label}</span>
    </>
  );
}

const PRICE_ACTIONS = {
  image: "Creating this image",
  sheet: "Building the sheet",
  view: "Making this view",
} as const;

/**
 * Credits for a generation and the balance, in one quiet line that says what costs them; says what
 * to do when short.
 */
export function PriceLine({
  price,
  balance,
  action,
}: {
  price: number | null;
  balance: number;
  action: keyof typeof PRICE_ACTIONS;
}) {
  return <CreditLine price={price} balance={balance} action={PRICE_ACTIONS[action]} />;
}
