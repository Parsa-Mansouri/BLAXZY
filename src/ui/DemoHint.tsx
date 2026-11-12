"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "./cn";

export interface DemoHintProps {
  /** One scene from `@/ui` (TypingScene, DropScene, ...). */
  children: ReactNode;
  className?: string;
  /** Milliseconds to wait before the ambient pass, to stagger sibling cards. */
  delay?: number;
  /**
   * `ambient-then-hover` (default): plays once when the card first scrolls into view, then again
   * on hover and keyboard focus. `hover`: rests on its still frame and plays only on hover/focus.
   */
  trigger?: "ambient-then-hover" | "hover";
  /** Where the scene fades out so the card's label stays readable. Default `bottom`. */
  mask?: "bottom" | "left" | "none";
}

type Play = "idle" | "still" | "run";

/** True while any animation in the scene is still moving (so a hover does not cut a pass short). */
function isPlaying(scene: HTMLElement): boolean {
  if (typeof scene.getAnimations !== "function") return false;
  return scene.getAnimations({ subtree: true }).some((a) => a.playState === "running");
}

/**
 * A demo hint: a quiet animation behind a card's label that shows what the card does. It plays
 * one pass, settles on its last frame, and replays when the card is hovered or focused.
 *
 * Pass it to a card's `demo` slot (QuietTile, FeatureBlock), which makes the card its `demo-host`
 * (frame and hover/focus target). Elsewhere, put it inside any element with the `demo-host` class.
 * The card's label always stays; the scene is decoration:
 *
 *   <QuietTile title="Write a Prompt" demo={<DemoHint><TypingScene lines={[prompt]} /></DemoHint>} />
 *
 * Reduced motion shows the scene's last frame and never moves.
 */
export function DemoHint({
  children,
  className,
  delay = 0,
  trigger = "ambient-then-hover",
  mask = "bottom",
}: DemoHintProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [play, setPlay] = useState<Play>(trigger === "hover" ? "still" : "idle");
  /** Changing the key remounts the scene, which restarts every animation in it. */
  const [pass, setPass] = useState(0);
  const [offscreen, setOffscreen] = useState(false);

  // The ambient pass on first sight, and pausing while off-screen.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer: number | undefined;
    let started = trigger === "hover";
    const start = () => {
      if (started) return;
      started = true;
      timer = window.setTimeout(() => setPlay((p) => (p === "idle" ? "run" : p)), delay);
    };
    if (typeof IntersectionObserver === "undefined") {
      start();
      return () => window.clearTimeout(timer);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        setOffscreen(!entry.isIntersecting);
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) start();
      },
      { threshold: [0, 0.5] },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [delay, trigger]);

  // Replay when the card is hovered (mouse or pen) or takes keyboard focus.
  useEffect(() => {
    const el = ref.current;
    const host = el?.closest<HTMLElement>(".demo-host") ?? el?.parentElement;
    if (!el || !host) return;
    const replay = () => {
      if (isPlaying(el)) return;
      setPass((n) => n + 1);
      setPlay("run");
    };
    const onEnter = (event: PointerEvent) => {
      if (event.pointerType !== "touch") replay();
    };
    const onFocus = () => {
      if (host.matches(":focus-visible") || host.querySelector(":focus-visible")) replay();
    };
    host.addEventListener("pointerenter", onEnter);
    host.addEventListener("focusin", onFocus);
    return () => {
      host.removeEventListener("pointerenter", onEnter);
      host.removeEventListener("focusin", onFocus);
    };
  }, []);

  return (
    <span
      ref={ref}
      aria-hidden="true"
      className={cn("demo-hint", className)}
      data-play={play}
      data-mask={mask}
      data-offscreen={offscreen ? "" : undefined}
    >
      <span key={pass} className="contents">
        {children}
      </span>
    </span>
  );
}
