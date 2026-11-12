/**
 * Asset detection diffs against the real local Postgres. Skipped when it is unreachable.
 */
import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import type { DetectedAsset } from "@/server/damis";
import { createFixtures, databaseReachable } from "@/server/test-support/script-fixtures";

const reachable = await databaseReachable();

describe.skipIf(!reachable)("assets service (integration)", async () => {
  const assets = await import("@/server/assets");
  const { closeDb, getDb } = await import("@/server/db/client");
  const { asset, damiRun, project, scriptVersion } = await import("@/server/db/schema");
  const { eq } = await import("drizzle-orm");
  const fixtures = createFixtures();

  afterAll(async () => {
    await fixtures.cleanup();
    await closeDb();
  });

  async function versionAndRun(projectId: string, versionNumber: number) {
    const db = getDb();
    const [run] = await db
      .insert(damiRun)
      .values({
        damiKey: "asset-detector",
        damiVersion: "1",
        model: "sample",
        projectId,
        input: {},
      })
      .returning({ id: damiRun.id });
    const [version] = await db
      .insert(scriptVersion)
      .values({ projectId, versionNumber, source: "edited", status: "accepted", content: "x" })
      .returning({ id: scriptVersion.id });
    if (!run || !version) throw new Error("setup failed");
    return { runId: run.id, versionId: version.id };
  }

  const detected = (kind: DetectedAsset["kind"], name: string): DetectedAsset => ({
    kind,
    name,
    description: `${name}, as described.`,
    appearsIn: ["Scene 1"],
  });

  it("diffs detections: add, keep, remove, reactivate; manual assets untouched", async () => {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    const first = await versionAndRun(projectId, 1);
    expect(await assets.hasDetectionFor(projectId, first.versionId)).toBe(false);

    const r1 = await assets.applyDetection({
      projectId,
      scriptVersionId: first.versionId,
      damiRunId: first.runId,
      assets: [
        detected("character", "Mara"),
        detected("character", "Jonas"),
        detected("location", "Harbour Pier"),
      ],
    });
    expect(r1).toEqual({ added: 3, kept: 0, removed: 0 });
    expect(await assets.hasDetectionFor(projectId, first.versionId)).toBe(true);

    // A manual asset the detector never sees.
    await getDb().insert(asset).values({ projectId, kind: "prop", name: "Hat", origin: "manual" });

    const second = await versionAndRun(projectId, 2);
    const r2 = await assets.applyDetection({
      projectId,
      scriptVersionId: second.versionId,
      damiRunId: second.runId,
      assets: [
        // The same name in other case and spacing is the same asset; it keeps its stored name.
        { ...detected("character", "  MARA "), description: "Now with a surname." },
        detected("prop", "Locket: [gold]"),
      ],
    });
    expect(r2).toEqual({ added: 1, kept: 1, removed: 2 });

    const all = await assets.listAssets(projectId, userId, { includeRemoved: true });
    const byName = new Map(all?.items.map((a) => [a.name, a]));
    expect(byName.get("Mara")).toMatchObject({
      description: "Now with a surname.",
      status: "active",
      firstScriptVersionId: first.versionId,
      lastScriptVersionId: second.versionId,
    });
    expect(byName.get("Jonas")?.status).toBe("removed");
    expect(byName.get("Harbour Pier")?.status).toBe("removed");
    expect(byName.get("Hat")).toMatchObject({ status: "active", origin: "manual" });

    const active = await assets.listAssets(projectId, userId);
    expect(active?.items.map((a) => a.name).sort()).toEqual(["Hat", "Locket - (gold)", "Mara"]);

    const third = await versionAndRun(projectId, 3);
    const r3 = await assets.applyDetection({
      projectId,
      scriptVersionId: third.versionId,
      damiRunId: third.runId,
      assets: [
        detected("character", "Mara"),
        detected("character", "Jonas"),
        detected("prop", "Locket - (gold)"),
      ],
    });
    expect(r3).toEqual({ added: 0, kept: 3, removed: 0 });
    const jonas = (await assets.listAssets(projectId, userId, { kind: "character" }))?.items.find(
      (a) => a.name === "Jonas",
    );
    expect(jonas?.status).toBe("active");

    expect(await assets.countAssetsByKind(projectId, userId)).toMatchObject({
      character: 2,
      prop: 2,
      location: 0,
      voice: 0,
    });
    const known = await assets.getKnownAssets(projectId);
    expect(known.map((k) => k.name).sort()).toEqual(
      ["Harbour Pier", "Hat", "Jonas", "Locket - (gold)", "Mara"].sort(),
    );
  });

  it("paginates and hides other users' assets", async () => {
    const userId = await fixtures.newUser();
    const other = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    const v = await versionAndRun(projectId, 1);
    await assets.applyDetection({
      projectId,
      scriptVersionId: v.versionId,
      damiRunId: v.runId,
      assets: ["a", "b", "c", "d", "e"].map((s) => detected("prop", s.toUpperCase())),
    });
    const page1 = await assets.listAssets(projectId, userId, { limit: 2 });
    const page2 = await assets.listAssets(projectId, userId, {
      limit: 2,
      cursor: page1?.nextCursor,
    });
    const page3 = await assets.listAssets(projectId, userId, {
      limit: 2,
      cursor: page2?.nextCursor,
    });
    expect(
      [...(page1?.items ?? []), ...(page2?.items ?? []), ...(page3?.items ?? [])].map(
        (a) => a.name,
      ),
    ).toEqual(["A", "B", "C", "D", "E"]);
    expect(page3?.nextCursor).toBeNull();
    expect(await assets.listAssets(projectId, other)).toBeNull();
    expect(await assets.countAssetsByKind(projectId, other)).toBeNull();
  });

  it("finds the next asset waiting for the user, in the overview's order", async () => {
    const userId = await fixtures.newUser();
    const other = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    await getDb().update(project).set({ stage: "pre_production" }).where(eq(project.id, projectId));
    const v = await versionAndRun(projectId, 1);
    await assets.applyDetection({
      projectId,
      scriptVersionId: v.versionId,
      damiRunId: v.runId,
      assets: [
        detected("prop", "Lamp"),
        detected("character", "Ines"),
        detected("location", "Lamp Room"),
        detected("character", "Tomas"),
      ],
    });
    const rows = await getDb()
      .select({ id: asset.id, name: asset.name })
      .from(asset)
      .where(eq(asset.projectId, projectId));
    const id = (name: string) => rows.find((r) => r.name === name)?.id ?? "";
    const next = async (name: string) =>
      (await assets.nextAssetNeedingInput(projectId, userId, id(name)))?.name ?? null;
    expect(await next("Ines")).toBe("Tomas");
    expect(await next("Tomas")).toBe("Lamp Room");
    expect(await next("Lamp Room")).toBe("Lamp");
    expect(await next("Lamp")).toBe("Ines");
    expect(await assets.nextAssetNeedingInput(projectId, other, id("Ines"))).toBeNull();
  });
});
