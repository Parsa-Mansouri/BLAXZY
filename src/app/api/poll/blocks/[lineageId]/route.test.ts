import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  checkRateLimit: vi.fn(),
  getBlockDetail: vi.fn(),
}));

vi.mock("@/server/auth", () => ({ getSession: () => mocks.getSession() }));
vi.mock("@/server/ratelimit", () => ({
  checkRateLimit: (input: unknown) => mocks.checkRateLimit(input),
}));
vi.mock("@/server/production", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/production")>()),
  getBlockDetail: (...args: unknown[]) => mocks.getBlockDetail(...args),
}));
vi.mock("@/app/(app)/projects/[id]/production/blocks/_lib/block-key", () => ({
  blockKey: () => "fingerprint-1",
}));

const { GET } = await import("./route");

const LINEAGE = "7f9c2a1e-3b4d-4c5e-8f60-123456789abc";
const context = (lineageId: string) => ({ params: Promise.resolve({ lineageId }) });
const request = () => new Request("http://localhost/api/poll/x");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ user: { id: "u1", emailVerified: true } });
  mocks.checkRateLimit.mockResolvedValue({ ok: true });
});

describe("GET /api/poll/blocks/[lineageId]", () => {
  it("answers the fingerprint string, or null when the shot is gone", async () => {
    mocks.getBlockDetail.mockResolvedValue({ stage: "preparing" });
    const res = await GET(request(), context(LINEAGE));
    expect(await res.json()).toBe("fingerprint-1");
    expect(mocks.getBlockDetail).toHaveBeenCalledWith(LINEAGE, "u1");

    mocks.getBlockDetail.mockResolvedValue(null);
    expect(await (await GET(request(), context(LINEAGE))).json()).toBeNull();
  });

  it("answers 400 for a malformed id and 429 over the limit", async () => {
    expect((await GET(request(), context("nope"))).status).toBe(400);
    expect(mocks.getBlockDetail).not.toHaveBeenCalled();
    mocks.checkRateLimit.mockResolvedValue({ ok: false, reason: "limited", retryAfterSeconds: 3 });
    const limited = await GET(request(), context(LINEAGE));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("3");
  });
});
