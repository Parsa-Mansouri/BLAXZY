/**
 * Runs the storage module against the local Postgres and S3 store (`docker compose up -d`,
 * `pnpm db:migrate`). Skipped automatically when either is unreachable. Deletes the objects,
 * file rows and users it creates.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { DeleteObjectCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

async function servicesReachable(): Promise<boolean> {
  const { DATABASE_URL, S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } =
    process.env;
  if (!DATABASE_URL || !S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    return false;
  }
  const client = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000 });
  const s3 = new S3Client({
    endpoint: S3_ENDPOINT,
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
    maxAttempts: 1,
  });
  try {
    await client.connect();
    await client.query("select 1 from file limit 1");
    await s3.send(new HeadBucketCommand({ Bucket: S3_BUCKET }), {
      abortSignal: AbortSignal.timeout(2000),
    });
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
    s3.destroy();
  }
}

const reachable = await servicesReachable();
const text = (value: string) => new TextEncoder().encode(value);

describe.skipIf(!reachable)("storage (integration)", async () => {
  const { eq, inArray } = await import("drizzle-orm");
  const { getDb, closeDb } = await import("@/server/db/client");
  const { file, user } = await import("@/server/db/schema");
  const { getBucket, getS3 } = await import("@/server/storage/client");
  const storage = await import("@/server/storage");

  const owner = `it-storage-${randomUUID()}`;
  const stranger = `it-storage-${randomUUID()}`;

  beforeAll(async () => {
    await getDb()
      .insert(user)
      .values(
        [owner, stranger].map((id) => ({ id, name: "Storage Test", email: `${id}@example.test` })),
      );
  });

  afterAll(async () => {
    const db = getDb();
    const rows = await db
      .select()
      .from(file)
      .where(inArray(file.ownerId, [owner, stranger]));
    for (const row of rows) {
      await getS3().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: row.storageKey }));
    }
    await db.delete(file).where(inArray(file.ownerId, [owner, stranger]));
    await db.delete(user).where(inArray(user.id, [owner, stranger]));
    await closeDb();
  });

  async function expectCode(promise: Promise<unknown>, code: string) {
    await expect(promise).rejects.toMatchObject({ name: "StorageError", code });
  }

  async function upload(
    ticket: { uploadUrl: string; headers: Record<string, string> },
    body: Uint8Array<ArrayBuffer>,
  ) {
    return fetch(ticket.uploadUrl, { method: "PUT", headers: ticket.headers, body });
  }

  it("uploads directly, confirms, and serves the same bytes back", async () => {
    const bytes = text("INT. KITCHEN - NIGHT\nA kettle screams.\n");
    const ticket = await storage.createUpload({
      ownerId: owner,
      originalName: "../My Script (v1).txt",
      mimeType: "text/plain",
      sizeBytes: bytes.byteLength,
      purpose: "script_document",
    });
    const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_ENDPOINT ?? "";
    expect(ticket.uploadUrl.startsWith(publicEndpoint)).toBe(true);
    expect(ticket.method).toBe("PUT");

    const [pending] = await getDb().select().from(file).where(eq(file.id, ticket.fileId));
    expect(pending?.status).toBe("pending");
    expect(pending?.storageKey).toBe(`u/${owner}/_/${ticket.fileId}/My_Script_v1.txt`);
    expect(pending?.originalName).toBe("My Script (v1).txt");

    await expectCode(
      storage.confirmUpload({ fileId: ticket.fileId, ownerId: owner }),
      "not_uploaded",
    );
    const put = await upload(ticket, bytes);
    expect(put.status).toBe(200);

    const confirmed = await storage.confirmUpload({ fileId: ticket.fileId, ownerId: owner });
    expect(confirmed).toMatchObject({ status: "ready", sizeBytes: bytes.byteLength });
    // Idempotent.
    await expect(
      storage.confirmUpload({ fileId: ticket.fileId, ownerId: owner }),
    ).resolves.toMatchObject({ id: ticket.fileId, status: "ready" });

    const link = await storage.getDownloadUrl({ fileId: ticket.fileId, userId: owner });
    const download = await fetch(link.url);
    expect(download.status).toBe(200);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);

    const named = await storage.getDownloadUrl({
      fileId: ticket.fileId,
      userId: owner,
      downloadName: "Draft é.txt",
    });
    const namedDownload = await fetch(named.url);
    expect(namedDownload.headers.get("content-disposition")).toContain("attachment;");

    expect(await storage.readFileBytes(ticket.fileId)).toEqual(bytes);
  });

  it("gives another user nothing, and treats unknown ids the same way", async () => {
    const bytes = text("private");
    const ticket = await storage.createUpload({
      ownerId: owner,
      originalName: "private.md",
      mimeType: "text/markdown",
      sizeBytes: bytes.byteLength,
      purpose: "script_document",
    });
    await upload(ticket, bytes);

    await expectCode(
      storage.confirmUpload({ fileId: ticket.fileId, ownerId: stranger }),
      "not_found",
    );
    await storage.confirmUpload({ fileId: ticket.fileId, ownerId: owner });
    await expectCode(
      storage.getDownloadUrl({ fileId: ticket.fileId, userId: stranger }),
      "not_found",
    );
    await expectCode(storage.getDownloadUrl({ fileId: randomUUID(), userId: owner }), "not_found");
    await expectCode(storage.getDownloadUrl({ fileId: "not-a-uuid", userId: owner }), "not_found");
  });

  it("refuses a body whose size differs from the declared size", async () => {
    const ticket = await storage.createUpload({
      ownerId: owner,
      originalName: "short.txt",
      mimeType: "text/plain",
      sizeBytes: 5,
      purpose: "script_document",
    });
    const put = await upload(ticket, text("much longer than five bytes"));
    // The store refuses the signed length; if one did not, confirm still must.
    expect(put.ok).toBe(false);
    await expect(
      storage.confirmUpload({ fileId: ticket.fileId, ownerId: owner }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^(not_uploaded|upload_mismatch)$/) });
    await expectCode(storage.getDownloadUrl({ fileId: ticket.fileId, userId: owner }), "not_found");
  });

  it("refuses a different content type than the signed one", async () => {
    const bytes = text("hello");
    const ticket = await storage.createUpload({
      ownerId: owner,
      originalName: "hello.txt",
      mimeType: "text/plain",
      sizeBytes: bytes.byteLength,
      purpose: "script_document",
    });
    const put = await fetch(ticket.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "text/html" },
      body: bytes,
    });
    expect(put.ok).toBe(false);
  });

  it("refuses disallowed types and sizes before creating anything", async () => {
    const base = { ownerId: owner, purpose: "asset_image" } as const;
    await expectCode(
      storage.createUpload({
        ...base,
        originalName: "a.gif",
        mimeType: "image/gif",
        sizeBytes: 10,
      }),
      "invalid_file",
    );
    await expectCode(
      storage.createUpload({
        ...base,
        originalName: "a.exe",
        mimeType: "image/png",
        sizeBytes: 10,
      }),
      "invalid_file",
    );
    await expectCode(
      storage.createUpload({
        ...base,
        originalName: "huge.png",
        mimeType: "image/png",
        sizeBytes: 25 * 1024 * 1024 + 1,
      }),
      "invalid_file",
    );
    const rows = await getDb()
      .select()
      .from(file)
      .where(inArray(file.originalName, ["a.gif", "a.exe", "huge.png"]));
    expect(rows.filter((r) => r.ownerId === owner)).toHaveLength(0);
  });

  it("stores worker output from bytes and from a stream", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const fromBytes = await storage.putFileBytes({
      ownerId: owner,
      name: "sheet.png",
      mimeType: "image/png",
      purpose: "asset_image",
      bytes: png,
    });
    expect(fromBytes).toMatchObject({ status: "ready", sizeBytes: png.byteLength });
    expect(await storage.readFileBytes(fromBytes.id)).toEqual(png);

    const fromStream = await storage.putFileBytes({
      ownerId: owner,
      name: "sheet-2.png",
      mimeType: "image/png",
      purpose: "asset_image",
      bytes: Readable.from([png.slice(0, 4), png.slice(4)]),
      sizeBytes: png.byteLength,
    });
    const { stream, file: info } = await storage.openFileStream(fromStream.id);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
    expect(new Uint8Array(Buffer.concat(chunks))).toEqual(png);
    expect(info.mimeType).toBe("image/png");
  });
});
