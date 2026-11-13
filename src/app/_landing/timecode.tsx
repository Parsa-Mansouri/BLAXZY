"use client";

import { useEffect, useState } from "react";
import { FPS, formatTimecode } from "./timecode-format";

/** `REEL 01 · 00:00:00:00`, ticking at 24 fps; frozen under reduced motion. */
export function Timecode({ className }: { className?: string }) {
  const [frames, setFrames] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const start = performance.now();
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      const frame = Math.floor(((now - start) / 1000) * FPS);
      if (frame !== last) {
        last = frame;
        setFrames(frame);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <p className={className} aria-hidden="true">
      REEL 01 · {formatTimecode(frames)}
    </p>
  );
}
