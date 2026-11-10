import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "@/server/env";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

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
