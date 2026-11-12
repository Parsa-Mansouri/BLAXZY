/**
 * Development only: runs pre-production on two assets through the real queue and a running worker.
 *
 *   pnpm worker                       # in another terminal
 *   pnpm dev:preprod-flow [email]     # default testuser@gmail.com
 *
 * On the user's project "The Lighthouse Keeper" (already in pre-production): tops up credits if
 * needed; for the first character still waiting for an image, answers the guided questions, waits,
 * rejects the look with one issue, waits for the fixed look, accepts it, waits for the character
 * sheet (sheet-generator-character), sends it back once for a detail-frame fix (ST20, which edits
 * the previous sheet) and accepts the fixed one; uploads a small generated PNG as the Hero of the
 * first location still waiting, accepts it, then approves every view of the location pack as it
 * is made (sheet-generator-location), locks the pack and waits for the contact sheet; designs the
 * first prop still waiting ("Design it for me", answering a blocking question with "I'm not
 * sure"), accepts it and does the same with its prop sheet (sheet-generator-prop). Prints every asset's stage, the overview and the credits before and after. The
 * other assets are left untouched. Works in sample mode.
 */
import "dotenv/config";
import { and, desc, eq, isNull } from "drizzle-orm";
import sharp from "sharp";
import {
  addAsset,
  answerLookQuestion,
  getAssetDetail,
  getPreProductionOverview,
  listAssetCards,
  lockSheet,
  fieldsToConfirm,
  startDesign,
  startLookFromGuided,
  submitLookReview,
  submitSheetReview,
  submitSheetViewReview,
  type AssetCard,
  type AssetDetail,
} from "../src/server/assets";
import { getBalance, grantCredits } from "../src/server/billing";
import { AI_DECIDES, getDamiMode, type GuidedQuestion } from "../src/server/damis";
import { closeDb, getDb } from "../src/server/db/client";
import { ASSET_KINDS, project, user, type AssetKind } from "../src/server/db/schema";
import { closeJobQueue } from "../src/server/jobs";
import { putFileBytes } from "../src/server/storage";

const PROJECT_TITLE = "The Lighthouse Keeper";
/** Looks and sheets for the character, the location pack's and prop sheet's views, plus room. */
const CREDITS_NEEDED = 250;
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

const OPEN_VIEW = ["planned", "pending", "in_review"];

/** Approves every view of a pack as it is made, then locks it and waits for the contact sheet. */
async function approvePack(assetId: string, userId: string, start: AssetDetail): Promise<void> {
  let d = start;
  console.log(`   views: ${d.packViews.map((v) => v.viewId).join(", ") || "(none)"}`);
  while (d.packViews.some((v) => OPEN_VIEW.includes(v.status))) {
    const view = d.packViews.find((v) => v.status === "in_review");
    if (view) {
      await submitSheetViewReview({
        viewRowId: view.id,
        userId,
        decision: "accepted",
        hypothesesApproved: true,
      });
      console.log(`   approved ${view.label}`);
    }
    d = await waitFor(
      "next view",
      assetId,
      userId,
      (x) =>
        x.packViews.some((v) => v.status === "in_review") ||
        !x.packViews.some((v) => OPEN_VIEW.includes(v.status)),
    );
    const failed = d.packViews.find((v) => v.status === "failed");
    if (failed) throw new Error(`${failed.label} failed: ${failed.failure ?? ""}`);
  }
  if (!d.lockGate?.canLock) throw new Error(`Cannot lock: ${d.lockGate?.missing.join(", ")}`);
  const stage = await lockSheet({ sheetId: d.sheets[0]?.id ?? "", userId });
  console.log(`   locked the pack: ${stage}`);
  d = await waitFor("contact sheet", assetId, userId, (x) => Boolean(x.sheets[0]?.fileId));
  console.log(`   contact sheet file ${d.sheets[0]?.fileId}`);
}

/** The first option of each choice, a short sample text for each required text question. */
function sampleAnswers(questions: GuidedQuestion[]): Record<string, string> {
  const texts: Record<string, string> = {
    face: "Weathered oval face, olive skin, deep-set grey eyes, a thin scar over the left brow",
    hair: "Short salt-and-pepper hair, a close-trimmed grey beard",
    outfit: "Navy wool pea coat, cream fisherman's sweater, dark canvas trousers, black boots",
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

const NEW_ASSETS: Partial<Record<AssetKind, { name: string; description: string }>> = {
  character: { name: "Harbour Master", description: "A stern harbour master in his fifties." },
  location: { name: "Net Loft", description: "A cramped loft where the nets are mended." },
  prop: { name: "Brass Compass", description: "A brass pocket compass with a hinged lid." },
};

/** The first asset of a kind waiting for an image, or a new one added for this run. */
async function firstWaiting(
  cards: AssetCard[],
  kind: AssetKind,
  projectId: string,
  userId: string,
): Promise<AssetCard["asset"]> {
  const card = cards.find((c) => c.asset.kind === kind && c.stage === "needs_image");
  if (card) return card.asset;
  const fresh = NEW_ASSETS[kind];
  if (!fresh) throw new Error(`No ${kind} is waiting for an image in "${PROJECT_TITLE}".`);
  const added = await addAsset({ projectId, userId, kind, ...fresh });
  if (!added) throw new Error("addAsset returned null");
  console.log(`   (no ${kind} was waiting: added "${added.name}")`);
  return added;
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
  const character = await firstWaiting(cards, "character", projectId, userId);
  console.log(`1. ${character.name}: guided answers`);
  const questions = (await getAssetDetail(character.id, userId))?.questions ?? [];
  const answers = sampleAnswers(questions);
  for (const [id, value] of Object.entries(answers)) console.log(`   ${id}: ${value}`);
  const look1 = await startLookFromGuided({ assetId: character.id, userId, answers });
  if (!look1) throw new Error("startLookFromGuided returned null");
  let d = await waitFor("look in review", character.id, userId, (x) => x.stage === "look_review");
  console.log(
    `   look v${d.looks[0]?.versionNumber} file ${d.looks[0]?.fileId} (sample: ${d.looks[0]?.isSample})`,
  );
  console.log(`2. ${character.name}: reject the look (P01 older)`);
  await submitLookReview({
    lookId: look1.id,
    userId,
    decision: "rejected",
    selections: [{ code: "P01", value: "noticeably older" }],
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
  const sheet1 = d.sheets[0];
  console.log(`   sheet v${sheet1?.versionNumber} file ${sheet1?.fileId}`);
  for (const cell of sheet1?.spec?.detailCells ?? []) {
    console.log(`   frame ${cell.slot}: ${cell.subject}`);
  }
  console.log(`   send it back: ST20 (details too small), an edit of the previous sheet`);
  await submitSheetReview({
    sheetId: sheet1?.id ?? "",
    userId,
    decision: "rejected",
    selections: [{ code: "ST20" }],
  });
  d = await waitFor(
    "fixed sheet in review",
    character.id,
    userId,
    (x) => x.stage === "sheet_review" && x.sheets[0]?.id !== sheet1?.id,
  );
  console.log(`   sheet v${d.sheets[0]?.versionNumber} (${d.sheets[0]?.spec?.editMode ?? ""})`);
  const characterStage = await submitSheetReview({
    sheetId: d.sheets[0]?.id ?? "",
    userId,
    decision: "accepted",
  });
  console.log(`   accepted the sheet: ${characterStage}`);

  // A location from an uploaded image, accepted with its sheet.
  const location = await firstWaiting(cards, "location", projectId, userId);
  console.log(`4. ${location.name}: a PNG as the Hero photo`);
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
  await startDesign({
    assetId: location.id,
    userId,
    references: [{ fileId: file.id, role: "hero" }],
  });
  d = await waitFor("Hero in review", location.id, userId, (x) => x.stage === "look_review");
  const hero = d.looks[0];
  console.log(`   look v${hero?.versionNumber} ${hero?.status} (${hero?.spec?.heroMode ?? ""})`);
  await submitLookReview({
    lookId: hero?.id ?? "",
    userId,
    decision: "accepted",
    confirmedFields: fieldsToConfirm(hero?.spec ?? null),
  });
  d = await waitFor("pack planned", location.id, userId, (x) => x.stage === "sheet_review");
  console.log(`5. ${location.name}: approve every view, then lock`);
  await approvePack(location.id, userId, d);

  // A prop the designer designs alone, with its prop sheet.
  const prop = await firstWaiting(cards, "prop", projectId, userId);
  {
    console.log(`6. ${prop.name}: design it for me`);
    await startDesign({ assetId: prop.id, userId });
    d = await waitFor("design", prop.id, userId, (x) =>
      ["look_review", "needs_answer"].includes(x.stage),
    );
    if (d.stage === "needs_answer") {
      const asked = d.looks[0];
      const answers = Object.fromEntries(
        (asked?.spec?.questions ?? []).map((q) => [q.id, AI_DECIDES]),
      );
      console.log(
        `   the designer asked: ${Object.keys(answers).join(", ")}; answered I'm not sure`,
      );
      await answerLookQuestion({ lookId: asked?.id ?? "", userId, answers });
      d = await waitFor("Hero in review", prop.id, userId, (x) => x.stage === "look_review");
    }
    const propHero = d.looks[0];
    await submitLookReview({
      lookId: propHero?.id ?? "",
      userId,
      decision: "accepted",
      confirmedFields: fieldsToConfirm(propHero?.spec ?? null),
    });
    d = await waitFor("sheet planned", prop.id, userId, (x) => x.stage === "sheet_review");
    const spec = d.sheets[0]?.spec;
    console.log(`   level ${spec?.sheetLevel}; scale card: ${spec?.scaleCard?.text}`);
    await approvePack(prop.id, userId, d);
  }

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
