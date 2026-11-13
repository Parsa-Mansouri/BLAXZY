/**
 * Integration-test support for billing and generations: reachability of Postgres and the S3
 * store, raw generation rows, and a cleanup of everything the users own (ledger, generations,
 * stored objects) before the script fixtures remove users and projects. Tests only.
 */
import { createFixtures } from "./script-fixtures";

export { servicesReachable } from "./integration";

export function createGenerationFixtures() {
  const base = createFixtures();
  const userIds: string[] = [];

  async function newUser(): Promise<string> {
    const id = await base.newUser();
    userIds.push(id);
    return id;
  }

  /** A raw generation row (bypasses the service), queued unless told otherwise. */
  async function insertGeneration(input: {
    userId: string;
    projectId: string;
    priceCredits?: number;
    status?: "queued" | "running";
    prompt?: string;
    referenceFileIds?: string[];
  }): Promise<string> {
    const { getDb } = await import("@/server/db/client");
    const { generation } = await import("@/server/db/schema");
    const [row] = await getDb()
      .insert(generation)
      .values({
        userId: input.userId,
        projectId: input.projectId,
        kind: "image",
        purpose: "asset_look",
        provider: "sample",
        model: "nano_banana_pro",
        params: { aspectRatio: "16:9" },
        prompt: input.prompt ?? "test",
        referenceFileIds: input.referenceFileIds ?? [],
        status: input.status ?? "queued",
        startedAt: input.status === "running" ? new Date() : null,
        priceCredits: input.priceCredits ?? 1,
      })
      .returning({ id: generation.id });
    if (!row) throw new Error("insert failed");
    return row.id;
  }

  async function cleanup(): Promise<void> {
    if (userIds.length > 0) {
      const { getDb } = await import("@/server/db/client");
      const s = await import("@/server/db/schema");
      const { inArray } = await import("drizzle-orm");
      const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
      const { getBucket, getS3 } = await import("@/server/storage/client");
      const db = getDb();
      await db.delete(s.creditLedger).where(inArray(s.creditLedger.userId, userIds));
      await db.delete(s.creditBalance).where(inArray(s.creditBalance.userId, userIds));
      await db.delete(s.generation).where(inArray(s.generation.userId, userIds));
      const files = await db
        .select({ key: s.file.storageKey })
        .from(s.file)
        .where(inArray(s.file.ownerId, userIds));
      for (const { key } of files) {
        await getS3()
          .send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }))
          .catch(() => undefined);
      }
    }
    await base.cleanup();
  }

  return { newUser, newProject: base.newProject, insertGeneration, cleanup };
}
