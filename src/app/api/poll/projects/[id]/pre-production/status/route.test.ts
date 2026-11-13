import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  checkRateLimit: vi.fn(),
  getSectioningStatus: vi.fn(),
}));

vi.mock("@/server/auth", () => ({ getSession: () => mocks.getSession() }));
vi.mock("@/server/ratelimit", () => ({
  checkRateLimit: (input: unknown) => mocks.checkRateLimit(input),
}));
vi.mock("@/server/blocks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/blocks")>()),
  getSectioningStatus: (...args: unknown[]) => mocks.getSectioningStatus(...args),
}));

const { GET } = await import("./route");

const PROJECT = "7f9c2a1e-3b4d-4c5e-8f60-123456789abc";
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const request = () => new Request("http://localhost/api/poll/x");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ user: { id: "u1", emailVerified: true } });
  mocks.checkRateLimit.mockResolvedValue({ ok: true });
});

describe("GET /api/poll/projects/[id]/pre-production/status", () => {
  it("answers only the state and the block count", async () => {
    mocks.getSectioningStatus.mockResolvedValue({
      state: "running",
      blockCount: 4,
      failure: "internal detail",
    });
    const res = await GET(request(), context(PROJECT));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: "running", blockCount: 4 });
    expect(mocks.getSectioningStatus).toHaveBeenCalledWith(PROJECT, "u1");
  });

  it("answers null when the project is gone and 400 for a bad id", async () => {
    mocks.getSectioningStatus.mockResolvedValue(null);
    expect(await (await GET(request(), context(PROJECT))).json()).toBeNull();
    expect((await GET(request(), context("x"))).status).toBe(400);
  });
});
