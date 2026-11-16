import { cn } from "@/ui";

/** Average Geist capital advance and the wordmark's tracking, in em. */
const GLYPH = 0.68;
const TRACK = 0.22;

/**
 * One word set like the wordmark (Geist 600, wide-tracked capitals) and stretched to exactly the
 * width of its box: the spacing, not the letters, takes up the slack. `outline` draws it as a
 * hairline.
 */
export function FitWord({
  word,
  className,
  outline = false,
}: {
  word: string;
  className?: string;
  outline?: boolean;
}) {
  const text = word.toUpperCase();
  const size = 1000 / (text.length * GLYPH + (text.length - 1) * TRACK);
  const height = Math.ceil(size * 0.74) + 2;
  return (
    <svg
      viewBox={`0 0 1000 ${height}`}
      role="img"
      aria-label={word}
      className={cn("block h-auto w-full overflow-visible", className)}
    >
      <text
        x="0"
        y={size * 0.72 + 1}
        textLength="1000"
        lengthAdjust="spacing"
        fontSize={size}
        fontWeight={600}
        fill={outline ? "none" : "currentColor"}
        stroke={outline ? "currentColor" : undefined}
        strokeWidth={outline ? 1 : undefined}
        vectorEffect={outline ? "non-scaling-stroke" : undefined}
        style={{ fontFamily: "var(--font-geist), sans-serif" }}
      >
        {text}
      </text>
    </svg>
  );
}
