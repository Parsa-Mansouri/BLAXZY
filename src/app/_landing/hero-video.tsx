"use client";

import { useEffect, useRef } from "react";

/**
 * The landing's full-bleed background film: muted, looping, decorative. Under reduced motion it
 * stays on its poster frame.
 */
export function HeroVideo() {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      if (query.matches) el.pause();
      else void el.play().catch(() => undefined);
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  return (
    <video
      ref={video}
      aria-hidden="true"
      className="absolute inset-0 -z-10 size-full object-cover object-[30%_center]"
      src="/landing/hero.mp4"
      poster="/landing/hero.jpg"
      muted
      loop
      playsInline
      preload="auto"
    />
  );
}
