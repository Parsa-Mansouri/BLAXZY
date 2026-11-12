/**
 * The frame a clip plays in on the clip review: a box of the film's shape, as large as the space
 * allows. `--frame-h` is the height the viewport leaves for the picture (below the toolbar, the
 * page header, the shot's title and the control bar; at least 18rem); the frame's width is the
 * smaller of its column and what that height allows. Class names are literal so Tailwind sees
 * them. Set `FRAME_HEIGHT` on the element that holds the frame (or on the frame itself).
 */
export const FRAME_HEIGHT = "[--frame-h:max(18rem,calc(100dvh-var(--toolbar-h)-19rem))]";

export const FRAME_BOX = {
  landscape: "mx-auto aspect-video w-[min(100%,calc(var(--frame-h)*16/9))]",
  portrait: "mx-auto aspect-[9/16] w-[min(100%,calc(var(--frame-h)*9/16))]",
} as const;

/** The control bar under the frame: as wide as the frame (an upright frame: at least 22rem). */
export const CONTROLS_BOX = {
  landscape: "mx-auto w-[min(100%,calc(var(--frame-h)*16/9))]",
  portrait: "mx-auto w-full max-w-[max(22rem,calc(var(--frame-h)*9/16))]",
} as const;
