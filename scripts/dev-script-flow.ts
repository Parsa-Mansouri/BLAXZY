/**
 * Development only: runs the Script stage end to end through the real queue and a running worker.
 *
 *   pnpm worker             # in another terminal
 *   pnpm dev:script-flow [email]   # default testuser@gmail.com (create it with pnpm dev:user)
 *
 * Creates a project, saves a style, starts from a brief, waits for review, rejects with a note,
 * accepts the revision, then prints the detected assets and the block count. Works in sample mode.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { countAssetsByKind, listAssets } from "../src/server/assets";
import { getSectioningStatus } from "../src/server/blocks";
import { getDamiMode } from "../src/server/damis";
import { closeDb, getDb } from "../src/server/db/client";
import { user } from "../src/server/db/schema";
import { closeJobQueue } from "../src/server/jobs";
import { createProject, saveStyle } from "../src/server/projects";
import {
  getScriptState,
  startFromBrief,
  submitScriptReview,
  type ScriptVersionView,
} from "../src/server/script";

const TIMEOUT_MS = 3 * 60 * 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(label: string, check: () => Promise<T | null>): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value !== null) {
      console.log(`  ${label} after ${((Date.now() - started) / 1000).toFixed(1)} s`);
      return value;
    }
    if (Date.now() - started > TIMEOUT_MS) {
      throw new Error(`Timed out waiting for: ${label}. Is \`pnpm worker\` running?`);
    }
    await sleep(500);
  }
}

async function waitForReview(projectId: string, userId: string, versionId: string) {
  return waitFor(`version in review`, async (): Promise<ScriptVersionView | null> => {
    const state = await getScriptState(projectId, userId);
    const current = state?.current;
    if (!current || current.id !== versionId) return null;
    if (current.status === "failed") throw new Error(`Version failed: ${current.failure}`);
    return current.status === "in_review" ? current : null;
  });
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production")
    throw new Error("dev:script-flow is for development only.");
  const email = (process.argv[2] ?? "testuser@gmail.com").toLowerCase();
  const [owner] = await getDb().select({ id: user.id }).from(user).where(eq(user.email, email));
  if (!owner)
    throw new Error(`No user ${email}. Create it first: pnpm dev:user ${email} <password>`);
  const userId = owner.id;
  console.log(`Dami mode: ${getDamiMode()}`);

  const project = await createProject({
    ownerId: userId,
    title: `Script flow ${new Date().toISOString()}`,
  });
  await saveStyle({
    projectId: project.id,
    userId,
    style: {
      visualStyle: "Cinematic live-action",
      genre: "Drama",
      format: "movie",
      orientation: "landscape",
      totalDurationSeconds: 120,
    },
  });
  console.log(`Project ${project.id}`);

  const v1 = await startFromBrief({
    projectId: project.id,
    userId,
    brief:
      "An old fisherman named Tomas finds a map in a bottle and must decide whether to follow it.",
  });
  if (!v1) throw new Error("startFromBrief returned null");
  console.log(`1. Started v${v1.versionNumber} from a brief (${v1.status})`);
  const written = await waitForReview(project.id, userId, v1.id);
  console.log(
    `   "${written.title}" — ${written.content?.length ?? 0} chars, sample: ${written.isSample}`,
  );

  const v2 = await submitScriptReview({
    projectId: project.id,
    userId,
    versionId: v1.id,
    decision: "rejected",
    issueCodes: ["ending_weak"],
    note: "Give the ending more hope.",
  });
  if (!v2) throw new Error("submitScriptReview returned null");
  console.log(`2. Rejected v${v1.versionNumber} with a note; revising v${v2.versionNumber}`);
  const revised = await waitForReview(project.id, userId, v2.id);
  for (const note of revised.notes) console.log(`   - ${note}`);

  const accepted = await submitScriptReview({
    projectId: project.id,
    userId,
    versionId: v2.id,
    decision: "accepted",
  });
  console.log(`3. Accepted v${accepted?.versionNumber}; detecting assets and sectioning`);
  const status = await waitFor("sectioning finished", async () => {
    const s = await getSectioningStatus(project.id, userId);
    if (s?.state === "failed") throw new Error(`Sectioning failed: ${s.failure}`);
    return s?.state === "done" ? s : null;
  });

  const counts = await countAssetsByKind(project.id, userId);
  const list = await listAssets(project.id, userId, { limit: 100 });
  console.log("4. Detected assets:");
  for (const a of list?.items ?? []) console.log(`   ${a.kind.padEnd(9)} ${a.name} (${a.slug})`);
  console.log(`   counts: ${JSON.stringify(counts)}`);
  console.log(`5. Prompt blocks: ${status.blockCount}`);
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
