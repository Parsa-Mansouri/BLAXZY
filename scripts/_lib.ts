/**
 * Shared helpers of the dev scripts: the development-only guard, the `main()` wrapper, the owner
 * lookup by email and the poller of the flow scripts.
 */
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "../src/server/db/client";
import { user } from "../src/server/db/schema";
import { hostOfUrl, isLocalHost } from "../src/server/test-support/local-host";

export { isLocalHost };

/** The host of a database URL (never its credentials), or null when missing or unparseable. */
export function hostOfDatabaseUrl(url: string | undefined): string | null {
  return url ? hostOfUrl(url) : null;
}

/**
 * Refuses to run a dev script against production or a non-local database / object store.
 * tsx leaves NODE_ENV unset, so the host check is what actually protects a machine whose .env
 * points at a real database. `ALLOW_DEV_SCRIPTS=1` overrides the host check (loudly).
 */
export function assertDevOnly(scriptName: string): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error(`${scriptName} must never run with NODE_ENV=production.`);
  }
  const hosts: { what: string; host: string | null }[] = [
    { what: "DATABASE_URL", host: hostOfDatabaseUrl(process.env.DATABASE_URL) },
  ];
  if (process.env.S3_ENDPOINT) {
    hosts.push({ what: "S3_ENDPOINT", host: hostOfUrl(process.env.S3_ENDPOINT) });
  }
  const remote = hosts.filter((h) => h.host !== null && !isLocalHost(h.host));
  const unparseable = hosts.filter((h) => h.host === null && h.what === "DATABASE_URL");
  if (remote.length === 0 && unparseable.length === 0) return;

  const named = [...remote, ...unparseable]
    .map((h) => `${h.what} host "${h.host ?? "unknown"}"`)
    .join(", ");
  if (process.env.ALLOW_DEV_SCRIPTS === "1") {
    console.warn(
      `\n!!! WARNING: ${scriptName} is running against a NON-LOCAL target (${named}) because ` +
        "ALLOW_DEV_SCRIPTS=1 is set. It writes to that database. !!!\n",
    );
    return;
  }
  throw new Error(
    `${scriptName} refuses to run: ${named} is not local. ` +
      "Point .env at the local docker-compose services, or set ALLOW_DEV_SCRIPTS=1 if you really mean it.",
  );
}

/**
 * Runs a script's `main()`: prints the error message and sets a failing exit code, then closes
 * the database (and the job queue, when `queue` is set) whatever happened.
 */
export function runScript(
  main: () => Promise<void>,
  options: { queue?: boolean; onError?: (error: unknown) => void } = {},
): void {
  main()
    .catch((error: unknown) => {
      if (options.onError) options.onError(error);
      else console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (options.queue) {
        const { closeJobQueue } = await import("../src/server/jobs");
        await closeJobQueue();
      }
      await closeDb();
    });
}

/** The id of the user with this email (case-insensitive input), or an explanatory error. */
export async function findOwnerId(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const [owner] = await getDb()
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, normalized));
  if (!owner) {
    throw new Error(`No user ${normalized}. Create it first: pnpm dev:user ${normalized}`);
  }
  return owner.id;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Calls `check` every `intervalMs` until it returns a value (not null); `report` is called with
 * that value and the elapsed seconds (one decimal). Throws `timeoutMessage` after `timeoutMs`.
 * `check` may throw to abort.
 */
export async function pollUntil<T>(options: {
  check: () => Promise<T | null>;
  timeoutMs: number;
  intervalMs: number;
  timeoutMessage: string;
  report?: (value: T, seconds: string) => void;
}): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await options.check();
    if (value !== null) {
      options.report?.(value, ((Date.now() - started) / 1000).toFixed(1));
      return value;
    }
    if (Date.now() - started > options.timeoutMs) throw new Error(options.timeoutMessage);
    await sleep(options.intervalMs);
  }
}
