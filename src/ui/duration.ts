/** Pure helpers for film durations. All values are whole seconds. */

export interface DurationParts {
  minutes: number;
  seconds: number;
}

export function splitDuration(totalSeconds: number): DurationParts {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return { minutes: Math.floor(safe / 60), seconds: safe % 60 };
}

export function joinDuration(minutes: number, seconds: number): number {
  return Math.max(0, Math.floor(minutes)) * 60 + Math.max(0, Math.floor(seconds));
}

/** 90 -> "1:30", 3725 -> "62:05". */
export function formatDuration(totalSeconds: number): string {
  const { minutes, seconds } = splitDuration(totalSeconds);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** 90 -> "1 min 30 s", 60 -> "1 min", 45 -> "45 s". */
export function formatDurationLong(totalSeconds: number): string {
  const { minutes, seconds } = splitDuration(totalSeconds);
  if (minutes === 0) return `${seconds} s`;
  if (seconds === 0) return `${minutes} min`;
  return `${minutes} min ${seconds} s`;
}

/**
 * Parses what people actually type: "1:30", "90", "1m 30s", "2 min", "45s", "1h 5m".
 * A bare number counts as seconds. Returns null when it cannot be understood.
 */
export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;

  const colon = /^(\d+):(\d{1,2})$/.exec(text);
  if (colon) {
    const seconds = Number(colon[2]);
    if (seconds > 59) return null;
    return Number(colon[1]) * 60 + seconds;
  }

  if (/^\d+$/.test(text)) return Number(text);

  const unit =
    /^(?:(\d+)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?\s*(?:(\d+)\s*s(?:ec(?:ond)?s?)?)?$/.exec(
      text,
    );
  if (unit && (unit[1] || unit[2] || unit[3])) {
    return Number(unit[1] ?? 0) * 3600 + Number(unit[2] ?? 0) * 60 + Number(unit[3] ?? 0);
  }
  return null;
}

export function clampDuration(totalSeconds: number, min?: number, max?: number): number {
  let value = totalSeconds;
  if (min !== undefined) value = Math.max(min, value);
  if (max !== undefined) value = Math.min(max, value);
  return value;
}
