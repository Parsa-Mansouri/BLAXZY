import type { Scene } from "../../_lib/scenes";

export const sceneDomId = (scene: Scene) => `scene-${scene.key}`;
export const lineButtonId = (blockStart: number) => `comment-on-${blockStart}`;
export const noteFieldId = (commentId: string) => `comment-note-${commentId}`;
export const quoteId = (commentId: string) => `comment-quote-${commentId}`;

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
