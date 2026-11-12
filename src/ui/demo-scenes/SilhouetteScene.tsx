import type { CSSProperties } from "react";
import { cn } from "../cn";

export interface SilhouetteSceneProps {
  /**
   * The asset kind to sketch: character, location, prop, voice, creature, costume or other.
   * Any other string falls back to `other` (a plain box), so a new kind never breaks a card.
   */
  kind: string;
  className?: string;
}

/** One stroke of a sketch: path data in an 80x80 box and whether it is lightly filled. */
interface Piece {
  d: string;
  fill?: boolean;
}

const SKETCHES: Record<string, readonly Piece[]> = {
  // Shoulders first, then the neck, then the head settles on top.
  character: [
    { d: "M12 76c0-16 10-24 28-24s28 8 28 24", fill: true },
    { d: "M34 52v-6h12v6" },
    { d: "M40 12a13 15 0 1 0 0.01 0z", fill: true },
  ],
  // Ground, a rise of land, then the lighthouse and its lamp.
  location: [
    { d: "M4 66h72" },
    { d: "M4 66c14-14 26-16 40-8s22 4 32 8", fill: true },
    { d: "M32 58 36 22h8l4 36z", fill: true },
    { d: "M34 22h12l-6-9z" },
    { d: "M22 18h-6M64 18h-6M24 9l-4-3M56 9l4-3" },
  ],
  // A lantern: handle, frame, base.
  prop: [
    { d: "M30 26c0-14 20-14 20 0" },
    { d: "M26 26h28v34H26z", fill: true },
    { d: "M22 60h36v8H22z" },
    { d: "M40 34v18" },
  ],
  voice: [
    "M10 40v0",
    "M18 32v16",
    "M26 22v36",
    "M34 28v24",
    "M42 14v52",
    "M50 26v28",
    "M58 32v16",
    "M66 36v8",
  ].map((d) => ({ d })),
  // A sitting cat-like animal: body, head, ears, tail.
  creature: [
    { d: "M18 70c-4-20 4-34 20-34s24 14 20 34z", fill: true },
    { d: "M40 12a12 12 0 1 0 0.01 0z", fill: true },
    { d: "M30 16 28 4l8 6zM50 16l2-12-8 6" },
    { d: "M58 66c10 0 14-8 10-18" },
  ],
  // A jacket on a hanger.
  costume: [
    { d: "M40 22v-6a5 5 0 1 0-5-5" },
    { d: "M40 22 8 42h64z" },
    { d: "M20 42 14 72h52l-6-30", fill: true },
    { d: "M40 42v30" },
  ],
  // A plain box in outline.
  other: [
    { d: "M40 10 68 24v32L40 70 12 56V24z", fill: true },
    { d: "M12 24l28 14 28-14M40 38v32" },
  ],
};

/**
 * A faint schematic of what an empty slot will hold, built up piece by piece: a figure for a
 * character, a coastline with a lighthouse for a location, a lantern for a prop, a waveform for
 * a voice. Last frame: the whole silhouette at rest.
 */
export function SilhouetteScene({ kind, className }: SilhouetteSceneProps) {
  const pieces = SKETCHES[kind] ?? SKETCHES.other ?? [];
  return (
    <span className={cn("demo-scene demo-sil", className)}>
      <svg
        className="demo-sil-art"
        viewBox="0 0 80 80"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        preserveAspectRatio="xMidYMid meet"
      >
        {pieces.map((piece, i) => (
          <path
            key={i}
            d={piece.d}
            className={cn("demo-sil-piece", piece.fill && "demo-sil-fill")}
            style={{ "--demo-i": i } as CSSProperties}
          />
        ))}
      </svg>
    </span>
  );
}
