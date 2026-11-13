/**
 * Production migration runner: applies the tracked `drizzle/` migrations with drizzle-orm's own
 * migrator. It writes the same journal table as `drizzle-kit migrate`
 * (`drizzle.__drizzle_migrations`, entries matched by hash and timestamp), so a database migrated
 * in development is not migrated twice.
 *
 * A Postgres advisory lock serializes concurrent runs (two deploys, two replicas starting at
 * once). Needs only DATABASE_URL, not the whole app environment. Exit code 0 = up to date,
 * 1 = failed.
 *
 *   pnpm db:migrate:prod        (from source)
 *   node migrate.cjs            (production image, `migrate` target)
 */
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

/** Arbitrary constant every runner agrees on. */
export const MIGRATION_LOCK_KEY = 7_162_538_001;

type Log = (message: string) => void;

export type MigrateOptions = {
  connectionString: string;
  migrationsFolder: string;
  /** How long to wait for another run to finish. */
  lockTimeoutMs?: number;
  log?: Log;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs `fn` while holding the session-level advisory lock on `client`; waits up to `timeoutMs`. */
export async function withAdvisoryLock<T>(
  client: Client,
  key: number,
  timeoutMs: number,
  fn: () => Promise<T>,
  log: Log = () => undefined,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let announced = false;
  for (;;) {
    const { rows } = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1) as locked",
      [key],
    );
    if (rows[0]?.locked) break;
    if (Date.now() >= deadline) {
      throw new Error(`another migration run still holds the lock after ${timeoutMs} ms`);
    }
    if (!announced) {
      log("another migration run holds the lock; waiting");
      announced = true;
    }
    await sleep(250);
  }
  try {
    return await fn();
  } finally {
    await client.query("select pg_advisory_unlock($1)", [key]).catch(() => undefined);
  }
}

/** Number of journal rows (0 before the first migration ever ran). */
async function countApplied(client: Client): Promise<number> {
  const exists = await client.query<{ t: string | null }>(
    "select to_regclass('drizzle.__drizzle_migrations') as t",
  );
  if (!exists.rows[0]?.t) return 0;
  const { rows } = await client.query<{ n: string }>(
    "select count(*)::text as n from drizzle.__drizzle_migrations",
  );
  return Number(rows[0]?.n ?? 0);
}

export async function runMigrations(options: MigrateOptions): Promise<void> {
  const log = options.log ?? ((m: string) => console.info(`[migrate] ${m}`));
  const client = new Client({
    connectionString: options.connectionString,
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  try {
    await withAdvisoryLock(
      client,
      MIGRATION_LOCK_KEY,
      options.lockTimeoutMs ?? 300_000,
      async () => {
        const before = await countApplied(client);
        log(`checking migrations in ${options.migrationsFolder}`);
        await migrate(drizzle(client), { migrationsFolder: options.migrationsFolder });
        const after = await countApplied(client);
        log(
          after === before
            ? "database is up to date, nothing to apply"
            : `applied ${after - before} migration(s)`,
        );
      },
      log,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  await runMigrations({
    connectionString,
    migrationsFolder: path.resolve(process.env.MIGRATIONS_FOLDER ?? "drizzle"),
  });
}

if (typeof require !== "undefined" && require.main === module) {
  main().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(`[migrate] failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
