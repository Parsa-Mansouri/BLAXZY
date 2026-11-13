/**
 * The finished-pictures feed against the real local Postgres. Skipped when it is unreachable.
 */
import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { createFixtures, databaseReachable } from "@/server/test-support/script-fixtures";
import { formatFinishedCursor, parseFinishedCursor } from "./finished-feed";

describe("finished feed cursor", () => {
  it("round-trips and rejects anything else", () => {
    const at = "2026-11-12T10:00:00.123456Z";
    const id = "0b0e7a52-3c1d-4c58-9f0a-6f1f2f3a4b5c";
    expect(parseFinishedCursor(formatFinishedCursor(at, id))).toEqual({ at, id });
    for (const bad of [
      null,
      3,
      "",
      "now",
      `${at}_x`,
      `2026-11-12T10:00:00Z_${id}`,
      `${at}_${id}'`,
    ]) {
      expect(parseFinishedCursor(bad)).toBeNull();
    }
  });
});

const reachable = await databaseReachable();

describe.skipIf(!reachable)("finished feed (integration)", async () => {
  const assets = await import("@/server/assets");
  const { closeDb, getDb } = await import("@/server/db/client");
  const { asset, assetLook, assetSheet, file, project, projectEvent } =
    await import("@/server/db/schema");
  const { eq, inArray } = await import("drizzle-orm");
  const fixtures = createFixtures();
  const projectIds: string[] = [];

  afterAll(async () => {
    if (projectIds.length > 0) {
      const db = getDb();
      await db.delete(assetSheet).where(inArray(assetSheet.projectId, projectIds));
      await db.delete(assetLook).where(inArray(assetLook.projectId, projectIds));
    }
    await fixtures.cleanup();
    await closeDb();
  });

  const START = "2020-01-01T00:00:00.000000Z_00000000-0000-0000-0000-000000000000";

  async function setup() {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    projectIds.push(projectId);
    const db = getDb();
    const [a] = await db
      .insert(asset)
      .values({ projectId, kind: "character", name: "Ines", origin: "manual" })
      .returning({ id: asset.id });
    const [f] = await db
      .insert(file)
      .values({
        ownerId: userId,
        projectId,
        storageKey: `it/finished-feed/${projectId}`,
        mimeType: "image/png",
        sizeBytes: 1,
        status: "ready",
      })
      .returning({ id: file.id });
    if (!a || !f) throw new Error("setup failed");
    const [look] = await db
      .insert(assetLook)
      .values({
        assetId: a.id,
        projectId,
        versionNumber: 1,
        source: "generated",
        status: "in_review",
        fileId: f.id,
      })
      .returning({ id: assetLook.id });
    if (!look) throw new Error("setup failed");
    const [sheet] = await db
      .insert(assetSheet)
      .values({ assetId: a.id, projectId, lookId: look.id, versionNumber: 1, status: "failed" })
      .returning({ id: assetSheet.id });
    if (!sheet) throw new Error("setup failed");
    return { userId, projectId, assetId: a.id, fileId: f.id, lookId: look.id, sheetId: sheet.id };
  }

  /** Logs an event at a fixed past time (the feed holds back the last two seconds). */
  async function log(
    projectId: string,
    type: string,
    payload: Record<string, unknown>,
    at: string,
    id?: string,
  ) {
    const [row] = await getDb()
      .insert(projectEvent)
      .values({ ...(id ? { id } : {}), projectId, type, payload, createdAt: new Date(at) })
      .returning({ id: projectEvent.id });
    if (!row) throw new Error("setup failed");
    return row.id;
  }

  it("lists only the owner's finished looks and sheets, oldest first, with the picture", async () => {
    const mine = await setup();
    const theirs = await setup();
    const failed = await log(
      mine.projectId,
      "asset.sheet_failed",
      { assetId: mine.assetId, sheetId: mine.sheetId },
      "2024-05-01T10:00:02Z",
    );
    const ready = await log(
      mine.projectId,
      "asset.look_ready",
      { assetId: mine.assetId, lookId: mine.lookId },
      "2024-05-01T10:00:01Z",
    );
    await log(mine.projectId, "stage.changed", { to: "script" }, "2024-05-01T10:00:03Z");
    await log(
      theirs.projectId,
      "asset.look_ready",
      { assetId: theirs.assetId, lookId: theirs.lookId },
      "2024-05-01T10:00:01Z",
    );

    const page = await assets.listFinishedAssetEvents(mine.userId, START);
    expect(page.events.map((e) => e.id)).toEqual([ready, failed]);
    expect(page.events[0]).toMatchObject({
      what: "look",
      ready: true,
      projectId: mine.projectId,
      projectTitle: "Script IT",
      assetId: mine.assetId,
      assetName: "Ines",
      assetKind: "character",
      fileId: mine.fileId,
      orientation: "landscape",
    });
    expect(page.events[1]).toMatchObject({ what: "sheet", ready: false, fileId: null });

    // The returned cursor is past everything listed.
    const next = await assets.listFinishedAssetEvents(mine.userId, page.cursor);
    expect(next.events).toEqual([]);
    expect(next.cursor).toBe(page.cursor);
  });

  it("pages through events that share a time without dropping or repeating any", async () => {
    const s = await setup();
    const at = "2024-06-01T12:00:00.5Z";
    const prefix = s.projectId.slice(0, 8);
    const ids = [3, 1, 2].map((n) => `${prefix}-0000-4000-8000-00000000000${n}`);
    for (const id of ids) {
      await log(s.projectId, "asset.look_ready", { assetId: s.assetId, lookId: s.lookId }, at, id);
    }
    const later = await log(
      s.projectId,
      "asset.look_failed",
      { assetId: s.assetId, lookId: s.lookId },
      "2024-06-01T12:00:00.501Z",
    );
    const seen: string[] = [];
    let cursor = START;
    for (let i = 0; i < 6; i++) {
      const page = await assets.listFinishedAssetEvents(s.userId, cursor, 2);
      expect(page.events.length).toBeLessThanOrEqual(2);
      if (page.events.length === 0) break;
      seen.push(...page.events.map((e) => e.id));
      cursor = page.cursor;
    }
    expect(seen).toEqual([...ids].sort().concat(later));
  });

  it("starts at the present without a cursor, and holds back what was only just logged", async () => {
    const s = await setup();
    await log(
      s.projectId,
      "asset.look_ready",
      { assetId: s.assetId, lookId: s.lookId },
      "2024-07-01T00:00:00Z",
    );
    for (const cursor of [null, "nonsense"]) {
      const first = await assets.listFinishedAssetEvents(s.userId, cursor);
      expect(first.events).toEqual([]);
      expect(assets.parseFinishedCursor(first.cursor)).not.toBeNull();
    }
    // A cursor from ten seconds ago (by the database's clock), and two events after it: one
    // logged five seconds ago (settled) and one logged now (held back). Explicit times instead of
    // waiting out the settle window.
    const { sql } = await import("drizzle-orm");
    const ago = await getDb().execute<{ at: string }>(
      sql`select to_char((now() - interval '10 seconds') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at`,
    );
    const start = formatFinishedCursor(ago.rows[0]!.at, "ffffffff-ffff-ffff-ffff-ffffffffffff");
    const [settled] = await getDb()
      .insert(projectEvent)
      .values({
        projectId: s.projectId,
        type: "asset.look_ready",
        payload: { assetId: s.assetId, lookId: s.lookId },
        createdAt: sql`now() - interval '5 seconds'`,
      })
      .returning({ id: projectEvent.id });
    await getDb()
      .insert(projectEvent)
      .values({
        projectId: s.projectId,
        type: "asset.look_ready",
        payload: { assetId: s.assetId, lookId: s.lookId },
      });
    const listed = await assets.listFinishedAssetEvents(s.userId, start);
    expect(listed.events.map((e) => e.id)).toEqual([settled?.id]);
  });

  it("leaves out archived projects", async () => {
    const s = await setup();
    await log(
      s.projectId,
      "asset.look_ready",
      { assetId: s.assetId, lookId: s.lookId },
      "2024-08-01T00:00:00Z",
    );
    expect((await assets.listFinishedAssetEvents(s.userId, START)).events).toHaveLength(1);
    await getDb()
      .update(project)
      .set({ archivedAt: new Date() })
      .where(eq(project.id, s.projectId));
    expect((await assets.listFinishedAssetEvents(s.userId, START)).events).toEqual([]);
  });
});
