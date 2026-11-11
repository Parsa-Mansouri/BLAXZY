/**
 * Development only: runs the generation engine end to end through the real queue and a running
 * worker.
 *
 *   pnpm worker                    # in another terminal
 *   pnpm dev:generation [email]    # default testuser@gmail.com (pnpm dev:user, pnpm dev:script-flow)
 *
 * Uses the user's most recently updated project that has a style, grants credits if the balance
 * is short, requests one look, waits for it, then one sheet with the look as reference, and
 * prints status, price, balance before/after and the stored file's size.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { getBalance, grantCredits } from "../src/server/billing";
import { closeDb, getDb } from "../src/server/db/client";
import { user } from "../src/server/db/schema";
import { getEnv } from "../src/server/env";
import {
  getGeneration,
  quoteGeneration,
  requestGeneration,
  type GenerationView,
} from "../src/server/generation";
import { closeJobQueue } from "../src/server/jobs";
import { listProjects, type Project } from "../src/server/projects";
import { getOwnedFileInfo } from "../src/server/storage";

const TIMEOUT_MS = 2 * 60 * 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function findStyledProject(userId: string): Promise<Project | null> {
  let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    const result = await listProjects({ ownerId: userId, limit: 50, cursor });
    const found = result.items.find((p) => p.style !== null);
    if (found) return found;
    if (!result.nextCursor) return null;
    cursor = result.nextCursor;
  }
  return null;
}

async function waitFinished(generationId: string, userId: string): Promise<GenerationView> {
  const started = Date.now();
  for (;;) {
    const g = await getGeneration(generationId, userId);
    if (!g) throw new Error(`Generation ${generationId} disappeared`);
    if (g.status === "succeeded" || g.status === "failed" || g.status === "cancelled") {
      console.log(`  ${g.status} after ${((Date.now() - started) / 1000).toFixed(1)} s`);
      return g;
    }
    if (Date.now() - started > TIMEOUT_MS) {
      throw new Error(`Timed out waiting for ${generationId}. Is \`pnpm worker\` running?`);
    }
    await sleep(500);
  }
}

async function report(label: string, g: GenerationView, userId: string): Promise<void> {
  const file = g.resultFileId ? await getOwnedFileInfo(g.resultFileId, userId) : null;
  console.log(`  ${label}: ${g.id}`);
  console.log(`    status ${g.status}, model ${g.model}, params ${JSON.stringify(g.params)}`);
  console.log(`    price ${g.priceCredits} credits, attempts ${g.attempts}, sample ${g.isSample}`);
  if (g.error) console.log(`    error: ${g.error}`);
  if (file) console.log(`    file ${file.id} (${file.mimeType}, ${file.sizeBytes} bytes)`);
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("dev:generation is for development only.");
  }
  const email = (process.argv[2] ?? "testuser@gmail.com").toLowerCase();
  const [owner] = await getDb().select({ id: user.id }).from(user).where(eq(user.email, email));
  if (!owner)
    throw new Error(`No user ${email}. Create it first: pnpm dev:user ${email} <password>`);
  const userId = owner.id;
  const project = await findStyledProject(userId);
  if (!project?.style) {
    throw new Error(`${email} has no project with a style yet. Run pnpm dev:script-flow first.`);
  }
  const style = project.style;
  console.log(`Provider: ${getEnv().GENERATION_PROVIDER}`);
  console.log(`Project ${project.id} "${project.title}" (${style.orientation})`);

  const lookQuote = await quoteGeneration({ purpose: "asset_look", style });
  const sheetQuote = await quoteGeneration({ purpose: "asset_sheet", style });
  const needed = lookQuote.priceCredits + sheetQuote.priceCredits;
  let before = await getBalance(userId);
  if (before < needed) {
    before = await grantCredits({ userId, amount: 100, note: "dev:generation top-up" });
    console.log(`Granted 100 credits (balance was short of ${needed}).`);
  }
  console.log(`Balance before: ${before}`);

  const label = "Tomas, the old fisherman";
  console.log(`Look (quoted ${lookQuote.priceCredits}):`);
  const look = await requestGeneration({
    userId,
    projectId: project.id,
    purpose: "asset_look",
    prompt: "An old fisherman with a grey beard and a yellow raincoat, harbour at dawn",
    label,
    style,
  });
  const lookDone = await waitFinished(look.generationId, userId);
  await report("look", lookDone, userId);
  if (lookDone.status !== "succeeded" || !lookDone.resultFileId) {
    throw new Error("The look did not succeed");
  }

  console.log(`Sheet (quoted ${sheetQuote.priceCredits}), with the look as reference:`);
  const sheet = await requestGeneration({
    userId,
    projectId: project.id,
    purpose: "asset_sheet",
    prompt: "Character sheet: front, side, back, details and palette",
    label,
    referenceFileIds: [lookDone.resultFileId],
    style,
  });
  const sheetDone = await waitFinished(sheet.generationId, userId);
  await report("sheet", sheetDone, userId);

  const after = await getBalance(userId);
  console.log(`Balance after: ${after} (spent ${before - after})`);
  if (sheetDone.status !== "succeeded") throw new Error("The sheet did not succeed");
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeJobQueue();
    await closeDb();
  });
