/**
 * Development / QA only: proves that a worker killed mid-job leaves nothing half-done.
 *
 *   pnpm qa:crash
 *
 * Runs against the local docker-compose services (the same guard as the other dev scripts) and
 * makes no paid call: the worker child runs with DAMI_MODE=sample and GENERATION_PROVIDER=sample,
 * and any FAULT_INJECT of the caller is not passed on.
 *
 * 1. Creates a fresh user with credits, a project with a style, one script generation (a dami
 *    run) and two look generations (credit reservations).
 * 2. Starts a worker child process; when a dami run and a generation are mid-flight it marks the
 *    active queue jobs as being on their last attempt and SIGKILLs the worker (no shutdown hook
 *    runs, like a crash or an OOM kill). Their attempts are then made expirable at once, so the
 *    queue's maintenance fails them for good without ever running a handler again.
 * 3. Restarts the worker, lets the queue settle, then runs both sweeps (`generation.sweep` and
 *    `dami.sweep` work) with the touched rows aged past their thresholds.
 * 4. Checks that every touched domain row is in a final state and that the credit ledger
 *    balances, prints a PASS/FAIL table and exits non-zero on any FAIL.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { getBalance, grantCredits } from "../src/server/billing";
import { getDb } from "../src/server/db/client";
import {
  creditBalance,
  creditLedger,
  damiRun,
  generation,
  scriptVersion,
  user,
} from "../src/server/db/schema";
import { getEnv } from "../src/server/env";
import {
  onGenerationFinished,
  quoteGeneration,
  requestGeneration,
  sweepStuckGenerations,
} from "../src/server/generation";
import { sweepStuckDamiRuns } from "../src/server/damis";
import { saveStyle, createProject } from "../src/server/projects";
import { startFromBrief } from "../src/server/script";
import { generationHooks } from "../worker/handlers";
import { assertDevOnly, pollUntil, runScript, sleep } from "./_lib";

const SLOW_MS = 60_000;
const FAST_MS = 500;
const ROOT = process.cwd();

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const record = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

/** The worker as a plain node process (not through pnpm/tsx wrappers), so SIGKILL hits the worker itself. */
function startWorkerProcess(sampleDelayMs: number): { child: ChildProcess; ready: Promise<void> } {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DAMI_MODE: "sample",
    DAMI_SAMPLE_DELAY_MS: String(sampleDelayMs),
    GENERATION_PROVIDER: "sample",
    GENERATION_SAMPLE_DELAY_MS: String(sampleDelayMs),
  };
  delete env.FAULT_INJECT; // faults are the other test's business; this one tests crashes
  const child = spawn(process.execPath, ["--import", "tsx", "worker/index.ts"], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const ready = new Promise<void>((resolveReady, rejectReady) => {
    child.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("worker started")) resolveReady();
    });
    child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(`  [worker] ${chunk}`));
    child.once("exit", (code) => rejectReady(new Error(`worker exited early (code ${code})`)));
  });
  return { child, ready };
}

function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((r) => child.once("exit", () => r()));
}

type JobCounts = Record<string, number>;

async function openJobs(since: Date): Promise<JobCounts> {
  const schema = sql.raw(getEnv().JOBS_SCHEMA);
  const result = await getDb().execute<{ state: string; n: number }>(
    sql`SELECT state, count(*)::int AS n FROM ${schema}.job
        WHERE created_on >= ${since.toISOString()}
          AND name NOT LIKE '%.sweep' AND name NOT LIKE '__pgboss__%'
          AND state IN ('created', 'retry', 'active')
        GROUP BY state`,
  );
  return Object.fromEntries(result.rows.map((r) => [r.state, r.n]));
}

async function main(): Promise<void> {
  assertDevOnly("qa:crash");
  const startedAt = new Date(Date.now() - 5_000);
  const schema = sql.raw(getEnv().JOBS_SCHEMA);
  const db = getDb();

  // 1. Work to interrupt.
  const userId = `qa-crash-${randomUUID()}`;
  await db.insert(user).values({ id: userId, name: "QA crash", email: `${userId}@example.test` });
  await grantCredits({ userId, amount: 500, note: "qa:crash" });
  const style = {
    visualStyle: "Cinematic live-action",
    genre: "Drama",
    format: "movie" as const,
    orientation: "landscape" as const,
    totalDurationSeconds: 120,
  };
  const created = await createProject({
    ownerId: userId,
    title: `QA crash ${new Date().toISOString()}`,
  });
  await saveStyle({ projectId: created.id, userId, style });
  const projectId = created.id;
  console.log(`User ${userId}, project ${projectId}`);

  const first = startWorkerProcess(SLOW_MS);
  await first.ready;
  console.log("Worker 1 started (slow sample delays).");

  await startFromBrief({
    projectId,
    userId,
    brief: "An old fisherman finds a map in a bottle and must decide whether to follow it.",
  });
  const quote = await quoteGeneration({ purpose: "asset_look", style });
  for (const label of ["Tomas", "Maren"]) {
    await requestGeneration({
      userId,
      projectId,
      purpose: "asset_look",
      prompt: `${label}, a character portrait`,
      label,
      style,
      maxCredits: quote.priceCredits,
    });
  }

  // 2. Wait until work is mid-flight, then crash the worker on the "last attempt".
  await pollUntil({
    check: async () => {
      const [runs] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(damiRun)
        .where(sql`${damiRun.projectId} = ${projectId} and ${damiRun.status} = 'running'`);
      const [gens] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(generation)
        .where(sql`${generation.projectId} = ${projectId} and ${generation.status} = 'running'`);
      return (runs?.n ?? 0) > 0 && (gens?.n ?? 0) > 0 ? true : null;
    },
    timeoutMs: 90_000,
    intervalMs: 500,
    timeoutMessage: "Timed out waiting for a dami run and a generation to be running.",
    report: (_v, seconds) => console.log(`Mid-flight after ${seconds} s.`),
  });
  await db.execute(
    sql`UPDATE ${schema}.job SET retry_count = retry_limit
        WHERE state = 'active' AND created_on >= ${startedAt.toISOString()}
          AND name NOT LIKE '%.sweep' AND name NOT LIKE '__pgboss__%'`,
  );
  first.child.kill("SIGKILL");
  await exited(first.child);
  console.log("Worker 1 SIGKILLed mid-job, its active attempts marked as the last.");
  // The attempts only expire after minutes; make them expirable now.
  await db.execute(
    sql`UPDATE ${schema}.job SET started_on = now() - interval '2 days',
          heartbeat_on = CASE WHEN heartbeat_on IS NULL THEN NULL ELSE now() - interval '2 days' END
        WHERE state = 'active' AND created_on >= ${startedAt.toISOString()}
          AND name NOT LIKE '%.sweep' AND name NOT LIKE '__pgboss__%'`,
  );

  // 3. Restart, let the queue settle, sweep.
  const second = startWorkerProcess(FAST_MS);
  await second.ready;
  console.log("Worker 2 started; waiting for the queue to settle...");
  const settled = await pollUntil({
    check: async () => {
      const open = await openJobs(startedAt);
      return Object.keys(open).length === 0 ? open : null;
    },
    timeoutMs: 180_000,
    intervalMs: 2_000,
    timeoutMessage: "The queue did not settle in 180 s (continuing with the checks).",
  }).catch((error: unknown) => {
    console.warn(error instanceof Error ? error.message : error);
    return null;
  });
  record(
    "queue settled (no created/retry/active jobs)",
    settled !== null,
    settled ? "empty" : "jobs still open",
  );

  // Age the touched rows past the sweep thresholds (the sweeps are global, so rows are aged
  // instead of faking the clock, which would also hit other people's rows).
  await db.execute(
    sql`UPDATE dami_run SET started_at = now() - interval '3 hours'
        WHERE project_id = ${projectId} AND status IN ('queued', 'running')`,
  );
  await db.execute(
    sql`UPDATE generation SET created_at = now() - interval '3 hours',
          started_at = CASE WHEN started_at IS NULL THEN NULL ELSE now() - interval '3 hours' END
        WHERE project_id = ${projectId} AND status IN ('queued', 'running')`,
  );
  for (const hook of generationHooks) onGenerationFinished(hook);
  const gens = await sweepStuckGenerations({ userId });
  const dami = await sweepStuckDamiRuns();
  console.log(
    `Sweeps: generations failed ${gens.failed.length}, requeued ${gens.requeued.length}, ` +
      `renotified ${gens.renotified.length}; dami runs swept ${dami.swept}.`,
  );
  await sleep(5_000); // requeued runs get a moment on the live worker
  second.child.kill("SIGTERM");
  await Promise.race([exited(second.child), sleep(30_000)]);
  if (second.child.exitCode === null && second.child.signalCode === null)
    second.child.kill("SIGKILL");

  // 4. Checks.
  const FINAL_GENERATION = ["succeeded", "failed", "cancelled"];
  const gensRows = await db.select().from(generation).where(eq(generation.userId, userId));
  const stuckGens = gensRows.filter((g) => !FINAL_GENERATION.includes(g.status));
  record(
    "generations are final",
    gensRows.length > 0 && stuckGens.length === 0,
    `${gensRows.length} rows: ` +
      Object.entries(Object.groupBy(gensRows, (g) => g.status))
        .map(([status, rows]) => `${rows?.length} ${status}`)
        .join(", "),
  );

  const scripts = await db
    .select()
    .from(scriptVersion)
    .where(eq(scriptVersion.projectId, projectId));
  const pendingScripts = scripts.filter((s) => s.status === "pending");
  record(
    "script versions are not pending",
    scripts.length > 0 && pendingScripts.length === 0,
    scripts.map((s) => s.status).join(", ") || "none",
  );

  const runs = await db.select().from(damiRun).where(eq(damiRun.projectId, projectId));
  const openRuns = runs.filter((r) => r.status === "queued" || r.status === "running");
  record(
    "dami runs are final",
    runs.length > 0 && openRuns.length === 0,
    runs.map((r) => r.status).join(", ") || "none",
  );

  const ledger = await db.select().from(creditLedger).where(eq(creditLedger.userId, userId));
  const reserved = ledger.filter((e) => e.type === "reserve");
  const closedIds = new Set(
    ledger.filter((e) => e.type === "settle" || e.type === "refund").map((e) => e.generationId),
  );
  const reservedTotal = -reserved.reduce((sum, e) => sum + e.amount, 0);
  const settledTotal = reserved
    .filter((e) => ledger.some((s) => s.type === "settle" && s.generationId === e.generationId))
    .reduce((sum, e) => sum - e.amount, 0);
  const refundedTotal = ledger.filter((e) => e.type === "refund").reduce((s, e) => s + e.amount, 0);
  record(
    "ledger: reserved = settled + refunded",
    reservedTotal === settledTotal + refundedTotal,
    `reserved ${reservedTotal}, settled ${settledTotal}, refunded ${refundedTotal}`,
  );
  const unclosed = reserved.filter((e) => !closedIds.has(e.generationId));
  record("ledger: every reservation is closed", unclosed.length === 0, `${unclosed.length} open`);
  const mismatched = gensRows.filter((g) => {
    const types = ledger.filter((e) => e.generationId === g.id).map((e) => e.type);
    return g.status === "succeeded"
      ? !types.includes("settle")
      : g.status === "failed" || g.status === "cancelled"
        ? !types.includes("refund")
        : false;
  });
  record(
    "ledger: outcome matches each generation",
    mismatched.length === 0,
    `${mismatched.length} mismatched`,
  );
  const ledgerSum = ledger.reduce((sum, e) => sum + e.amount, 0);
  const [stored] = await db.select().from(creditBalance).where(eq(creditBalance.userId, userId));
  const balance = await getBalance(userId);
  record(
    "balance matches the ledger",
    ledgerSum === balance && stored?.balance === balance,
    `ledger sum ${ledgerSum}, balance ${balance}`,
  );

  const width = Math.max(...checks.map((c) => c.name.length));
  console.log("\nResult");
  for (const c of checks) {
    console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name.padEnd(width)}  ${c.detail}`);
  }
  const failed = checks.filter((c) => !c.ok);
  console.log(
    failed.length === 0 ? "\nPASS" : `\nFAIL (${failed.length} of ${checks.length} checks)`,
  );
  if (failed.length > 0) process.exitCode = 1;
}

runScript(main, { queue: true });
