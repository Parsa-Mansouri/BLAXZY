import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "@/server/env";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
/** A transaction handle, as passed to `db.transaction(async (tx) => ...)`. */
export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Either the client or an open transaction, for helpers that may run inside one. */
export type DbExecutor = Db | DbTx;

let pool: Pool | undefined;
let db: Db | undefined;

/** Lazily created singleton drizzle client (one pg Pool per process). */
export function getDb(): Db {
  if (!db) {
    const env = getEnv();
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: env.DATABASE_POOL_MAX,
    });
    db = drizzle(pool, { schema });
  }
  return db;
}

/** Close the pool (used by the worker on shutdown and by tests). */
export async function closeDb(): Promise<void> {
  const p = pool;
  pool = undefined;
  db = undefined;
  await p?.end();
}
