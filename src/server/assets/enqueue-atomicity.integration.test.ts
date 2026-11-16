/**
 * Every job of pre-production is sent on the transaction that writes its row: when the queue
 * cannot take the job, the change is rolled back with it (nothing waits forever for a job that
 * was never sent) and the user is told to try again. The queue is made to fail on demand by
 * wrapping `enqueue`; otherwise jobs go to a throwaway queue schema. Against the local Postgres;
 * skipped when it is unreachable.
 */
import "dotenv/config";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { AssetKind } from "@/server/db/schema";
import { databaseReachable } from "@/server/test-support/integration";
import { dropSchema, pointQueueAtThrowawaySchema } from "@/server/test-support/script-fixtures";

const queue = vi.hoisted(() => ({ down: false }));

vi.mock("@/server/jobs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/jobs")>();
  const enqueue: typeof actual.enqueue = async (job, payload, options) => {
    if (queue.down) throw new Error("the queue is down");
    return actual.enqueue(job, payload, options);
  };
  return { ...actual, enqueue };
});

const jobSchema = pointQueueAtThrowawaySchema();
const reachable = await databaseReachable();

describe.skipIf(!reachable)("jobs are sent with their rows (integration)", async () => {
  const { autoConfirm, ASSET_SPEND_FUNCTIONS } =
    await import("@/server/test-support/confirm-fixtures");
  const assets = autoConfirm(await import("@/server/assets"), ASSET_SPEND_FUNCTIONS);
  const { grantCredits } = await import("@/server/billing");
  const { closeJobQueue } = await import("@/server/jobs");
  const { closeDb, getDb } = await import("@/server/db/client");
  const s = await import("@/server/db/schema");
  const { eq } = await import("drizzle-orm");
  const { createPreProductionFixtures } = await import("@/server/test-support/preprod-fixtures");
  const fixtures = createPreProductionFixtures();

  afterAll(async () => {
    queue.down = false;
    await fixtures.cleanup();
    await closeJobQueue();
    await dropSchema(jobSchema);
    await closeDb();
  });

  async function setup() {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newPreProductionProject(userId);
    await grantCredits({ userId, amount: 100 });
    return { userId, projectId };
  }

  async function add(projectId: string, userId: string, kind: AssetKind, name: string) {
    const created = await assets.addAsset({ projectId, userId, kind, name });
    if (!created) throw new Error("addAsset returned null");
    return created;
  }

  async function looksOf(assetId: string) {
    return getDb().select().from(s.assetLook).where(eq(s.assetLook.assetId, assetId));
  }

  async function whileQueueDown<T>(run: () => Promise<T>): Promise<T> {
    queue.down = true;
    try {
      return await run();
    } finally {
      queue.down = false;
    }
  }

  it("a look is never left pending without its job", async () => {
    const { userId, projectId } = await setup();
    const tomas = await add(projectId, userId, "character", "Tomas");
    await expect(
      whileQueueDown(() =>
        assets.startLookFromPrompt({ assetId: tomas.id, userId, prompt: "A man in a coat" }),
      ),
    ).rejects.toThrow(/could not start/);
    expect(await looksOf(tomas.id)).toEqual([]);
    // Nothing was left behind: the same request works once the queue is back.
    const look = await assets.startLookFromPrompt({
      assetId: tomas.id,
      userId,
      prompt: "A man in a coat",
    });
    expect(look).toMatchObject({ status: "pending", versionNumber: 1 });
  });

  it("a failed view's retry is rolled back when its job cannot be sent", async () => {
    const { userId, projectId } = await setup();
    const cabin = await add(projectId, userId, "location", "Ferry Cabin");
    const [look] = await getDb()
      .insert(s.assetLook)
      .values({
        assetId: cabin.id,
        projectId,
        versionNumber: 1,
        source: "generated",
        status: "accepted",
      })
      .returning();
    const [sheet] = await getDb()
      .insert(s.assetSheet)
      .values({
        assetId: cabin.id,
        projectId,
        lookId: look?.id ?? "",
        versionNumber: 1,
        status: "in_review",
      })
      .returning();
    const [view] = await getDb()
      .insert(s.assetSheetView)
      .values({
        sheetId: sheet?.id ?? "",
        assetId: cabin.id,
        projectId,
        viewId: "reverse_wide",
        versionNumber: 1,
        label: "Reverse",
        position: 0,
        status: "failed",
        prompt: "The reverse angle",
        failure: "The view could not be made.",
      })
      .returning();
    const viewRowId = view?.id ?? "";
    await expect(
      whileQueueDown(() => assets.retrySheetView({ viewRowId, userId })),
    ).rejects.toThrow(/could not start/);
    const [still] = await getDb()
      .select()
      .from(s.assetSheetView)
      .where(eq(s.assetSheetView.id, viewRowId));
    // Still failed, so it can be retried (a planned view without its job would be stuck).
    expect(still).toMatchObject({ status: "failed", failure: "The view could not be made." });
    expect(await assets.retrySheetView({ viewRowId, userId })).toBe("sheet_review");
  });

  it("removing a location that props wait for is rolled back when they cannot be woken", async () => {
    const { userId, projectId } = await setup();
    const deck = await add(projectId, userId, "location", "Deck");
    await assets.startLookFromPrompt({ assetId: deck.id, userId, prompt: "A ship's deck" });
    const rope = await add(projectId, userId, "prop", "Rope");
    await getDb()
      .update(s.asset)
      .set({ details: { locationIds: ["Deck"] } })
      .where(eq(s.asset.id, rope.id));
    await assets.startLookFromPrompt({ assetId: rope.id, userId, prompt: "A coil of rope" });
    await expect(
      whileQueueDown(() => assets.removeAsset({ assetId: deck.id, userId })),
    ).rejects.toThrow(/could not start/);
    const [row] = await getDb().select().from(s.asset).where(eq(s.asset.id, deck.id));
    expect(row?.status).toBe("active");
    expect(await assets.removeAsset({ assetId: deck.id, userId })).toBe(true);
  });

  it("a correction round is never shown as running without its job", async () => {
    const { userId, projectId } = await setup();
    const scriptVersionId = await fixtures.acceptedScript(projectId, userId);
    await getDb()
      .insert(s.assetDetection)
      .values({
        projectId,
        scriptVersionId,
        mode: "full",
        sceneIndex: [],
        diff: { added: [], updated: [], removed: [] },
        assumptions: [],
        warnings: [],
      });
    await expect(
      whileQueueDown(() => assets.submitDetectionReview({ projectId, userId, rescan: true })),
    ).rejects.toThrow(/could not start/);
    const reviews = await getDb().select().from(s.review).where(eq(s.review.projectId, projectId));
    expect(reviews).toEqual([]);
    expect((await assets.getDetectionPanel(projectId, userId))?.busy).toBe(false);
    expect(await assets.submitDetectionReview({ projectId, userId, rescan: true })).toEqual({
      started: true,
    });
  });
});
