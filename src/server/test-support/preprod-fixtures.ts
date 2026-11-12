/**
 * Integration-test support for pre-production: projects already in the `pre_production` stage,
 * an accepted script version to hang blocks on, stored image/audio files, and a cleanup that
 * removes looks and sheets before the generation and script fixtures remove the rest. Tests only.
 */
import { createGenerationFixtures } from "./generation-fixtures";

export function createPreProductionFixtures() {
  const base = createGenerationFixtures();
  const projectIds: string[] = [];

  /** A styled project moved straight to `pre_production`. */
  async function newPreProductionProject(ownerId: string): Promise<string> {
    const { getDb } = await import("@/server/db/client");
    const { project } = await import("@/server/db/schema");
    const { eq } = await import("drizzle-orm");
    const projectId = await base.newProject(ownerId);
    await getDb().update(project).set({ stage: "pre_production" }).where(eq(project.id, projectId));
    projectIds.push(projectId);
    return projectId;
  }

  /** An accepted script version (blocks need one). */
  async function acceptedScript(projectId: string, userId: string): Promise<string> {
    const { getDb } = await import("@/server/db/client");
    const { scriptVersion } = await import("@/server/db/schema");
    const [row] = await getDb()
      .insert(scriptVersion)
      .values({
        projectId,
        versionNumber: 1,
        source: "edited",
        status: "accepted",
        content: "INT. LIGHTHOUSE - NIGHT\nTOMAS climbs the stairs.",
        createdBy: userId,
        decidedAt: new Date(),
      })
      .returning({ id: scriptVersion.id });
    if (!row) throw new Error("insert failed");
    return row.id;
  }

  /** A small ready PNG owned by the user. */
  async function storedImage(userId: string, projectId: string | null = null): Promise<string> {
    const sharp = (await import("sharp")).default;
    const { putFileBytes } = await import("@/server/storage");
    const bytes = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 40, g: 90, b: 160 } },
    })
      .png()
      .toBuffer();
    const info = await putFileBytes({
      ownerId: userId,
      projectId,
      name: "upload.png",
      mimeType: "image/png",
      purpose: "asset_image",
      bytes: new Uint8Array(bytes),
    });
    return info.id;
  }

  /** A small ready "recording" owned by the user (the bytes are not decoded). */
  async function storedAudio(userId: string, projectId: string | null = null): Promise<string> {
    const { putFileBytes } = await import("@/server/storage");
    const info = await putFileBytes({
      ownerId: userId,
      projectId,
      name: "voice.mp3",
      mimeType: "audio/mpeg",
      purpose: "asset_audio",
      bytes: new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
    });
    return info.id;
  }

  async function cleanup(): Promise<void> {
    if (projectIds.length > 0) {
      const { getDb } = await import("@/server/db/client");
      const { assetLook, assetSheet, assetSheetView } = await import("@/server/db/schema");
      const { inArray } = await import("drizzle-orm");
      await getDb().delete(assetSheetView).where(inArray(assetSheetView.projectId, projectIds));
      await getDb().delete(assetSheet).where(inArray(assetSheet.projectId, projectIds));
      await getDb().delete(assetLook).where(inArray(assetLook.projectId, projectIds));
    }
    await base.cleanup();
  }

  return {
    newUser: base.newUser,
    newPreProductionProject,
    newProject: base.newProject,
    acceptedScript,
    storedImage,
    storedAudio,
    cleanup,
  };
}
