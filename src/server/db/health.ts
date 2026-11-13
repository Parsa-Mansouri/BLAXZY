import { sql } from "drizzle-orm";
import { getDb } from "./client";

/**
 * True when `select 1` succeeds within `timeoutMs`. Never throws and never exposes the reason
 * for a failure (the health endpoint must not leak details).
 */
export async function isDatabaseHealthy(timeoutMs = 2000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const query = Promise.resolve()
    .then(() => getDb().execute(sql`select 1`))
    .then(() => true as const);
  // A query that loses the race must not become an unhandled rejection.
  query.catch(() => undefined);
  try {
    return await Promise.race([query, timeout]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
