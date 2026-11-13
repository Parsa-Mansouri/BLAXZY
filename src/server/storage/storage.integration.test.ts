/**
 * Runs the storage module against the local Postgres and S3 store (`docker compose up -d`,
 * `pnpm db:migrate`). Skipped automatically when either is unreachable. Deletes the objects,
 * file rows and users it creates.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { servicesReachable } from "@/server/test-support/integration";

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
  const capped = `it-storage-${randomUUID()}`;
  const users = [owner, stranger, capped];

  beforeAll(async () => {
    await getDb()
      .insert(user)
      .values(users.map((id) => ({ id, name: "Storage Test", email: `${id}@example.test` })));
  });

  afterAll(async () => {
    const db = getDb();
    const rows = await db.select().from(file).where(inArray(file.ownerId, users));
    for (const row of rows) {
      await getS3().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: row.storageKey }));
    }
    await db.delete(file).where(inArray(file.ownerId, users));
    await db.delete(user).where(inArray(user.id, users));
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

  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const MiB = 1024 * 1024;

  async function objectExists(fileId: string): Promise<boolean> {
    const [row] = await getDb().select().from(file).where(eq(file.id, fileId));
    try {
      await getS3().send(
        new HeadObjectCommand({ Bucket: getBucket(), Key: row?.storageKey ?? "" }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async function statusOf(fileId: string): Promise<string | undefined> {
    const [row] = await getDb().select().from(file).where(eq(file.id, fileId));
    return row?.status;
  }

  it("discards an upload whose content is not what its type claims", async () => {
    const html = text("<html><script>alert(1)</script></html>");
    const ticket = await storage.createUpload({
      ownerId: owner,
      originalName: "innocent.png",
      mimeType: "image/png",
      sizeBytes: html.byteLength,
      purpose: "asset_image",
    });
    expect((await upload(ticket, html)).status).toBe(200);
    await expectCode(
      storage.confirmUpload({ fileId: ticket.fileId, ownerId: owner }),
      "upload_mismatch",
    );
    expect(await objectExists(ticket.fileId)).toBe(false);
    expect(await statusOf(ticket.fileId)).toBe("pending");
    await expectCode(storage.getDownloadUrl({ fileId: ticket.fileId, userId: owner }), "not_found");
  });

  it("cannot be overwritten through the presigned URL, before or after confirm", async () => {
    const original = new Uint8Array([...png.slice(0, 8), 1, 1, 1, 1]);
    const ticket = await storage.createUpload({
      ownerId: owner,
      originalName: "locked.png",
      mimeType: "image/png",
      sizeBytes: original.byteLength,
      purpose: "asset_image",
    });
    expect((await upload(ticket, original)).status).toBe(200);
    const second = await upload(ticket, new Uint8Array([...png.slice(0, 8), 2, 2, 2, 2]));
    expect(second.status).toBe(412);
    await storage.confirmUpload({ fileId: ticket.fileId, ownerId: owner });
    const third = await upload(ticket, new Uint8Array([...png.slice(0, 8), 3, 3, 3, 3]));
    expect(third.status).toBe(412);
    expect(await storage.readFileBytes(ticket.fileId)).toEqual(original);
    // A PUT that leaves out the condition is refused by the signature.
    const bare = await fetch(ticket.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: original,
    });
    expect(bare.ok).toBe(false);
  });

  it("caps the unfinished tickets one user may hold", async () => {
    await getDb()
      .insert(file)
      .values(
        Array.from({ length: storage.MAX_PENDING_UPLOADS_PER_OWNER }, () => {
          const id = randomUUID();
          return {
            id,
            ownerId: capped,
            storageKey: `u/${capped}/_/${id}/x.png`,
            mimeType: "image/png",
            sizeBytes: 10,
            status: "pending" as const,
          };
        }),
      );
    await expectCode(
      storage.createUpload({
        ownerId: capped,
        originalName: "one-more.png",
        mimeType: "image/png",
        sizeBytes: 10,
        purpose: "asset_image",
      }),
      "too_many_uploads",
    );
    // Other users are unaffected.
    await expect(
      storage.createUpload({
        ownerId: owner,
        originalName: "fine.png",
        mimeType: "image/png",
        sizeBytes: 10,
        purpose: "asset_image",
      }),
    ).resolves.toBeDefined();
  });

  it("sweeps abandoned tickets: object gone, row kept as abandoned, readers see nothing", async () => {
    const bytes = png.slice(0, 8);
    const ticket = await storage.createUpload({
      ownerId: owner,
      originalName: "stale.png",
      mimeType: "image/png",
      sizeBytes: bytes.byteLength,
      purpose: "asset_image",
    });
    expect((await upload(ticket, bytes)).status).toBe(200);
    await getDb()
      .update(file)
      .set({ createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) })
      .where(eq(file.id, ticket.fileId));
    const fresh = await storage.createUpload({
      ownerId: owner,
      originalName: "fresh.png",
      mimeType: "image/png",
      sizeBytes: 10,
      purpose: "asset_image",
    });

    // Two sweepers at once: the row is retired exactly once.
    const results = await Promise.all([
      storage.sweepAbandonedUploads({ batchSize: 1000 }),
      storage.sweepAbandonedUploads({ batchSize: 1000 }),
    ]);
    expect(results.reduce((sum, r) => sum + r.swept, 0)).toBeGreaterThanOrEqual(1);
    expect(await statusOf(ticket.fileId)).toBe("abandoned");
    expect(await objectExists(ticket.fileId)).toBe(false);
    expect(await statusOf(fresh.fileId)).toBe("pending");
    await expectCode(storage.confirmUpload({ fileId: ticket.fileId, ownerId: owner }), "not_found");
    await expectCode(storage.getDownloadUrl({ fileId: ticket.fileId, userId: owner }), "not_found");
    await expect(storage.openFileStream(ticket.fileId)).rejects.toMatchObject({
      code: "not_found",
    });
    expect(await storage.getOwnedFileInfo(ticket.fileId, owner)).toBeNull();
  });

  it("leaves a terminal row, not a pending one, when a server-side write fails", async () => {
    await expect(
      storage.putFileBytes({
        ownerId: owner,
        name: "doomed.png",
        mimeType: "image/png",
        purpose: "asset_image",
        bytes: png,
        signal: AbortSignal.abort(),
      }),
    ).rejects.toBeDefined();
    const rows = await getDb().select().from(file).where(eq(file.originalName, "doomed.png"));
    const mine = rows.filter((r) => r.ownerId === owner);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.status).toBe("abandoned");
    expect(await objectExists(mine[0]?.id ?? "")).toBe(false);
  });

  it("refuses worker bytes that do not fit their type, before writing anything", async () => {
    await expectCode(
      storage.putFileBytes({
        ownerId: owner,
        name: "fake.png",
        mimeType: "image/png",
        purpose: "asset_image",
        bytes: text("<svg onload=alert(1)>"),
      }),
      "upload_mismatch",
    );
    const rows = await getDb().select().from(file).where(eq(file.originalName, "fake.png"));
    expect(rows.filter((r) => r.ownerId === owner)).toHaveLength(0);
  });

  it("uploads a large stream in parts and reads it back intact", async () => {
    const size = 11 * MiB + 123;
    const payload = new Uint8Array(size);
    for (let i = 0; i < size; i += 4096) payload[i] = (i / 4096) % 251;
    const chunks: Buffer[] = [];
    for (let i = 0; i < size; i += 1_000_003) {
      chunks.push(Buffer.from(payload.subarray(i, Math.min(size, i + 1_000_003))));
    }
    const info = await storage.putFileBytes({
      ownerId: owner,
      name: "bundle.zip",
      mimeType: "application/zip",
      purpose: "export_zip",
      bytes: Readable.from(chunks),
      sizeBytes: size,
      multipart: { thresholdBytes: 5 * MiB, partSizeBytes: 5 * MiB },
    });
    expect(info).toMatchObject({ status: "ready", sizeBytes: size });
    const back = await storage.readFileBytes(info.id);
    expect(back.byteLength).toBe(size);
    expect(Buffer.compare(Buffer.from(back), Buffer.from(payload))).toBe(0);
  });

  it("abandons a multipart upload whose stream fails or has the wrong length", async () => {
    const multipart = { thresholdBytes: 5 * MiB, partSizeBytes: 5 * MiB };
    async function* short() {
      yield Buffer.alloc(6 * MiB, 1);
    }
    await expectCode(
      storage.putFileBytes({
        ownerId: owner,
        name: "short.zip",
        mimeType: "application/zip",
        purpose: "export_zip",
        bytes: Readable.from(short()),
        sizeBytes: 8 * MiB,
        multipart,
      }),
      "upload_mismatch",
    );
    async function* broken() {
      yield Buffer.alloc(6 * MiB, 1);
      throw new Error("source died");
    }
    await expect(
      storage.putFileBytes({
        ownerId: owner,
        name: "broken.zip",
        mimeType: "application/zip",
        purpose: "export_zip",
        bytes: Readable.from(broken()),
        sizeBytes: 8 * MiB,
        multipart,
      }),
    ).rejects.toThrow("source died");
    const rows = await getDb()
      .select()
      .from(file)
      .where(inArray(file.originalName, ["short.zip", "broken.zip"]));
    const mine = rows.filter((r) => r.ownerId === owner);
    expect(mine).toHaveLength(2);
    expect(mine.every((r) => r.status === "abandoned")).toBe(true);
    for (const row of mine) expect(await objectExists(row.id)).toBe(false);
  });

  it("pins the response type and forces a download for anything that is not media", async () => {
    const pdf = await storage.putFileBytes({
      ownerId: owner,
      name: "notes.pdf",
      mimeType: "application/pdf",
      purpose: "script_document",
      bytes: text("%PDF-1.4 test"),
    });
    const pdfResponse = await fetch(
      (await storage.getDownloadUrl({ fileId: pdf.id, userId: owner })).url,
    );
    expect(pdfResponse.headers.get("content-type")).toBe("application/pdf");
    expect(pdfResponse.headers.get("content-disposition")).toContain("attachment;");
    expect(pdfResponse.headers.get("cache-control")).toContain("private");
    await pdfResponse.arrayBuffer();

    const image = await storage.putFileBytes({
      ownerId: owner,
      name: "still.png",
      mimeType: "image/png",
      purpose: "asset_image",
      bytes: png,
    });
    const imageResponse = await fetch(
      (await storage.getDownloadUrl({ fileId: image.id, userId: owner })).url,
    );
    expect(imageResponse.headers.get("content-type")).toBe("image/png");
    expect(imageResponse.headers.get("content-disposition")).toBeNull();
    await imageResponse.arrayBuffer();
  });

  it("can require the reader to be the owner", async () => {
    const info = await storage.putFileBytes({
      ownerId: owner,
      name: "mine.png",
      mimeType: "image/png",
      purpose: "asset_image",
      bytes: png,
    });
    await expectCode(storage.readFileBytes(info.id, { ownerId: stranger }), "not_found");
    await expectCode(storage.openFileStream(info.id, { ownerId: stranger }), "not_found");
    expect(await storage.readFileBytes(info.id, { ownerId: owner })).toEqual(png);
  });

  it("stores worker output from bytes and from a stream", async () => {
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
