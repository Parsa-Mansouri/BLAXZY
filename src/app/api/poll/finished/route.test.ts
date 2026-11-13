import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  checkRateLimit: vi.fn(),
  listFinishedAssetEvents: vi.fn(),
}));

vi.mock("@/server/auth", () => ({ getSession: () => mocks.getSession() }));
vi.mock("@/server/ratelimit", () => ({
  checkRateLimit: (input: unknown) => mocks.checkRateLimit(input),
}));
vi.mock("@/server/assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/assets")>()),
  listFinishedAssetEvents: (...args: unknown[]) => mocks.listFinishedAssetEvents(...args),
}));

const { GET } = await import("./route");

const noContext = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ user: { id: "u1", emailVerified: true } });
  mocks.checkRateLimit.mockResolvedValue({ ok: true });
});

describe("GET /api/poll/finished", () => {
  it("passes a missing cursor as null and the cursor text as it came", async () => {
    mocks.listFinishedAssetEvents.mockResolvedValue({ events: [], cursor: "c1" });
    await GET(new Request("http://localhost/api/poll/finished"), noContext);
    expect(mocks.listFinishedAssetEvents).toHaveBeenLastCalledWith("u1", null);

    const cursor = "2026-11-13T10:00:00.123456Z_7f9c2a1e-3b4d-4c5e-8f60-123456789abc";
    await GET(
      new Request(`http://localhost/api/poll/finished?cursor=${encodeURIComponent(cursor)}`),
      noContext,
    );
    expect(mocks.listFinishedAssetEvents).toHaveBeenLastCalledWith("u1", cursor);
  });

  it("answers the page as JSON, with dates as ISO text", async () => {
    mocks.listFinishedAssetEvents.mockResolvedValue({
      events: [{ id: "e1", createdAt: new Date("2026-11-13T10:00:00.000Z") }],
      cursor: "c2",
    });
    const res = await GET(new Request("http://localhost/api/poll/finished"), noContext);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      events: [{ id: "e1", createdAt: "2026-11-13T10:00:00.000Z" }],
      cursor: "c2",
    });
  });

  it("answers 401 signed out (no redirect)", async () => {
    mocks.getSession.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/poll/finished"), noContext);
    expect(res.status).toBe(401);
    expect(res.headers.get("location")).toBeNull();
  });
});
