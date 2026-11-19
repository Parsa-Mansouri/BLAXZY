import { currentRequestId } from "@/server/observability/scope";
import { forwardLogLine } from "@/server/observability/tracker";

type Level = "info" | "warn" | "error";

/**
 * One structured JSON log line (stdout for info, stderr for warn/error). Importable from the web
 * server and the worker.
 *
 * - Inside a request (server action, route handler) the line carries its `requestId`.
 * - `exception`: the original error. Not printed as is: the line gets its message as `error`
 *   (unless one is given) and its `stack`; the tracker gets it with its stack.
 * - Level "error" lines, and any line with `alert: true`, go to the error tracker as well
 *   (`alert` on a warn line raises a warning). A no-op when tracking is off.
 */
export function logLine(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  const { exception, ...rest } = fields;
  const printed: Record<string, unknown> = { ...rest };
  if (exception !== undefined) {
    printed.error ??= errorMessage(exception);
    if (exception instanceof Error && printed.stack === undefined) printed.stack = exception.stack;
  }
  const requestId = currentRequestId();
  if (requestId !== undefined && printed.requestId === undefined) printed.requestId = requestId;
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...printed });
  if (level === "info") console.log(line);
  else console.error(line);
  forwardLogLine(level, msg, printed, exception);
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
