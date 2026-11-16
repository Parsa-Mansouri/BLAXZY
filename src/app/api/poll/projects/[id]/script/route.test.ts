import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  checkRateLimit: vi.fn(),
  getScriptState: vi.fn(),
  getProjectForUser: vi.fn(),
}));

vi.mock("@/server/auth", () => ({ getSession: () => mocks.getSession() }));
vi.mock("@/server/ratelimit", () => ({
  checkRateLimit: (input: unknown) => mocks.checkRateLimit(input),
}));
vi.mock("@/server/script", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/script")>()),
  getScriptState: (...args: unknown[]) => mocks.getScriptState(...args),
}));

vi.mock("@/server/projects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/projects")>()),
  getProjectForUser: (...args: unknown[]) => mocks.getProjectForUser(...args),
}));

const { GET } = await import("./route");

const PROJECT = "7f9c2a1e-3b4d-4c5e-8f60-123456789abc";
const VERSION = "11111111-2222-4333-8444-555555555555";
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const request = () => new Request("http://localhost/api/poll/x");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ user: { id: "u1", emailVerified: true } });
  mocks.checkRateLimit.mockResolvedValue({ ok: true });
  mocks.getProjectForUser.mockResolvedValue({ title: "Salt" });
});

describe("GET /api/poll/projects/[id]/script", () => {
  it("answers the latest version, its status and the project title", async () => {
    mocks.getScriptState.mockResolvedValue({ current: { id: VERSION, status: "pending" } });
    const res = await GET(request(), context(PROJECT));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ versionId: VERSION, status: "pending", title: "Salt" });
    expect(mocks.getScriptState).toHaveBeenCalledWith(PROJECT, "u1");
  });

  it("answers nulls for a project without a version and null for a missing project", async () => {
    mocks.getScriptState.mockResolvedValue({ current: null });
    expect(await (await GET(request(), context(PROJECT))).json()).toEqual({
      versionId: null,
      status: null,
      title: "Salt",
    });
    mocks.getScriptState.mockResolvedValue(null);
    expect(await (await GET(request(), context(PROJECT))).json()).toBeNull();
  });

  it("answers 400 for a malformed id without calling the service, and 401 signed out", async () => {
    expect((await GET(request(), context("not-a-uuid"))).status).toBe(400);
    expect(mocks.getScriptState).not.toHaveBeenCalled();
    mocks.getSession.mockResolvedValue(null);
    expect((await GET(request(), context(PROJECT))).status).toBe(401);
  });
});
