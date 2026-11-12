import type { CSSProperties } from "react";
import { cn } from "../cn";

export interface WaveformSceneProps {
  /** Number of bars. Default 28. */
  bars?: number;
  /** Where the waveform sits: centred, or against the right edge. */
  align?: "center" | "end";
  className?: string;
}

/** A believable speech envelope: bar heights between 0.18 and 1, the same on every render. */
function envelope(count: number): number[] {
  return Array.from({ length: count }, (_, i) => {
    const swell = Math.abs(Math.sin(i * 0.55 + 0.6)) * (0.55 + 0.45 * Math.cos(i * 0.21));
    const grain = 0.5 + 0.5 * Math.sin(i * 2.3);
    return Math.round((0.18 + 0.82 * Math.min(1, swell * 0.8 + grain * 0.2)) * 100) / 100;
  });
}

/**
 * Bars rising one after another like someone speaking, then settling into a still waveform.
 * Last frame: the finished waveform.
 */
export function WaveformScene({ bars = 28, align = "center", className }: WaveformSceneProps) {
  return (
    <span className={cn("demo-scene demo-wave", align === "end" && "demo-wave-end", className)}>
      {envelope(bars).map((height, i) => (
        <span
          key={i}
          className="demo-wave-bar"
          style={{ "--demo-h": height, "--demo-i": i } as CSSProperties}
        />
      ))}
    </span>
  );
}
