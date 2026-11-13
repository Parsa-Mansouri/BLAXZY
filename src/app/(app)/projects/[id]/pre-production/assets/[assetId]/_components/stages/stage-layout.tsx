import type { ReactNode } from "react";
import { cn } from "@/ui";
import { lookShape, type ArtworkShape, type HeldImage } from "../../_lib/asset-view";
import { Artwork, type Orientation } from "../shared";
import { When } from "@/app/(app)/_components/values";

export const SAMPLE_OUTPUT = "Sample output from the test generator.";

/** The picture large on the leading side (`in-2`), what to do with it beside it (`in-3`). */
export function StageLayout({
  frame,
  rail,
  frameClassName,
}: {
  frame: ReactNode;
  rail: ReactNode;
  frameClassName?: string;
}) {
  return (
    <div className="flex flex-wrap items-start gap-x-16 gap-y-10">
      <div className={cn("min-w-0 flex-[3_1_480px] in-2", frameClassName)}>{frame}</div>
      <div className="flex max-w-105 min-w-0 flex-[1_1_340px] in-3 flex-col gap-8">{rail}</div>
    </div>
  );
}

/** "Image 2 · From your answers · 11 Nov, 14:02". */
export function VersionLine({
  label,
  origin,
  date,
}: {
  label: string;
  origin?: string;
  date: Date;
}) {
  return (
    <p className="text-meta text-label-2">
      {label}
      {origin ? ` · ${origin}` : ""} · <When date={date} />
    </p>
  );
}

/** A smaller image in the rail, for comparison. */
export function InsetImage({
  fileId,
  caption,
  alt,
  shape,
}: {
  fileId: string;
  caption: string;
  alt: string;
  shape: ArtworkShape;
}) {
  const tall = shape === "portrait" || shape === "9:16" || shape === "3:4";
  return (
    <figure className="flex flex-col gap-2">
      <Artwork
        fileId={fileId}
        alt={alt}
        shape={shape}
        size="inset"
        className={tall ? "max-w-44" : "max-w-72"}
      />
      <figcaption className="text-meta text-label-2">{caption}</figcaption>
    </figure>
  );
}

/** The shape of a held image: a sheet, or a look in its own ratio. */
export function heldShape(held: HeldImage, orientation: Orientation): ArtworkShape {
  return held.kind === "sheet" ? "sheet" : lookShape(held.aspectRatio, orientation);
}
