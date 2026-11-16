import { useId } from "react";
import { cn } from "@/ui";

/** The four bands, top to bottom, in the mark's 100-unit box: one per stage. */
const BANDS: readonly [number, number][] = [
  [12, 27.25],
  [32.25, 47.5],
  [52.5, 67.75],
  [72.75, 88],
];

/**
 * The BLAXZY mark: a play triangle cut into four solid bands, the four stages adding up to a
 * film. Drawn in `currentColor`.
 */
export function Mark({ className, title }: { className?: string; title?: string }) {
  const clip = useId();
  return (
    <svg
      viewBox="0 0 100 100"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn("block", className)}
    >
      <defs>
        <clipPath id={clip}>
          <polygon points="18,12 18,88 88,50" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`} fill="currentColor">
        {BANDS.map(([top, bottom]) => (
          <rect key={top} x="0" y={top} width="100" height={bottom - top} />
        ))}
      </g>
    </svg>
  );
}
