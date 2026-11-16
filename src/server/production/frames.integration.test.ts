/**
 * Cut detection, frame extraction and frame storage against a real clip: two sample-provider
 * clips, the second one colour-inverted, joined into one (a hard cut at 2 s), then ffmpeg, sharp, the
 * local Postgres and the S3 store. Needs ffmpeg, Postgres and the bucket (see the README).
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ffmpegReady, servicesReachable } from "@/server/test-support/integration";

const ready = (await servicesReachable()) && (await ffmpegReady());

describe.skipIf(!ready)("review frames (integration)", async () => {
  const { eq, inArray } = await import("drizzle-orm");
  const { getDb, closeDb } = await import("@/server/db/client");
  const { file, user } = await import("@/server/db/schema");
  const { getBucket, getS3 } = await import("@/server/storage/client");
  const { readFileBytes } = await import("@/server/storage/objects");
  const { runFfmpeg } = await import("@/server/providers/ffmpeg");
  const { renderSampleVideo, saveResult } = await import("@/server/providers/sample/video");
  const { default: sharp } = await import("sharp");
  const frames = await import("./frames");

  const ownerId = `it-frames-${randomUUID()}`;
  let dir = "";
  let clip = "";

  const render = async (digest: string, label: string, name: string) => {
    const path = join(dir, name);
    await saveResult(
      await renderSampleVideo({
        purpose: "block_draft",
        label,
        aspectRatio: "16:9",
        resolution: "480p",
        durationSeconds: 2,
        sound: false,
        digest,
      }),
      path,
    );
    return path;
  };

  beforeAll(async () => {
    await getDb()
      .insert(user)
      .values({ id: ownerId, name: "Frames Test", email: `${ownerId}@example.test` });
    dir = await mkdtemp(join(tmpdir(), "frames-it-"));
    const a = await render("0".repeat(8) + "1".repeat(56), "Shot one", "a.mp4");
    const b = await render("f".repeat(8) + "7".repeat(56), "Shot two", "b.mp4");
    clip = join(dir, "clip.mp4");
    await runFfmpeg([
      ...["-loglevel", "error", "-i", a, "-i", b],
      ...["-filter_complex", "[1:v]negate[n];[0:v][n]concat=n=2:v=1:a=0[v]", "-map", "[v]"],
      ...["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-y", clip],
    ]);
  }, 120_000);

  afterAll(async () => {
    const db = getDb();
    const rows = await db.select().from(file).where(eq(file.ownerId, ownerId));
    for (const row of rows) {
      await getS3().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: row.storageKey }));
    }
    await db.delete(file).where(inArray(file.ownerId, [ownerId]));
    await db.delete(user).where(eq(user.id, ownerId));
    await closeDb();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("detects the hard cut near 2 s, from a path and from bytes", async () => {
    const fromPath = await frames.detectCuts(clip);
    expect(fromPath).toHaveLength(1);
    expect(fromPath[0]!.t).toBeGreaterThan(1.9);
    expect(fromPath[0]!.t).toBeLessThan(2.1);
    const fromBytes = await frames.detectCuts(new Uint8Array(await readFile(clip)));
    expect(fromBytes).toEqual(fromPath);
  }, 60_000);

  it("finds no cut in a clip without one", async () => {
    expect(await frames.detectCuts(join(dir, "a.mp4"))).toEqual([]);
  }, 60_000);

  it("rejects when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await expect(frames.detectCuts(clip, { signal: controller.signal })).rejects.toThrow("stop");
  });

  it("plans, extracts, stores and reads back labelled JPEG frames", async () => {
    const cuts = await frames.detectCuts(clip);
    const windows = [
      { label: "0-2s", startS: 0, endS: 2, shot: 1 },
      { label: "2-4s", startS: 2, endS: 4, shot: 2 },
    ];
    const plan = frames.planFrames({ durationS: 4, windows, cuts });
    expect(plan.length).toBeGreaterThanOrEqual(6);
    expect(plan.length).toBeLessThanOrEqual(16);
    expect(plan.some((f) => f.reason === "cut")).toBe(true);

    const extracted = await frames.extractFrames(
      clip,
      plan.map((f) => f.t),
    );
    expect(extracted).toHaveLength(plan.length);
    for (const frame of extracted) {
      const meta = await sharp(frame.bytes).metadata();
      expect(meta.format).toBe("jpeg");
      expect(Math.max(meta.width!, meta.height!)).toBe(768);
      expect(frame.bytes.byteLength).toBeGreaterThan(1000);
      expect(frame.bytes.byteLength).toBeLessThan(5 * 1024 * 1024);
    }
    // a frame before the cut and one after it really differ
    const before = extracted[plan.findIndex((f) => f.t > 1 && f.t < 2)]!;
    const after = extracted[plan.findIndex((f) => f.t > 3 && f.t < 4)]!;
    expect(Buffer.from(before.bytes).equals(Buffer.from(after.bytes))).toBe(false);

    const stored = await frames.storeReviewFrames({
      ownerId,
      projectId: null,
      takeKey: "take-it",
      frames: plan.map((f, i) => ({ id: f.id, t: f.t, bytes: extracted[i]!.bytes })),
    });
    expect(stored.map((s) => s.id)).toEqual(plan.map((f) => f.id));
    const rows = await getDb().select().from(file).where(eq(file.ownerId, ownerId));
    expect(rows).toHaveLength(plan.length);
    expect(rows.every((r) => r.status === "ready" && r.mimeType === "image/jpeg")).toBe(true);
    const back = await readFileBytes(stored[0]!.fileId);
    expect(Buffer.from(back).equals(Buffer.from(extracted[0]!.bytes))).toBe(true);
    // the labels the review message uses
    expect(plan[0]!.label).toMatch(/^FRAME f01 t=0\.1s window 0-2s planned shot 1$/);
  }, 120_000);

  it("extracts the final frame of the clip and survives a time past the end", async () => {
    const last = await frames.lastFrame(clip);
    const meta = await sharp(last.bytes).metadata();
    expect(meta.format).toBe("jpeg");
    expect(last.width).toBe(meta.width);
    const past = await frames.extractFrames(clip, [99]);
    expect(past).toHaveLength(1);
    expect(past[0]!.bytes.byteLength).toBeGreaterThan(1000);
  }, 60_000);

  it("refuses a frame that is not a JPEG at the storage boundary", async () => {
    await expect(
      frames.storeReviewFrames({
        ownerId,
        projectId: null,
        takeKey: "bad",
        frames: [{ id: "f01", t: 0.1, bytes: new Uint8Array([1, 2, 3, 4]) }],
      }),
    ).rejects.toMatchObject({ name: "StorageError" });
  });
});
