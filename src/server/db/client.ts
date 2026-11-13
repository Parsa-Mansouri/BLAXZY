import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "@/server/env";
import { errorMessage, logLine } from "@/server/jobs/log";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
/** A transaction handle, as passed to `db.transaction(async (tx) => ...)`. */
export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Either the client or an open transaction, for helpers that may run inside one. */
export type DbExecutor = Db | DbTx;

/*
 * Connection limits. Constants (not configuration): they are safety nets, far above anything the
 * code needs today. The longest transactions hold a row lock around a few short statements (the
 * generation claim, credit reservations, block replacement); no transaction waits on the network
 * (provider calls, object storage, Claude) any more. The longest single statements are list
 * queries and block replacement, well under a second on real data. pg-boss uses its own pool.
 */
/** Waiting for a free connection (or a new one) longer than this fails the query. */
const CONNECTION_TIMEOUT_MS = 10_000;
/** A statement running longer than this is cancelled by Postgres. */
const STATEMENT_TIMEOUT_MS = 120_000;
/**
 * A transaction left idle (the app awaiting something else while it holds locks) longer than this
 * is ended by Postgres, which releases its locks and its connection.
 */
const IDLE_IN_TRANSACTION_TIMEOUT_MS = 5 * 60_000;
/** Idle pooled connections are closed after this. */
const IDLE_TIMEOUT_MS = 30_000;

let applicationName = "blaxzy";

/**
 * Names this process's connections in `pg_stat_activity` (the worker calls it at startup). Only
 * affects a pool created afterwards.
 */
export function setDbApplicationName(name: string): void {
  applicationName = name;
}

type DbState = { pool: Pool; db: Db };

/*
 * The singleton lives on globalThis outside production, so a Next dev hot reload (which evaluates
 * this module again) reuses the pool instead of leaking a new one each time.
 */
const holder = globalThis as typeof globalThis & { __blaxzyDb?: DbState };
let state: DbState | undefined =
  process.env.NODE_ENV === "production" ? undefined : holder.__blaxzyDb;

function createState(): DbState {
  const env = getEnv();
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_TIMEOUT_MS,
    application_name: applicationName,
    keepAlive: true,
  });
  // An idle connection that breaks (database restart, network) emits here; without a listener
  // it would be an uncaught exception that kills the process. The pool drops the client itself.
  pool.on("error", (err) => logLine("error", "database pool error", { error: errorMessage(err) }));
  return { pool, db: drizzle(pool, { schema }) };
}

/** Lazily created singleton drizzle client (one pg Pool per process). */
export function getDb(): Db {
  if (!state) {
    state = createState();
    if (process.env.NODE_ENV !== "production") holder.__blaxzyDb = state;
  }
  return state.db;
}

/** Close the pool (used by the worker on shutdown and by tests). */
export async function closeDb(): Promise<void> {
  const current = state;
  state = undefined;
  if (holder.__blaxzyDb === current) holder.__blaxzyDb = undefined;
  await current?.pool.end();
}
