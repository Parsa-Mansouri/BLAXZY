"use client";

import { useEffect, useRef } from "react";

export interface LoopVideoProps {
  id?: string;
  src: string;
  poster: string;
  className?: string;
  /** Play only while on screen (for videos further down the page). */
  onSight?: boolean;
}

/**
 * A muted, looping, decorative film. Under reduced motion it stays on its poster frame; with
 * `onSight` it plays only while it is in view.
 */
export function LoopVideo({ id, src, poster, className, onSight = false }: LoopVideoProps) {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = !onSight;

    const apply = () => {
      if (reduced.matches || !visible) el.pause();
      else void el.play().catch(() => undefined);
    };

    const observer = onSight
      ? new IntersectionObserver(([entry]) => {
          visible = entry?.isIntersecting ?? false;
          apply();
        })
      : null;
    observer?.observe(el);

    apply();
    reduced.addEventListener("change", apply);
    return () => {
      reduced.removeEventListener("change", apply);
      observer?.disconnect();
    };
  }, [onSight]);

  return (
    <video
      ref={video}
      id={id}
      aria-hidden="true"
      className={className}
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      preload={onSight ? "metadata" : "auto"}
    />
  );
}
