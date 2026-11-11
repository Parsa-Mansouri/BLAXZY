"use client";

import type { ReactNode } from "react";
import { ImageOff } from "lucide-react";
import type { Asset } from "@/server/assets";
import type { GuidedQuestion } from "@/server/damis";
import { fileSrc } from "@/lib/file-src";
import { cn } from "@/ui";

export type { GuidedQuestion };

export interface AssetInfo {
  id: string;
  kind: Asset["kind"];
  name: string;
  description: string | null;
  removed: boolean;
}

export interface IssueChoice {
  code: string;
  label: string;
  hint: string;
}

export interface Limits {
  prompt: number;
  answer: number;
  note: number;
  name: number;
  description: number;
}

export type Orientation = "landscape" | "portrait";

const numberFormat = new Intl.NumberFormat("en-US");
export const formatNumber = (n: number) => numberFormat.format(n);

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** A date in the reader's time zone (the server render may differ, so hydration is tolerant). */
export function When({ date }: { date: Date }) {
  const value = new Date(date);
  return (
    <time dateTime={value.toISOString()} suppressHydrationWarning>
      {dateFormat.format(value)}
    </time>
  );
}

const ASPECTS = {
  landscape: "aspect-video",
  portrait: "aspect-[9/16]",
  sheet: "aspect-video",
} as const;

export type ArtworkShape = keyof typeof ASPECTS;

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
}: {
  fileId: string | null;
  alt: string;
  shape: ArtworkShape;
  size?: "hero" | "inset";
  dimmed?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-artwork",
        ASPECTS[shape],
        size === "hero" && "max-h-[min(70dvh,48rem)]",
        fileId ? "bg-ground" : "bg-elevated",
        className,
      )}
    >
      {fileId ? (
        // A redirect to a presigned URL that changes per request: next/image cannot cache it.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={fileSrc(fileId)}
          alt={alt}
          decoding="async"
          draggable={false}
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
    </div>
  );
}

/** The empty frame's quiet content when an image could not be made. */
export function MissingImage({ label }: { label: string }) {
  return (
    <>
      <ImageOff aria-hidden="true" className="size-6 text-label-3" />
      <span className="text-callout text-label-2">{label}</span>
    </>
  );
}

/** Credits for a generation and the balance, in one quiet line; says what to do when short. */
export function PriceLine({ price, balance }: { price: number | null; balance: number }) {
  if (price === null) return null;
  const credits = `${formatNumber(price)} ${price === 1 ? "credit" : "credits"}`;
  if (balance >= price) {
    return (
      <p className="text-callout text-label-2 tabular-nums">
        {credits}. You have {formatNumber(balance)}.
      </p>
    );
  }
  return (
    <p role="status" className="text-callout text-orange tabular-nums">
      {credits}. You have {formatNumber(balance)}, which is not enough. Ask the workspace owner to
      add credits, then come back to this page.
    </p>
  );
}

export const canAfford = (price: number | null, balance: number) =>
  price === null || balance >= price;

/** An error under a control, read out when it appears. */
export function ErrorLine({ id, children }: { id?: string; children: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="text-callout text-red">
      {children}
    </p>
  );
}
