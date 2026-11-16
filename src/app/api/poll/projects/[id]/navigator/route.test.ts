import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  checkRateLimit: vi.fn(),
  getProjectForUser: vi.fn(),
  getSectioningStatus: vi.fn(),
  countAssetsByKind: vi.fn(),
  getPreProductionNavigator: vi.fn(),
  getProductionNavigator: vi.fn(),
}));

vi.mock("@/server/auth", () => ({ getSession: () => mocks.getSession() }));
vi.mock("@/server/ratelimit", () => ({
  checkRateLimit: (input: unknown) => mocks.checkRateLimit(input),
}));
vi.mock("@/server/projects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/projects")>()),
  getProjectForUser: (...args: unknown[]) => mocks.getProjectForUser(...args),
}));
vi.mock("@/server/blocks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/blocks")>()),
  getSectioningStatus: (...args: unknown[]) => mocks.getSectioningStatus(...args),
}));
vi.mock("@/server/assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/assets")>()),
  countAssetsByKind: (...args: unknown[]) => mocks.countAssetsByKind(...args),
  getPreProductionNavigator: (...args: unknown[]) => mocks.getPreProductionNavigator(...args),
}));
vi.mock("@/server/production", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/production")>()),
  getProductionNavigator: (...args: unknown[]) => mocks.getProductionNavigator(...args),
}));

const { GET } = await import("./route");

const PROJECT = "7f9c2a1e-3b4d-4c5e-8f60-123456789abc";
const ASSET = "11111111-2222-4333-8444-555555555555";
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const request = () => new Request("http://localhost/api/poll/x");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ user: { id: "u1", emailVerified: true } });
  mocks.checkRateLimit.mockResolvedValue({ ok: true });
  mocks.getSectioningStatus.mockResolvedValue({
    state: "done",
    blockCount: 3,
    failure: null,
    resetBlocks: 0,
  });
  mocks.countAssetsByKind.mockResolvedValue({ character: 2 });
});

describe("GET /api/poll/projects/[id]/navigator", () => {
  it("answers null for a project that is not the user's, reading nothing else", async () => {
    mocks.getProjectForUser.mockResolvedValue(null);
    const res = await GET(request(), context(PROJECT));
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
    expect(mocks.getProjectForUser).toHaveBeenCalledWith(PROJECT, "u1");
    expect(mocks.getPreProductionNavigator).not.toHaveBeenCalled();
    expect(mocks.getProductionNavigator).not.toHaveBeenCalled();
  });

  it("reads only the open stages and answers the view with its signature", async () => {
    mocks.getProjectForUser.mockResolvedValue({
      id: PROJECT,
      title: "Salt",
      stage: "pre_production",
    });
    mocks.getPreProductionNavigator.mockResolvedValue({
      kinds: [{ kind: "character", toReview: 1, rendering: 1, failed: 0 }],
      busy: [{ id: ASSET, name: "Mara", kind: "character" }],
      moreBusy: 0,
    });
    const res = await GET(request(), context(PROJECT));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(mocks.getProductionNavigator).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      projectId: PROJECT,
      title: "Salt",
      script: { working: false, failed: false },
      preProduction: { kinds: [{ kind: "character", toReview: 1, rendering: true, failed: 0 }] },
      production: null,
      busy: {
        items: [
          {
            key: `asset:${ASSET}`,
            name: "Mara",
            href: `/projects/${PROJECT}/pre-production/assets/${ASSET}`,
          },
        ],
        more: 0,
      },
      working: true,
    });
    expect(body.stages.map((s: { status: string }) => s.status)).toEqual([
      "done",
      "done",
      "current",
      "locked",
    ]);
    expect(typeof body.signature).toBe("string");
  });

  it("answers 400 for a malformed id", async () => {
    expect((await GET(request(), context("x"))).status).toBe(400);
    expect(mocks.getProjectForUser).not.toHaveBeenCalled();
  });
});
