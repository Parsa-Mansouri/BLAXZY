/** Timecodes for the landing page: pure, so server and client components can both use them. */

export const FPS = 24;
const pad = (n: number) => String(n).padStart(2, "0");

/** Frames as HH:MM:SS:FF at 24 fps. */
export function formatTimecode(frames: number): string {
  const ff = frames % FPS;
  const total = Math.floor(frames / FPS);
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}:${pad(ff)}`;
}
