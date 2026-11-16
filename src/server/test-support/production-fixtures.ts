/**
 * Integration-test support for Production: projects already in the `production` stage, ready
 * assets (an accepted look and sheet with stored images), blocks cut from an accepted script, and
 * a cleanup that removes takes, exports, looks and sheets before the generation and script
 * fixtures remove the rest. Tests only.
 */
import type { AssetKind } from "@/server/db/schema";
import { createGenerationFixtures } from "./generation-fixtures";

export type BlockSpec = {
  excerpt: string;
  prompt: string;
  assetRefs: string[];
  title?: string;
  durationSeconds?: number;
};

export function createProductionFixtures() {
  const base = createGenerationFixtures();
  const projectIds: string[] = [];

  /** A styled project moved straight to `production`, with an accepted script. */
  async function newProductionProject(
    ownerId: string,
  ): Promise<{ projectId: string; scriptVersionId: string }> {
    const { getDb } = await import("@/server/db/client");
    const { project, scriptVersion } = await import("@/server/db/schema");
    const { eq } = await import("drizzle-orm");
    const projectId = await base.newProject(ownerId);
    await getDb().update(project).set({ stage: "production" }).where(eq(project.id, projectId));
    projectIds.push(projectId);
    const [row] = await getDb()
      .insert(scriptVersion)
      .values({
        projectId,
        versionNumber: 1,
        source: "edited",
        status: "accepted",
        content: "INT. LIGHTHOUSE - NIGHT\nTOMAS climbs the stairs.",
        createdBy: ownerId,
        decidedAt: new Date(),
      })
      .returning({ id: scriptVersion.id });
    if (!row) throw new Error("insert failed");
    return { projectId, scriptVersionId: row.id };
  }

  async function storedPng(
    userId: string,
    projectId: string,
    purpose: "asset_image" | "sheet_image",
    shade: number,
  ): Promise<string> {
    const sharp = (await import("sharp")).default;
    const { putFileBytes } = await import("@/server/storage");
    const bytes = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: shade, g: 90, b: 160 } },
    })
      .png()
      .toBuffer();
    const info = await putFileBytes({
      ownerId: userId,
      projectId,
      name: `${purpose}.png`,
      mimeType: "image/png",
      purpose,
      bytes: new Uint8Array(bytes),
    });
    return info.id;
  }

  /** An active asset with an accepted look and an accepted sheet (ready). */
  async function readyAsset(
    projectId: string,
    userId: string,
    kind: AssetKind,
    name: string,
  ): Promise<{ assetId: string; lookFileId: string; sheetFileId: string; ref: string }> {
    const { getDb } = await import("@/server/db/client");
    const { asset, assetLook, assetSheet } = await import("@/server/db/schema");
    const db = getDb();
    const [created] = await db
      .insert(asset)
      .values({ projectId, kind, name, description: `${name}, as in the script.` })
      .returning({ id: asset.id });
    if (!created) throw new Error("insert failed");
    const lookFileId = await storedPng(userId, projectId, "asset_image", 40);
    const sheetFileId = await storedPng(userId, projectId, "sheet_image", 200);
    const [look] = await db
      .insert(assetLook)
      .values({
        assetId: created.id,
        projectId,
        versionNumber: 1,
        source: "uploaded",
        status: "accepted",
        fileId: lookFileId,
        createdBy: userId,
        decidedAt: new Date(),
      })
      .returning({ id: assetLook.id });
    if (!look) throw new Error("insert failed");
    await db.insert(assetSheet).values({
      assetId: created.id,
      projectId,
      lookId: look.id,
      versionNumber: 1,
      status: "accepted",
      fileId: sheetFileId,
      decidedAt: new Date(),
    });
    return { assetId: created.id, lookFileId, sheetFileId, ref: `${kind}:${name}` };
  }

  /** Replaces the project's blocks (as a finished direction does, with a Director run each call). */
  async function setBlocks(
    projectId: string,
    scriptVersionId: string,
    specs: BlockSpec[],
  ): Promise<void> {
    const { replaceBlocks } = await import("@/server/blocks");
    const { getDb } = await import("@/server/db/client");
    const { damiRun } = await import("@/server/db/schema");
    const [run] = await getDb()
      .insert(damiRun)
      .values({
        damiKey: "director",
        damiVersion: "test",
        model: "sample",
        status: "succeeded",
        projectId,
        input: {},
      })
      .returning({ id: damiRun.id });
    await replaceBlocks({
      projectId,
      scriptVersionId,
      damiRunIds: run ? [run.id] : [],
      blocks: specs.map((spec, i) => ({
        title: spec.title ?? `Shot ${i + 1}`,
        scriptExcerpt: spec.excerpt,
        prompt: spec.prompt,
        durationSeconds: spec.durationSeconds ?? 1,
        assetRefs: spec.assetRefs,
        orderIndex: i,
      })),
    });
  }

  async function cleanup(): Promise<void> {
    if (projectIds.length > 0) {
      const { getDb } = await import("@/server/db/client");
      const s = await import("@/server/db/schema");
      const { inArray } = await import("drizzle-orm");
      const db = getDb();
      await db.delete(s.exportBundle).where(inArray(s.exportBundle.projectId, projectIds));
      await db.delete(s.blockTake).where(inArray(s.blockTake.projectId, projectIds));
      await db.delete(s.assetSheetView).where(inArray(s.assetSheetView.projectId, projectIds));
      await db.delete(s.assetSheet).where(inArray(s.assetSheet.projectId, projectIds));
      await db.delete(s.assetLook).where(inArray(s.assetLook.projectId, projectIds));
    }
    await base.cleanup();
  }

  return {
    newUser: base.newUser,
    newProductionProject,
    readyAsset,
    setBlocks,
    cleanup,
  };
}
