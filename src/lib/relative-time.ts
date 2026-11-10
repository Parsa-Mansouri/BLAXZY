const UNITS: ReadonlyArray<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
  { unit: "year", seconds: 365 * 24 * 3600 },
  { unit: "month", seconds: 30 * 24 * 3600 },
  { unit: "week", seconds: 7 * 24 * 3600 },
  { unit: "day", seconds: 24 * 3600 },
  { unit: "hour", seconds: 3600 },
  { unit: "minute", seconds: 60 },
];

const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "just now", "5 minutes ago", "yesterday", "3 weeks ago". */
export function formatRelativeTime(date: Date | string, now: Date = new Date()): string {
  const then = typeof date === "string" ? new Date(date) : date;
  const diff = Math.round((then.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diff);
  if (abs < 45) return "just now";
  for (const { unit, seconds } of UNITS) {
    if (abs >= seconds) return formatter.format(Math.round(diff / seconds), unit);
  }
  return formatter.format(Math.round(diff / 60), "minute");
}
