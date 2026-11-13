import { formatNumber } from "@/app/(app)/_lib/format";

/** "1 shot", "7 shots". */
export const shotsWords = (n: number) => `${formatNumber(n)} ${n === 1 ? "shot" : "shots"}`;

/** A clock reading such as 0:07 or 1:05. */
export function clock(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
