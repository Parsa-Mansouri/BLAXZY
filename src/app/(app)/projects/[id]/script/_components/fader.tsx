"use client";

import { useId } from "react";
import { cn } from "@/ui";

export type FaderStop = -1 | 0 | 1;

const THUMB_W = 14;

/** x of a stop along the track, so the drawn thumb lines up with the native one. */
function stopX(stop: FaderStop): string {
  const t = (stop + 1) / 2;
  return `calc(${THUMB_W / 2}px + (100% - ${THUMB_W}px) * ${t})`;
}

/**
 * A three-stop fader (low, as is, high). A native range input sits invisibly on top, so pointer,
 * touch and arrow keys all work and snap; the track, ticks, fill and thumb are drawn beneath it.
 */
export function Fader({
  name,
  labels,
  value,
  onChange,
  disabled = false,
}: {
  name: string;
  /** Text for the stops at -1, 0 and +1. */
  labels: readonly [string, string, string];
  value: FaderStop;
  onChange: (value: FaderStop) => void;
  disabled?: boolean;
}) {
  const nameId = useId();
  const moved = value !== 0;
  const stops: readonly FaderStop[] = [-1, 0, 1];

  return (
    <div className="flex flex-col gap-2.5 px-4 py-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <span id={nameId} className="text-secondary text-label">
          {name}
        </span>
        <span
          aria-hidden="true"
          className={cn("text-secondary tabular-nums", moved ? "text-brand" : "text-label-3")}
        >
          {labels[value + 1]}
        </span>
      </div>

      <div className="relative h-7">
        {/* Track and ticks. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-label/15"
        />
        {stops.map((s) => (
          <div
            key={s}
            aria-hidden="true"
            style={{ left: stopX(s) }}
            className={cn(
              "absolute top-1/2 w-px -translate-x-1/2 -translate-y-1/2",
              s === 0 ? "h-3 bg-label/60" : "h-2 bg-label/25",
            )}
          />
        ))}
        {/* Fill from the centre to the thumb. */}
        <div
          aria-hidden="true"
          style={{
            left: "50%",
            width: `calc(50% - ${THUMB_W / 2}px)`,
            transform: `translateY(-50%) scaleX(${value})`,
          }}
          className="absolute top-1/2 h-0.5 origin-left bg-brand transition-transform duration-150 motion-reduce:transition-none"
        />
        <input
          type="range"
          min={-1}
          max={1}
          step={1}
          value={value}
          disabled={disabled}
          aria-labelledby={nameId}
          aria-valuetext={labels[value + 1]}
          onChange={(e) => onChange(Number(e.target.value) as FaderStop)}
          className={cn(
            "peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0 disabled:cursor-not-allowed",
            "[&::-moz-range-thumb]:h-7 [&::-moz-range-thumb]:w-[14px] [&::-webkit-slider-thumb]:h-7 [&::-webkit-slider-thumb]:w-[14px] [&::-webkit-slider-thumb]:appearance-none",
          )}
        />
        {/* Thumb. */}
        <div
          aria-hidden="true"
          style={{ left: stopX(value), width: THUMB_W }}
          className={cn(
            "absolute top-0 h-7 -translate-x-1/2 rounded-[3px] transition-[left,background-color] duration-150 motion-reduce:transition-none",
            "peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-ground",
            moved ? "bg-label" : "bg-label-3",
          )}
        />
      </div>

      <div className="flex items-start justify-between font-mono text-meta tracking-caps uppercase">
        {stops.map((s) => (
          <button
            key={s}
            type="button"
            tabIndex={-1}
            disabled={disabled}
            onClick={() => onChange(s)}
            className={cn(
              "min-h-6 py-0.5 transition-colors motion-reduce:transition-none",
              s === -1 ? "text-left" : s === 1 ? "text-right" : "text-center",
              value === s ? "text-label" : "text-label-3 hover:text-label-2",
            )}
          >
            {labels[s + 1]}
          </button>
        ))}
      </div>
    </div>
  );
}
