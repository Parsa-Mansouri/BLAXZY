/**
 * Development only: runs pre-production on two assets through the real queue and a running worker.
 *
 *   pnpm worker                       # in another terminal
 *   pnpm dev:preprod-flow [email]     # default testuser@gmail.com
 *
 * On the user's project "The Lighthouse Keeper" (already in pre-production): tops up credits if
 * needed; for the first character still waiting for an image, answers the guided questions, waits,
 * rejects the look with one issue, waits for the fixed look, accepts it, waits for the sheet and
 * accepts it; uploads a small generated PNG for the first location still waiting and accepts it
 * and its sheet. Prints every asset's stage, the overview and the credits before and after. The
 * other assets are left untouched. Works in sample mode.
 */
import "dotenv/config";
import { and, desc, eq, isNull } from "drizzle-orm";
import sharp from "sharp";
import {
  getAssetDetail,
  getPreProductionOverview,
  listAssetCards,
  startLookFromGuided,
  startLookFromUpload,
  submitLookReview,
  submitSheetReview,
  type AssetCard,
  type AssetDetail,
} from "../src/server/assets";
import { getBalance, grantCredits } from "../src/server/billing";
import { ASSET_QUESTIONS, getDamiMode, type GuidedQuestion } from "../src/server/damis";
import { closeDb, getDb } from "../src/server/db/client";
import { ASSET_KINDS, project, user, type AssetKind } from "../src/server/db/schema";
import { closeJobQueue } from "../src/server/jobs";
import { putFileBytes } from "../src/server/storage";

const PROJECT_TITLE = "The Lighthouse Keeper";
/** Two looks (4 each) and a sheet (6) for the character, a sheet (6) for the location, plus room. */
const CREDITS_NEEDED = 40;
const TIMEOUT_MS = 3 * 60 * 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(
  label: string,
  assetId: string,
  userId: string,
  done: (d: AssetDetail) => boolean,
): Promise<AssetDetail> {
  const started = Date.now();
  for (;;) {
    const detail = await getAssetDetail(assetId, userId);
    if (!detail) throw new Error("The asset disappeared.");
    if (detail.stage === "failed") {
      const failure = detail.sheets[0]?.failure ?? detail.looks[0]?.failure ?? "unknown";
      throw new Error(`${label} failed: ${failure}`);
    }
    if (done(detail)) {
      console.log(`   ${label} after ${((Date.now() - started) / 1000).toFixed(1)} s`);
      return detail;
    }
    if (Date.now() - started > TIMEOUT_MS) {
      throw new Error(`Timed out waiting for: ${label}. Is \`pnpm worker\` running?`);
    }
    await sleep(500);
  }
}

/** The first option of each choice, a short sample text for each required text question. */
function sampleAnswers(questions: GuidedQuestion[]): Record<string, string> {
  const texts: Record<string, string> = {
    face: "Weathered oval face, olive skin, deep-set grey eyes, a thin scar over the left brow",
    hair: "Short salt-and-pepper hair, a close-trimmed grey beard",
    wardrobe: "Navy wool pea coat, cream fisherman's sweater, dark canvas trousers, black boots",
  };
  const answers: Record<string, string> = {};
  for (const q of questions) {
    if (q.optional) continue;
    answers[q.id] =
      q.kind === "choice"
        ? (q.options?.[3]?.value ?? q.options?.[0]?.value ?? "")
        : (texts[q.id] ?? "Plain and simple");
  }
  return answers;
}

async function allCards(projectId: string, userId: string): Promise<AssetCard[]> {
  const cards: AssetCard[] = [];
  for (const kind of ASSET_KINDS) {
    let cursor: string | null = null;
    do {
      const page: Awaited<ReturnType<typeof listAssetCards>> = await listAssetCards(
        projectId,
        userId,
        { kind, limit: 100, cursor },
      );
      if (!page) throw new Error("listAssetCards returned null");
      cards.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
  }
  return cards;
}

async function printState(projectId: string, userId: string): Promise<void> {
  for (const card of await allCards(projectId, userId)) {
    const thumb = card.thumbnailFileId ? `thumbnail ${card.thumbnailFileId.slice(0, 8)}` : "";
    console.log(
      `   ${card.asset.kind.padEnd(9)} ${card.asset.name.padEnd(20)} ${card.stage.padEnd(15)} ${thumb}`,
    );
  }
  console.log(`   overview: ${JSON.stringify(await getPreProductionOverview(projectId, userId))}`);
}

function firstWaiting(cards: AssetCard[], kind: AssetKind): AssetCard {
  const card = cards.find((c) => c.asset.kind === kind && c.stage === "needs_image");
  if (!card) throw new Error(`No ${kind} is waiting for an image in "${PROJECT_TITLE}".`);
  return card;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("dev:preprod-flow is for development only.");
  }
  const email = (process.argv[2] ?? "testuser@gmail.com").toLowerCase();
  const db = getDb();
  const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  if (!owner)
    throw new Error(`No user ${email}. Create it first: pnpm dev:user ${email} <password>`);
  const userId = owner.id;
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
      `${email} has no project titled "${PROJECT_TITLE}". Create it and accept its script first.`,
    );
  }
  const projectId = found.id;
  console.log(`Dami mode: ${getDamiMode()}`);
  console.log(`Project "${PROJECT_TITLE}" ${projectId} (stage ${found.stage})`);

  const before = await getBalance(userId);
  console.log(`Credits before: ${before}`);
  if (before < CREDITS_NEEDED) {
    const balance = await grantCredits({
      userId,
      amount: CREDITS_NEEDED - before,
      note: "dev:preprod-flow",
    });
    console.log(`   granted ${CREDITS_NEEDED - before}; balance ${balance}`);
  }

  console.log("Assets at the start:");
  await printState(projectId, userId);
  const cards = await allCards(projectId, userId);

  // A character from guided answers, rejected once, then accepted with its sheet.
  const character = firstWaiting(cards, "character").asset;
  console.log(`1. ${character.name}: guided answers`);
  const answers = sampleAnswers(ASSET_QUESTIONS.character);
  for (const [id, value] of Object.entries(answers)) console.log(`   ${id}: ${value}`);
  const look1 = await startLookFromGuided({ assetId: character.id, userId, answers });
  if (!look1) throw new Error("startLookFromGuided returned null");
  let d = await waitFor("look in review", character.id, userId, (x) => x.stage === "look_review");
  console.log(
    `   look v${d.looks[0]?.versionNumber} file ${d.looks[0]?.fileId} (sample: ${d.looks[0]?.isSample})`,
  );
  console.log(`2. ${character.name}: reject the look (wrong_age)`);
  await submitLookReview({
    lookId: look1.id,
    userId,
    decision: "rejected",
    issueCodes: ["wrong_age"],
  });
  d = await waitFor(
    "fixed look in review",
    character.id,
    userId,
    (x) => x.stage === "look_review" && x.looks[0]?.id !== look1.id,
  );
  const look2 = d.looks[0];
  console.log(`   look v${look2?.versionNumber} file ${look2?.fileId}`);
  console.log(`3. ${character.name}: accept the look; building the sheet`);
  await submitLookReview({ lookId: look2?.id ?? "", userId, decision: "accepted" });
  d = await waitFor("sheet in review", character.id, userId, (x) => x.stage === "sheet_review");
  console.log(`   sheet v${d.sheets[0]?.versionNumber} file ${d.sheets[0]?.fileId}`);
  const characterStage = await submitSheetReview({
    sheetId: d.sheets[0]?.id ?? "",
    userId,
    decision: "accepted",
  });
  console.log(`   accepted the sheet: ${characterStage}`);

  // A location from an uploaded image, accepted with its sheet.
  const location = firstWaiting(cards, "location").asset;
  console.log(`4. ${location.name}: upload a PNG`);
  const png = await sharp({
    create: { width: 640, height: 360, channels: 3, background: { r: 52, g: 84, b: 120 } },
  })
    .png()
    .toBuffer();
  const file = await putFileBytes({
    ownerId: userId,
    projectId,
    name: "harbour.png",
    mimeType: "image/png",
    purpose: "asset_image",
    bytes: new Uint8Array(png),
  });
  const uploaded = await startLookFromUpload({ assetId: location.id, userId, fileId: file.id });
  console.log(`   look v${uploaded?.versionNumber} ${uploaded?.status}`);
  await submitLookReview({ lookId: uploaded?.id ?? "", userId, decision: "accepted" });
  d = await waitFor("sheet in review", location.id, userId, (x) => x.stage === "sheet_review");
  const locationStage = await submitSheetReview({
    sheetId: d.sheets[0]?.id ?? "",
    userId,
    decision: "accepted",
  });
  console.log(`   accepted the sheet: ${locationStage}`);

  console.log("Assets at the end:");
  await printState(projectId, userId);
  console.log(`Credits after: ${await getBalance(userId)}`);
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
