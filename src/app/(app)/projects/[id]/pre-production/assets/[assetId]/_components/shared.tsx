"use client";

import type { ReactNode } from "react";
import { ImageOff } from "lucide-react";
import type { Asset } from "@/server/assets";
import type { GuidedQuestion } from "@/server/damis";
import { fileSrc } from "@/lib/file-src";
import { cn } from "@/ui";
import { PICTURE_MAX_H } from "../../../_lib/fill";

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
        "relative w-full overflow-hidden rounded-card",
        ASPECTS[shape],
        size === "hero" && PICTURE_MAX_H,
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
      <ImageOff aria-hidden="true" strokeWidth={1.5} className="size-5 text-label-3" />
      <span className="text-meta text-label-3">{label}</span>
    </>
  );
}

/** A number of credits: mono and tabular, so prices line up and do not jump. */
export function Amount({ n }: { n: number }) {
  return <span className="font-mono tabular-nums">{formatNumber(n)}</span>;
}

export function Credits({ n }: { n: number }) {
  return (
    <>
      <Amount n={n} /> {n === 1 ? "credit" : "credits"}
    </>
  );
}

const PRICE_ACTIONS = { image: "Creating this image", sheet: "Building the sheet" } as const;

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
  if (price === null) return null;
  if (balance >= price) {
    return (
      <p className="text-secondary text-pretty text-label-2">
        {PRICE_ACTIONS[action]} costs <Credits n={price} />. You have <Amount n={balance} />.
      </p>
    );
  }
  return (
    <p role="status" className="text-secondary text-pretty text-label">
      You need <Credits n={price} /> and have <Amount n={balance} />. Add credits to your account to
      continue.
    </p>
  );
}

export const canAfford = (price: number | null, balance: number) =>
  price === null || balance >= price;

/** An error under a control, read out when it appears. */
export function ErrorLine({ id, children }: { id?: string; children: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="swap-in text-secondary text-red">
      {children}
    </p>
  );
}
