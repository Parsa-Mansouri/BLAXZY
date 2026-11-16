/**
 * Development only: runs Production through the real queue and a running worker.
 *
 *   pnpm worker                          # in another terminal (same JOBS_SCHEMA)
 *   pnpm dev:production-flow [email] [project title]   # default testuser@gmail.com, "QA Run 14:03"
 *
 * On the user's project (default "QA Run 14:03"; already in production, with ready assets and blocks):
 * tops up credits if needed; prepares every block, approves them all, confirms the quote and starts
 * the drafts; rejects the first draft with one issue and waits for its fix; accepts every draft,
 * waits for the finals and accepts them, except the finals of the last two blocks, which stay in
 * review so the review screens can be tried. Prints the overview at each step, the credits before
 * and after, and timings. Never completes the stage. Works in sample mode.
 */
import "dotenv/config";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getBalance, grantCredits } from "../src/server/billing";
import { getDamiMode } from "../src/server/damis";
import { getDb } from "../src/server/db/client";
import { project } from "../src/server/db/schema";
import * as productionModule from "../src/server/production";
import {
  PRODUCTION_SPEND_FUNCTIONS,
  autoConfirm,
} from "../src/server/test-support/confirm-fixtures";
import {
  approveAllBlocks,
  ensurePrepared,
  getBlockDetail,
  getProductionOverview,
  listProductionBlocks,
  quoteProduction,
  startDrafts,
  type BlockProductionStage,
  type ProductionBlock,
  type ProductionOverview,
} from "../src/server/production";
import { assertDevOnly, findOwnerId, pollUntil, runScript } from "./_lib";

/** A take decision that spends confirms the current price on its own (the dialog's job). */
const { submitTakeReview } = autoConfirm(productionModule, PRODUCTION_SPEND_FUNCTIONS);

const PROJECT_TITLE = process.argv[3] ?? "QA Run 14:03";
/** Seven drafts (20 each), one fixed draft, seven finals (60 each), plus room. */
const CREDITS_NEEDED = 650;
const TIMEOUT_MS = 10 * 60 * 1000;
const startedAt = Date.now();
const elapsed = () => `${((Date.now() - startedAt) / 1000).toFixed(1)} s`;

const BUSY: readonly BlockProductionStage[] = ["preparing", "draft_generating", "final_generating"];

function describeOverview(o: ProductionOverview): string {
  const counts = Object.entries(o.counts)
    .filter(([, n]) => n > 0)
    .map(([stage, n]) => `${stage}=${n}`)
    .join(" ");
  return `phase ${o.phase} | ${counts} | canStartDrafts ${o.canStartDrafts} canComplete ${o.canComplete}`;
}

async function overview(projectId: string, userId: string): Promise<ProductionOverview> {
  const o = await getProductionOverview(projectId, userId);
  if (!o) throw new Error("getProductionOverview returned null");
  return o;
}

async function allBlocks(projectId: string, userId: string): Promise<ProductionBlock[]> {
  const items: ProductionBlock[] = [];
  let cursor: string | null = null;
  do {
    const page: Awaited<ReturnType<typeof listProductionBlocks>> = await listProductionBlocks(
      projectId,
      userId,
      { limit: 100, cursor },
    );
    if (!page) throw new Error("listProductionBlocks returned null");
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

async function printBlocks(projectId: string, userId: string): Promise<void> {
  for (const b of await allBlocks(projectId, userId)) {
    const refs = b.assets.map((a) => a.ref).join(", ");
    console.log(
      `     B${String(b.orderIndex + 1).padStart(2, "0")} ${b.stage.padEnd(16)} ${(b.title ?? "").slice(0, 40).padEnd(40)} [${refs}]`,
    );
  }
}

/** Waits until no block is preparing or generating; fails on a failed preparation or take. */
async function settle(label: string, projectId: string, userId: string): Promise<void> {
  await pollUntil({
    check: async () => {
      const o = await overview(projectId, userId);
      if (o.counts.prepare_failed > 0 || o.counts.failed > 0) {
        const failed = (await allBlocks(projectId, userId)).filter(
          (b) => b.stage === "prepare_failed" || b.stage === "failed",
        );
        for (const b of failed) {
          const detail = await getBlockDetail(b.lineageId, userId);
          console.log(`     ${b.title}: ${b.failure ?? detail?.takes[0]?.failure ?? "unknown"}`);
        }
        throw new Error(`${label}: some blocks failed`);
      }
      return BUSY.every((stage) => o.counts[stage] === 0) ? o : null;
    },
    timeoutMs: TIMEOUT_MS,
    intervalMs: 1000,
    timeoutMessage: `Timed out waiting for: ${label}. Is \`pnpm worker\` running?`,
    report: (o, seconds) => {
      console.log(`   ${label} after ${seconds} s`);
      console.log(`   overview: ${describeOverview(o)}`);
    },
  });
}

async function latestTakeId(lineageId: string, userId: string): Promise<string> {
  const detail = await getBlockDetail(lineageId, userId);
  const id = detail?.takes[0]?.id;
  if (!id) throw new Error(`Block ${lineageId} has no take.`);
  return id;
}

async function main(): Promise<void> {
  assertDevOnly("dev:production-flow");
  if (getDamiMode() !== "sample") {
    throw new Error("dev:production-flow runs in sample mode only (DAMI_MODE=sample).");
  }
  const email = (process.argv[2] ?? "testuser@gmail.com").toLowerCase();
  const db = getDb();
  const userId = await findOwnerId(email);
  const [found] = await db
    .select({ id: project.id, stage: project.stage })
    .from(project)
    .where(
      and(
        eq(project.ownerId, userId),
        eq(project.title, PROJECT_TITLE),
        isNull(project.archivedAt),
      ),
    )
    .orderBy(desc(project.createdAt))
    .limit(1);
  if (!found) {
    throw new Error(
      `${email} has no project titled "${PROJECT_TITLE}". Take a project through pre-production first.`,
    );
  }
  if (found.stage !== "production") {
    throw new Error(`"${PROJECT_TITLE}" is at stage ${found.stage}, not production.`);
  }
  const projectId = found.id;
  console.log(
    `Dami mode: ${getDamiMode()} | queue schema: ${process.env.JOBS_SCHEMA ?? "(default)"}`,
  );
  console.log(`Project "${PROJECT_TITLE}" ${projectId} (stage ${found.stage})`);

  const before = await getBalance(userId);
  console.log(`Credits before: ${before}`);
  // A directed script has many blocks: a draft and a final each (60 credits a final).
  const blockCount = (await overview(projectId, userId))?.blockCount ?? 0;
  const needed = Math.max(CREDITS_NEEDED, blockCount * 100);
  if (before < needed) {
    const balance = await grantCredits({
      userId,
      amount: needed - before,
      note: "dev:production-flow",
    });
    console.log(`   granted ${needed - before}; balance ${balance}`);
  }
  console.log(`0. At the start: ${describeOverview(await overview(projectId, userId))}`);

  console.log(`1. Prepare every block (code: Director prompt to reference tokens) [${elapsed()}]`);
  await ensurePrepared(projectId, userId);
  await settle("blocks prepared", projectId, userId);
  await printBlocks(projectId, userId);

  console.log(`2. Approve all blocks [${elapsed()}]`);
  console.log(`   approved ${await approveAllBlocks({ projectId, userId })}`);
  console.log(`   overview: ${describeOverview(await overview(projectId, userId))}`);

  console.log(`3. Quote and start the drafts [${elapsed()}]`);
  const quote = await quoteProduction(projectId, userId);
  if (!quote) throw new Error("quoteProduction returned null");
  console.log(`   quote: ${JSON.stringify(quote)}`);
  if (quote.drafts.count > 0) {
    const { started } = await startDrafts({
      projectId,
      userId,
      expectedCredits: quote.drafts.credits,
    });
    console.log(`   started ${started} drafts`);
  }
  await settle("drafts in review", projectId, userId);
  await printBlocks(projectId, userId);

  console.log(`4. Reject the first draft (too_static) [${elapsed()}]`);
  const first = (await allBlocks(projectId, userId)).find((b) => b.stage === "draft_review");
  if (first) {
    const takeId = await latestTakeId(first.lineageId, userId);
    const stage = await submitTakeReview({
      takeId,
      userId,
      decision: "rejected",
      note: "Give the shot a slow push-in.",
    });
    console.log(`   ${first.title}: ${stage}`);
    await settle("fixed draft in review", projectId, userId);
    const detail = await getBlockDetail(first.lineageId, userId);
    const fixed = detail?.takes[0];
    console.log(
      `   take ${fixed?.takeNumber} ${fixed?.stage} ${fixed?.status} file ${fixed?.fileId} (sample: ${fixed?.isSample})`,
    );
  }

  console.log(`5. Accept every draft [${elapsed()}]`);
  for (const b of await allBlocks(projectId, userId)) {
    if (b.stage !== "draft_review") continue;
    await submitTakeReview({
      takeId: await latestTakeId(b.lineageId, userId),
      userId,
      decision: "accepted",
    });
  }
  await settle("finals in review", projectId, userId);
  await printBlocks(projectId, userId);

  console.log(`6. Accept the finals, except the last two blocks' [${elapsed()}]`);
  const blocks = await allBlocks(projectId, userId);
  const keep = new Set(blocks.slice(-2).map((b) => b.lineageId));
  for (const b of blocks) {
    if (b.stage !== "final_review" || keep.has(b.lineageId)) continue;
    await submitTakeReview({
      takeId: await latestTakeId(b.lineageId, userId),
      userId,
      decision: "accepted",
    });
  }
  console.log(`   overview: ${describeOverview(await overview(projectId, userId))}`);
  await printBlocks(projectId, userId);

  console.log(`Credits after: ${await getBalance(userId)} (total ${elapsed()})`);
}

runScript(main, { queue: true });
