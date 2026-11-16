/**
 * What pre-production steps cost and the confirmation of them. Every step that leads to a paid
 * generation (a design, a fix round, a re-roll, a sheet, a pack view, any retry) carries
 * `expectedCredits`, the price the user saw. The service re-quotes and compares (`PriceChangedError`),
 * checks the balance, and stores the confirmed unit price on the look, sheet or view it creates
 * (`confirmedCredits`): the worker's `requestGeneration` never reserves more than that.
 *
 * A look costs one `asset_look`; a character sheet one `asset_sheet`; a location pack or prop
 * sheet makes up to `MAX_VIEWS` images, each charged as it is made, so the confirmation is the
 * price of one view and the quote says how many may be made.
 */
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { type DbExecutor, getDb } from "@/server/db/client";
import { asset, project, type GenerationPurpose } from "@/server/db/schema";
import { confirmSpend, PriceChangedError, quoteSpend, type SpendQuote } from "@/server/generation";
import { getBalance } from "@/server/billing";
import { type AssetRow } from "../looks";
import { MAX_VIEWS, packKindOf } from "../packs";
import { AssetInputError, parse } from "../service";
import { isUuid } from "./access";
import { idSchema, userIdSchema } from "./inputs";

/** `look`: an `asset_look` image. `sheet`: an `asset_sheet` image (a pack's views, one by one). */
export type SpendStep = "look" | "sheet";

const PURPOSE: Record<SpendStep, GenerationPurpose> = {
  look: "asset_look",
  sheet: "asset_sheet",
};

type OwnerRow = typeof project.$inferSelect;

function requireStyle(owner: Pick<OwnerRow, "style">) {
  if (!owner.style) throw new AssetInputError("Choose the project's style first.");
  return owner.style;
}

/**
 * Re-quotes `step`, compares with `expectedCredits` and checks the balance; returns the confirmed
 * unit price to store on the row. `tx` is the caller's transaction. A missing `expectedCredits`
 * is a price change too (the screen asks again).
 */
export async function confirmAssetSpend(
  tx: DbExecutor,
  input: {
    owner: Pick<OwnerRow, "style">;
    userId: string;
    step: SpendStep;
    expectedCredits: number | undefined;
  },
): Promise<number> {
  if (input.expectedCredits === undefined) throw new PriceChangedError("Confirm the price first.");
  return confirmSpend({
    userId: input.userId,
    purpose: PURPOSE[input.step],
    style: requireStyle(input.owner),
    expectedCredits: input.expectedCredits,
    db: tx,
  });
}

const FREE = async (userId: string): Promise<SpendQuote> => ({
  spends: false,
  credits: 0,
  unit: 0,
  balance: await getBalance(userId),
  maxGenerations: 0,
});

/** The user's asset and its project, or null (no locks). */
async function readOwned(
  assetId: string,
  userId: string,
): Promise<{ asset: AssetRow; project: OwnerRow } | null> {
  if (!isUuid(assetId)) return null;
  const [row] = await getDb()
    .select({ asset, project })
    .from(asset)
    .innerJoin(project, eq(project.id, asset.projectId))
    .where(and(eq(asset.id, assetId), eq(project.ownerId, userId), isNull(project.archivedAt)))
    .limit(1);
  return row ?? null;
}

async function quoteStep(
  row: { asset: AssetRow; project: OwnerRow },
  userId: string,
  step: SpendStep,
) {
  return quoteSpend({
    userId,
    purpose: PURPOSE[step],
    style: requireStyle(row.project),
    maxGenerations: step === "sheet" && packKindOf(row.asset.kind) ? MAX_VIEWS : 1,
  });
}

const stepInput = z.object({
  assetId: idSchema,
  userId: userIdSchema,
  step: z.enum(["look", "sheet"], { error: "Unknown step." }),
});

/**
 * What a design (`look`) or the sheet built after a design is accepted (`sheet`) costs, for the
 * confirmation. Null when the asset is not the user's.
 */
export async function quoteAssetSpend(input: {
  assetId: string;
  userId: string;
  step: SpendStep;
}): Promise<SpendQuote | null> {
  const { assetId, userId, step } = parse(stepInput, input);
  const owned = await readOwned(assetId, userId);
  return owned ? quoteStep(owned, userId, step) : null;
}

const reviewQuoteInput = z.object({
  assetId: idSchema,
  userId: userIdSchema,
  subject: z.enum(["look", "sheet", "view"], { error: "Unknown review." }),
  decision: z.enum(["accepted", "rejected"], { error: "Unknown decision." }),
  /** Rejected sheet or view: the words are a change of the design (the designer makes a new look). */
  designChange: z.boolean().optional(),
});

/**
 * What a review decision costs: a look accepted builds its sheet, a look rejected is designed
 * again; a sheet or view accepted costs nothing; one rejected makes a new image (a design change
 * goes back to the designer: a look). Null when the asset is not the user's.
 */
export async function quoteAssetReview(input: {
  assetId: string;
  userId: string;
  subject: "look" | "sheet" | "view";
  decision: "accepted" | "rejected";
  designChange?: boolean;
}): Promise<SpendQuote | null> {
  const { assetId, userId, subject, decision, designChange } = parse(reviewQuoteInput, input);
  const owned = await readOwned(assetId, userId);
  if (!owned) return null;
  if (subject === "look")
    return quoteStep(owned, userId, decision === "accepted" ? "sheet" : "look");
  if (decision === "accepted") return FREE(userId);
  return quoteStep(owned, userId, designChange === true ? "look" : "sheet");
}
