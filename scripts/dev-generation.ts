/**
 * Development only: runs the generation engine end to end through the real queue and a running
 * worker.
 *
 *   pnpm worker                    # in another terminal
 *   pnpm dev:generation [email]    # default testuser@gmail.com (pnpm dev:user, pnpm dev:script-flow)
 *
 * Uses the user's most recently updated project that has a style, grants credits if the balance
 * is short, requests one look, waits for it, then one sheet with the look as reference, then a
 * draft clip and the final made from that draft, and prints status, price, balance before/after,
 * the stored files' sizes and, for the clips, render time, duration and resolution (probed with
 * ffmpeg).
 */
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import "dotenv/config";
import { getBalance, grantCredits } from "../src/server/billing";
import { getEnv } from "../src/server/env";
import {
  getGeneration,
  quoteGeneration,
  requestGeneration,
  type GenerationView,
} from "../src/server/generation";
import { listProjects, type Project } from "../src/server/projects";
import { probeMedia } from "../src/server/providers/ffmpeg";
import { getOwnedFileInfo, openFileStream } from "../src/server/storage";
import { assertDevOnly, findOwnerId, pollUntil, runScript } from "./_lib";

const TIMEOUT_MS = 3 * 60 * 1000;
const CLIP_SECONDS = 10;

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

function waitFinished(generationId: string, userId: string): Promise<GenerationView> {
  return pollUntil({
    check: async () => {
      const g = await getGeneration(generationId, userId);
      if (!g) throw new Error(`Generation ${generationId} disappeared`);
      return g.status === "succeeded" || g.status === "failed" || g.status === "cancelled"
        ? g
        : null;
    },
    timeoutMs: TIMEOUT_MS,
    intervalMs: 500,
    timeoutMessage: `Timed out waiting for ${generationId}. Is \`pnpm worker\` running?`,
    report: (g, seconds) => console.log(`  ${g.status} after ${seconds} s`),
  });
}

async function report(label: string, g: GenerationView, userId: string): Promise<void> {
  const file = g.resultFileId ? await getOwnedFileInfo(g.resultFileId, userId) : null;
  console.log(`  ${label}: ${g.id}`);
  console.log(`    status ${g.status}, model ${g.model}, params ${JSON.stringify(g.params)}`);
  console.log(`    price ${g.priceCredits} credits, attempts ${g.attempts}, sample ${g.isSample}`);
  if (g.error) console.log(`    error: ${g.error}`);
  if (file) console.log(`    file ${file.id} (${file.mimeType}, ${file.sizeBytes} bytes)`);
  const poster = g.posterFileId ? await getOwnedFileInfo(g.posterFileId, userId) : null;
  if (poster) {
    console.log(`    poster ${poster.id} (${poster.mimeType}, ${poster.sizeBytes} bytes)`);
  }
  if (g.kind === "video" && g.resultFileId) {
    const dir = await mkdtemp(join(tmpdir(), "blaxzy-dev-generation-"));
    try {
      const path = join(dir, "clip.mp4");
      const { stream } = await openFileStream(g.resultFileId);
      await pipeline(stream, createWriteStream(path));
      const probe = await probeMedia(path);
      const render =
        g.startedAt && g.finishedAt
          ? `${((g.finishedAt.getTime() - g.startedAt.getTime()) / 1000).toFixed(1)} s from start`
          : "n/a";
      console.log(
        `    clip ${probe.video?.width}x${probe.video?.height} ${probe.video?.codec}/${probe.video?.pixelFormat}, ` +
          `${probe.durationSeconds?.toFixed(2)} s, audio ${probe.audio?.codec ?? "none"}, ` +
          `${((file?.sizeBytes ?? 0) / 1024).toFixed(0)} KB, render+store ${render}`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

async function main(): Promise<void> {
  assertDevOnly("dev:generation");
  const email = (process.argv[2] ?? "testuser@gmail.com").toLowerCase();
  const userId = await findOwnerId(email);
  const project = await findStyledProject(userId);
  if (!project?.style) {
    throw new Error(`${email} has no project with a style yet. Run pnpm dev:script-flow first.`);
  }
  const style = project.style;
  console.log(`Provider: ${getEnv().GENERATION_PROVIDER}`);
  console.log(`Project ${project.id} "${project.title}" (${style.orientation})`);

  const lookQuote = await quoteGeneration({ purpose: "asset_look", style });
  const sheetQuote = await quoteGeneration({ purpose: "asset_sheet", style });
  const draftQuote = await quoteGeneration({ purpose: "block_draft", style });
  const finalQuote = await quoteGeneration({ purpose: "block_final", style });
  const needed =
    lookQuote.priceCredits +
    sheetQuote.priceCredits +
    draftQuote.priceCredits +
    finalQuote.priceCredits;
  let before = await getBalance(userId);
  if (before < needed) {
    before = await grantCredits({ userId, amount: 200, note: "dev:generation top-up" });
    console.log(`Granted 200 credits (balance was short of ${needed}).`);
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
  if (sheetDone.status !== "succeeded" || !sheetDone.resultFileId) {
    throw new Error("The sheet did not succeed");
  }

  const shot = {
    userId,
    projectId: project.id,
    prompt: "Tomas walks along the harbour wall at dawn, gulls overhead, slow dolly forward",
    label: "Tomas walks to the harbour at dawn",
    referenceFileIds: [sheetDone.resultFileId],
    durationSeconds: CLIP_SECONDS,
    style,
  };
  console.log(
    `Draft clip (quoted ${draftQuote.priceCredits}), ${CLIP_SECONDS} s, the sheet as reference:`,
  );
  const draft = await requestGeneration({ ...shot, purpose: "block_draft" });
  const draftDone = await waitFinished(draft.generationId, userId);
  await report("draft", draftDone, userId);
  if (draftDone.status !== "succeeded") throw new Error("The draft did not succeed");

  console.log(`Final clip (quoted ${finalQuote.priceCredits}) from that draft, with sound:`);
  const final = await requestGeneration({
    ...shot,
    purpose: "block_final",
    sound: true,
    draftGenerationId: draftDone.id,
  });
  const finalDone = await waitFinished(final.generationId, userId);
  await report("final", finalDone, userId);

  const after = await getBalance(userId);
  console.log(`Balance after: ${after} (spent ${before - after})`);
  if (finalDone.status !== "succeeded") throw new Error("The final did not succeed");
}

runScript(main, { queue: true });
