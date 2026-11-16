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
  /** The Director's data for the block (see `direction-fixtures`); old blocks have none. */
  direction?: unknown;
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
        ...(spec.direction !== undefined ? { direction: spec.direction } : {}),
      })),
    });
  }

  /**
   * Replaces the project's blocks with the sample Director's blocks for the Director fixture's
   * script (five blocks of the same family: Nora, Lina and Sam in the kitchen and on the front
   * step), stores the finished `direction` run they were written under, makes every asset of the
   * registry ready, and sets the script version's text. Returns the assets by name.
   */
  async function setDirectedBlocks(
    projectId: string,
    userId: string,
    scriptVersionId: string,
  ): Promise<{ assets: Record<string, { assetId: string; ref: string }>; blockCount: number }> {
    const { getDb } = await import("@/server/db/client");
    const { damiRun, direction, scriptVersion } = await import("@/server/db/schema");
    const { eq } = await import("drizzle-orm");
    const { replaceBlocks } = await import("@/server/blocks");
    const { directedBlocks } = await import("@/server/direction/blocks");
    const { directorInputSchema, directorOutputSchema } =
      await import("@/server/damis/director/schema");
    const { sampleDirector } = await import("@/server/damis/sample/director");
    const raw = (await import("@/server/damis/director/fixtures/input.json")).default;
    const input = directorInputSchema.parse({ ...raw, mode: "full" });
    const output = directorOutputSchema.parse(sampleDirector(input));
    const { blocks: written, ...header } = output;
    const registry = input.asset_registry;
    const bindings = [
      ...registry.characters.map((c) => ({
        id: c.char_id,
        kind: "character" as const,
        name: c.name,
      })),
      ...registry.locations.map((l) => ({ id: l.loc_id, kind: "location" as const, name: l.name })),
      ...registry.props.map((r) => ({ id: r.prop_id, kind: "prop" as const, name: r.name })),
    ].map((b) => ({ ...b, reference: true }));
    const assets: Record<string, { assetId: string; ref: string }> = {};
    for (const b of bindings) {
      const made = await readyAsset(projectId, userId, b.kind, b.name);
      assets[b.name] = { assetId: made.assetId, ref: made.ref };
    }
    const db = getDb();
    await db
      .update(scriptVersion)
      .set({ content: input.script })
      .where(eq(scriptVersion.id, scriptVersionId));
    const [run] = await db
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
    await db.insert(direction).values({
      projectId,
      scriptVersionId,
      blockMode: input.block_mode,
      mode: "full",
      status: "ready",
      header,
      context: {
        platform_config: input.platform_config,
        block_mode: input.block_mode,
        creative_bible: input.creative_bible,
        asset_registry: input.asset_registry,
        bindings,
      },
      damiRunIds: run ? [run.id] : [],
      finishedAt: new Date(),
    });
    await replaceBlocks({
      projectId,
      scriptVersionId,
      damiRunIds: run ? [run.id] : [],
      blocks: directedBlocks({
        blocks: written,
        script: input.script,
        bindings,
        runIds: written.map(() => run?.id),
      }),
    });
    return { assets, blockCount: written.length };
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
    setDirectedBlocks,
    cleanup,
  };
}
