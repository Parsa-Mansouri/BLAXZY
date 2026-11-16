import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  checkRateLimit: vi.fn(),
  getDetectionPanel: vi.fn(),
}));

vi.mock("@/server/auth", () => ({ getSession: () => mocks.getSession() }));
vi.mock("@/server/ratelimit", () => ({
  checkRateLimit: (input: unknown) => mocks.checkRateLimit(input),
}));
vi.mock("@/server/assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/assets")>()),
  getDetectionPanel: (...args: unknown[]) => mocks.getDetectionPanel(...args),
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

describe("GET /api/poll/projects/[id]/pre-production/detection-panel", () => {
  it("answers the panel as the service gives it", async () => {
    const panel = {
      warnings: [{ tag: "MERGE_CHECK", text: "Ana and Anna" }],
      rounds: 0,
      maxRounds: 3,
      suggestion: null,
      busy: false,
      failure: null,
    };
    mocks.getDetectionPanel.mockResolvedValue(panel);
    const res = await GET(request(), context(PROJECT));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: panel });
    expect(mocks.getDetectionPanel).toHaveBeenCalledWith(PROJECT, "u1");
  });

  it("answers the failure result for a missing project and 400 for a bad id", async () => {
    mocks.getDetectionPanel.mockResolvedValue(null);
    const gone = await GET(request(), context(PROJECT));
    expect(await gone.json()).toEqual({
      ok: false,
      error: "This project no longer exists. It may have been archived.",
    });
    const bad = await GET(request(), context("nope"));
    expect(bad.status).toBe(400);
  });
});
