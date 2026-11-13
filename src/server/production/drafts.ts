/** Quoting and starting the draft takes of the approved blocks. */
import { getBalance } from "@/server/billing";
import { getCurrentBlocks } from "@/server/blocks";
import { type DbExecutor, getDb } from "@/server/db/client";
import { quoteGeneration } from "@/server/generation";
import { enqueue } from "@/server/jobs";
import { productionDispatch } from "@/server/jobs/definitions";
import { logProjectEvent } from "@/server/projects";
import { openProject, parse, type ProjectRow, requireStyle } from "./access";
import { PriceChangedError, ProductionInputError } from "./errors";
import { startDraftsInput } from "./inputs";
import { canStartDraftsFrom } from "./stage";
import { insertDraftTakes } from "./takes";
import { projectStages } from "./views";

export type ProductionQuote = {
  /** Approved blocks without a take, and what their drafts cost together. */
  drafts: { count: number; credits: number };
  /** The price of one final, for information. */
  finalsEach: number;
  balance: number;
};

async function draftQuote(
  db: DbExecutor,
  row: ProjectRow,
): Promise<{ lineageIds: string[]; each: number; finalsEach: number }> {
  const style = requireStyle(row);
  const { blocks } = await projectStages(db, row.id);
  const lineageIds = blocks.filter((b) => b.stage === "approved").map((b) => b.lineageId);
  const [draft, final] = await Promise.all([
    quoteGeneration({ purpose: "block_draft", style }),
    quoteGeneration({ purpose: "block_final", style }),
  ]);
  return { lineageIds, each: draft.priceCredits, finalsEach: final.priceCredits };
}

/** What starting the drafts costs: one draft per approved block without a take. */
export async function quoteProduction(
  projectId: string,
  userId: string,
): Promise<ProductionQuote | null> {
  const db = getDb();
  const owned = await openProject(db, projectId, userId);
  if (!owned) return null;
  const quote = await draftQuote(db, owned);
  return {
    drafts: { count: quote.lineageIds.length, credits: quote.lineageIds.length * quote.each },
    finalsEach: quote.finalsEach,
    balance: await getBalance(userId),
  };
}

/**
 * Starts one draft take per approved block without a take (`take.generate` each), after the user
 * confirmed the total. Refused when the total is not `expectedCredits` any more, when the balance
 * does not cover it (a changed total throws `PriceChangedError`), or while blocks are still being
 * prepared or reviewed. Each draft still
 * reserves its own credits when it is requested (a draft that cannot fails with the credits
 * message).
 */
export async function startDrafts(input: {
  projectId: string;
  userId: string;
  expectedCredits: number;
}): Promise<{ started: number }> {
  const { projectId, userId, expectedCredits } = parse(startDraftsInput, input);
  const takes = await getDb().transaction(async (tx) => {
    const owned = await openProject(tx, projectId, userId, true);
    if (!owned) return null;
    if (owned.stage !== "production") {
      throw new ProductionInputError("This project is not in production.");
    }
    const { counts } = await projectStages(tx, projectId);
    if (counts.approved === 0) {
      throw new ProductionInputError("There are no approved shots waiting for a draft.");
    }
    if (!canStartDraftsFrom(counts)) {
      throw new ProductionInputError("Review every shot first, then start the drafts.");
    }
    const quote = await draftQuote(tx, owned);
    const total = quote.lineageIds.length * quote.each;
    if (total !== expectedCredits) throw new PriceChangedError();
    const balance = await getBalance(userId);
    if (balance < total) {
      throw new ProductionInputError(
        `These drafts need ${total} credits and your balance is ${balance}. Add credits, then try again.`,
      );
    }
    const blocks = await getCurrentBlocks(quote.lineageIds, tx);
    blocks.sort((a, b) => a.orderIndex - b.orderIndex);
    const created = await insertDraftTakes(
      tx,
      projectId,
      blocks.map((block) => ({
        projectId,
        blockId: block.id,
        lineageId: block.lineageId,
        stage: "draft" as const,
        status: "pending" as const,
        prompt: block.productionPrompt,
        damiRunId: block.productionDamiRunId,
      })),
    );
    await logProjectEvent(tx, {
      projectId,
      userId,
      type: "production.drafts_started",
      payload: {
        count: created.length,
        credits: total,
        takeIds: created.map((t) => t.id),
      },
    });
    // One fan-out job queues every draft's job (`take.generate`), however many there are.
    if (created.length > 0) {
      await enqueue(productionDispatch, { projectId, kind: "takes" }, { tx });
    }
    return created;
  });
  if (!takes) throw new ProductionInputError("That project was not found.");
  return { started: takes.length };
}
