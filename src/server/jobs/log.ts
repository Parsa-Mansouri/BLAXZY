type Level = "info" | "warn" | "error";

/** One structured JSON log line (stdout for info, stderr for warn/error). */
export function logLine(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields });
  if (level === "info") console.log(line);
  else console.error(line);
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
