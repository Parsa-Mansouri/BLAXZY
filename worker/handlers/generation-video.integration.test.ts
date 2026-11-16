/**
 * Video generations (block drafts and finals) and the stuck-generation sweep, end to end with the
 * sample provider against the local Postgres and S3 store. Follow-up jobs go to a throwaway queue
 * schema. Skipped when a service is unreachable; the rendering tests are skipped when ffmpeg is
 * not available.
 */
import "dotenv/config";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { afterAll, describe, expect, it } from "vitest";
import { ffmpegReady } from "../../src/server/test-support/integration";
import { servicesReachable } from "../../src/server/test-support/generation-fixtures";
import {
  dropSchema,
  jobContext,
  pointQueueAtThrowawaySchema,
  TEST_STYLE,
} from "../../src/server/test-support/script-fixtures";

const jobSchema = pointQueueAtThrowawaySchema();
const reachable = await servicesReachable();
const hasFfmpeg = reachable && (await ffmpegReady());

describe.skipIf(!reachable)("video generations and the sweep (integration)", async () => {
  const sharp = (await import("sharp")).default;
  const billing = await import("../../src/server/billing");
  const gen = await import("../../src/server/generation");
  const storage = await import("../../src/server/storage");
  const { probeMedia } = await import("../../src/server/providers/ffmpeg");
  const { decodeSampleJobId } = await import("../../src/server/providers/sample/job-id");
  const { closeJobQueue } = await import("../../src/server/jobs");
  const { closeDb, getDb } = await import("../../src/server/db/client");
  const { creditLedger, generation } = await import("../../src/server/db/schema");
  const { eq } = await import("drizzle-orm");
  const { generationRunHandler } = await import("./generation-run");
  const { createGenerationFixtures } =
    await import("../../src/server/test-support/generation-fixtures");
  const fixtures = createGenerationFixtures();
  const tmp = await mkdtemp(join(tmpdir(), "blaxzy-video-it-"));

  afterAll(async () => {
    await fixtures.cleanup();
    await closeJobQueue();
    await dropSchema(jobSchema);
    await closeDb();
    await rm(tmp, { recursive: true, force: true });
  });

  const run = (generationId: string, attempt = 1) =>
    generationRunHandler.run({ generationId }, jobContext(attempt));

  async function funded(credits = 200) {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    if (credits > 0) await billing.grantCredits({ userId, amount: credits });
    return { userId, projectId };
  }

  async function row(generationId: string) {
    const [r] = await getDb().select().from(generation).where(eq(generation.id, generationId));
    if (!r) throw new Error("generation row missing");
    return r;
  }

  async function entries(generationId: string) {
    const rows = await getDb()
      .select({ type: creditLedger.type, amount: creditLedger.amount })
      .from(creditLedger)
      .where(eq(creditLedger.generationId, generationId));
    return rows.map((e) => `${e.type}:${e.amount}`).sort();
  }

  async function requestOnly(input: Parameters<typeof gen.requestGeneration>[0]) {
    return getDb().transaction((tx) => gen.requestGeneration(input, tx));
  }

  /** Downloads a stored file to disk and probes it with ffmpeg. */
  async function probeStored(fileId: string) {
    const path = join(tmp, `${fileId}.mp4`);
    const { stream } = await storage.openFileStream(fileId);
    await pipeline(stream, createWriteStream(path));
    return probeMedia(path);
  }

  async function draftFor(userId: string, projectId: string, extra: { sound?: boolean } = {}) {
    const draft = await requestOnly({
      userId,
      projectId,
      purpose: "block_draft",
      prompt: "Tomas walks along the harbour wall at dawn",
      label: "Harbour at dawn",
      durationSeconds: 3,
      style: TEST_STYLE,
      maxCredits: 1_000,
      ...extra,
    });
    await run(draft.generationId);
    return draft.generationId;
  }

  describe.skipIf(!hasFfmpeg)("rendering", () => {
    it("draft → succeeded: a playable MP4 of the asked duration and aspect, a poster, 20 credits", async () => {
      const { userId, projectId } = await funded(100);
      const finished: { status: string; posterFileId: string | null | undefined }[] = [];
      const off = gen.onGenerationFinished(async (g) => {
        finished.push({ status: g.status, posterFileId: g.posterFileId });
      });
      try {
        expect(await gen.quoteGeneration({ purpose: "block_draft", style: TEST_STYLE })).toEqual({
          priceCredits: 20,
        });
        const draft = await requestOnly({
          userId,
          projectId,
          purpose: "block_draft",
          prompt: "Tomas walks along the harbour wall at dawn",
          label: "Harbour at dawn",
          durationSeconds: 4,
          style: TEST_STYLE,
          maxCredits: 1_000,
        });
        expect(draft.priceCredits).toBe(20);
        expect(await billing.getBalance(userId)).toBe(80);
        await run(draft.generationId);

        const done = await gen.getGeneration(draft.generationId, userId);
        expect(done).toMatchObject({
          status: "succeeded",
          kind: "video",
          model: "seedance_2_5",
          isSample: true,
          params: { aspectRatio: "16:9", resolution: "480p", durationSeconds: 4, sound: false },
        });
        const videoId = done?.resultFileId ?? "";
        expect(await storage.getOwnedFileInfo(videoId, userId)).toMatchObject({
          mimeType: "video/mp4",
          projectId,
          status: "ready",
        });
        const probe = await probeStored(videoId);
        expect(probe.video).toEqual({
          codec: "h264",
          pixelFormat: "yuv420p",
          width: 854,
          height: 480,
        });
        expect(probe.durationSeconds).toBeGreaterThanOrEqual(3.95);
        expect(probe.durationSeconds).toBeLessThanOrEqual(4.1);
        expect(probe.audio).toBeNull();

        const posterId = done?.posterFileId ?? "";
        expect(await storage.getOwnedFileInfo(posterId, userId)).toMatchObject({
          mimeType: "image/jpeg",
          status: "ready",
        });
        const posterMeta = await sharp(await storage.readFileBytes(posterId)).metadata();
        expect([posterMeta.format, posterMeta.width, posterMeta.height]).toEqual([
          "jpeg",
          854,
          480,
        ]);

        expect(await entries(draft.generationId)).toEqual(["reserve:-20", "settle:0"]);
        expect(await billing.getBalance(userId)).toBe(80);
        expect(finished).toEqual([{ status: "succeeded", posterFileId: posterId }]);

        // The hook gets the poster again when the run is repeated.
        await run(draft.generationId);
        expect(finished[1]).toEqual({ status: "succeeded", posterFileId: posterId });
      } finally {
        off();
      }
    });

    it("final from the draft → 1080p, the same clip's seed, sound, 60 credits", async () => {
      const { userId, projectId } = await funded(200);
      const draftId = await draftFor(userId, projectId);
      const final = await requestOnly({
        userId,
        projectId,
        purpose: "block_final",
        prompt: "Tomas walks along the harbour wall at dawn",
        label: "Harbour at dawn",
        durationSeconds: 3,
        sound: true,
        draftGenerationId: draftId,
        style: TEST_STYLE,
        maxCredits: 1_000,
      });
      expect(final.priceCredits).toBe(60);
      await run(final.generationId);
      const done = await row(final.generationId);
      expect(done.status).toBe("succeeded");
      expect(done.params).toMatchObject({ resolution: "1080p", draftGenerationId: draftId });
      const probe = await probeStored(done.resultFileId ?? "");
      expect(probe.video).toMatchObject({ width: 1920, height: 1080, pixelFormat: "yuv420p" });
      expect(probe.audio).toEqual({ codec: "aac" });
      expect(probe.durationSeconds).toBeGreaterThanOrEqual(2.95);
      expect(probe.durationSeconds).toBeLessThanOrEqual(3.1);

      const draftRow = await row(draftId);
      expect(decodeSampleJobId(done.providerJobId ?? "")?.d).toBe(
        decodeSampleJobId(draftRow.providerJobId ?? "")?.d,
      );
      expect(await entries(final.generationId)).toEqual(["reserve:-60", "settle:0"]);
      expect(await billing.getBalance(userId)).toBe(200 - 20 - 60);
    });

    it("[[fail]] → failed and the 20 credits refunded", async () => {
      const { userId, projectId } = await funded(50);
      const { generationId } = await requestOnly({
        userId,
        projectId,
        purpose: "block_draft",
        prompt: "a storm [[fail]]",
        durationSeconds: 2,
        style: TEST_STYLE,
        maxCredits: 1_000,
      });
      expect(await billing.getBalance(userId)).toBe(30);
      await run(generationId);
      const failed = await gen.getGeneration(generationId, userId);
      expect(failed).toMatchObject({ status: "failed", resultFileId: null, posterFileId: null });
      expect(failed?.error).toContain("asked to fail");
      expect(await entries(generationId)).toEqual(["refund:20", "reserve:-20"]);
      expect(await billing.getBalance(userId)).toBe(50);
    });

    it("refuses a final whose draft is not a usable draft of this user and project", async () => {
      const { userId, projectId } = await funded(200);
      const stranger = await funded(200);
      const theirDraft = await draftFor(stranger.userId, stranger.projectId);
      const otherProject = await fixtures.newProject(userId);
      const draftElsewhere = await draftFor(userId, otherProject);
      const failedDraft = await requestOnly({
        userId,
        projectId,
        purpose: "block_draft",
        prompt: "[[fail]]",
        durationSeconds: 1,
        style: TEST_STYLE,
        maxCredits: 1_000,
      });
      await run(failedDraft.generationId);
      const look = await requestOnly({
        userId,
        projectId,
        purpose: "asset_look",
        prompt: "a look",
        style: TEST_STYLE,
        maxCredits: 1_000,
      });
      await run(look.generationId);
      const balance = await billing.getBalance(userId);

      const final = (draftGenerationId?: string) =>
        gen.requestGeneration({
          userId,
          projectId,
          purpose: "block_final",
          prompt: "final",
          style: TEST_STYLE,
          maxCredits: 1_000,
          ...(draftGenerationId !== undefined ? { draftGenerationId } : {}),
        });
      await expect(final()).rejects.toThrow(/needs the accepted draft/);
      for (const id of [
        "not-a-uuid",
        "00000000-0000-4000-8000-000000000000",
        theirDraft,
        draftElsewhere,
        failedDraft.generationId,
        look.generationId,
      ]) {
        await expect(final(id)).rejects.toThrow(gen.GenerationInputError);
      }
      await expect(
        gen.requestGeneration({
          userId,
          projectId,
          purpose: "block_draft",
          prompt: "a draft from a draft",
          draftGenerationId: draftElsewhere,
          style: TEST_STYLE,
          maxCredits: 1_000,
        }),
      ).rejects.toThrow(/Only a final/);
      expect(await billing.getBalance(userId)).toBe(balance);
    });
  });

  describe("sweep", () => {
    // One fixed "now" for the rows' ages and for the sweep, so the cutoffs never depend on how long
    // the test took to set up.
    const NOW = new Date();
    const hours = (n: number) => new Date(NOW.getTime() - n * 60 * 60 * 1000);

    async function stuck(
      userId: string,
      projectId: string,
      status: "queued" | "running",
      at: Date,
    ): Promise<string> {
      const id = await fixtures.insertGeneration({ userId, projectId, status, priceCredits: 4 });
      await billing.reserve({ userId, generationId: id, amount: 4 });
      await getDb()
        .update(generation)
        .set({ createdAt: at, startedAt: status === "running" ? at : null })
        .where(eq(generation.id, id));
      return id;
    }

    it("fails and refunds stuck generations once, calls the hook once, leaves fresh ones", async () => {
      const { userId, projectId } = await funded(20);
      const stuckRunning = await stuck(userId, projectId, "running", hours(3));
      // Queued and never started: stuck only after the much longer queued limit (12 h).
      const stuckQueued = await stuck(userId, projectId, "queued", hours(13));
      const waitingQueued = await stuck(userId, projectId, "queued", hours(5));
      const fresh = await stuck(userId, projectId, "running", hours(0.5));
      // Queued long ago but started recently: not stuck.
      const restarted = await stuck(userId, projectId, "running", hours(0.2));
      await getDb()
        .update(generation)
        .set({ createdAt: hours(4) })
        .where(eq(generation.id, restarted));
      expect(await billing.getBalance(userId)).toBe(0);

      const calls: string[] = [];
      const off = gen.onGenerationFinished(async (g) => {
        calls.push(`${g.id}:${g.status}`);
      });
      try {
        const first = await gen.sweepStuckGenerations({ userId, stuckAfterMinutes: 120, now: NOW });
        expect(first.failed.sort()).toEqual([stuckRunning, stuckQueued].sort());
        // Waiting behind the per-user limit is not a failure; its run job is sent again.
        expect((await row(waitingQueued)).status).toBe("queued");
        expect(first.requeued).toEqual([waitingQueued]);
        for (const id of [stuckRunning, stuckQueued]) {
          const r = await row(id);
          expect(r).toMatchObject({ status: "failed", error: gen.STUCK_FAILURE });
          expect(r.finishedAt).not.toBeNull();
          expect(await entries(id)).toEqual(["refund:4", "reserve:-4"]);
        }
        expect(calls.sort()).toEqual([`${stuckRunning}:failed`, `${stuckQueued}:failed`].sort());
        for (const id of [fresh, restarted]) {
          expect((await row(id)).status).toBe("running");
          expect(await entries(id)).toEqual(["reserve:-4"]);
        }
        expect(await billing.getBalance(userId)).toBe(8);

        // Twice: nothing more changes, no hook is called again.
        const second = await gen.sweepStuckGenerations({
          userId,
          stuckAfterMinutes: 120,
          now: NOW,
        });
        expect(second.failed).toEqual([]);
        expect(calls).toHaveLength(2);
        expect(await billing.getBalance(userId)).toBe(8);

        // A run that arrives afterwards finds the generation finished and changes nothing.
        await run(stuckRunning);
        expect(await entries(stuckRunning)).toEqual(["refund:4", "reserve:-4"]);
      } finally {
        off();
      }
    });
  });
});
