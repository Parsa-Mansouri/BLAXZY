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

/** Every key of `value`, at any depth. */
function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, inner]) => [key, ...allKeys(inner)]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ user: { id: "u1", emailVerified: true } });
  mocks.checkRateLimit.mockResolvedValue({ ok: true });
});

describe("GET /api/poll/projects/[id]/pre-production/detection-panel", () => {
  it("never sends the fix instructions", async () => {
    const followupChoice = { label: "Merge", value: "merge", instruction: "secret choice" };
    mocks.getDetectionPanel.mockResolvedValue({
      options: [
        {
          code: "D1",
          kind: "technical",
          label: "Two names are one person",
          needsText: false,
          proOnly: false,
          instruction: "SECRET fix prompt",
          instructionTemplate: "Merge {value} SECRET",
          instructionTemplateAuto: "SECRET auto",
          followup: {
            type: "choice",
            allowCustom: true,
            options: [followupChoice],
            steps: [{ type: "pick", allowCustom: false, options: [followupChoice] }],
          },
        },
      ],
      warnings: [{ tag: "MERGE_CHECK", text: "Ana and Anna" }],
      rounds: 0,
      maxRounds: 3,
      suggestion: null,
      busy: false,
      failure: null,
    });
    const res = await GET(request(), context(PROJECT));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(allKeys(body).filter((key) => key.startsWith("instruction"))).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("SECRET");
    expect(body.ok).toBe(true);
    expect(body.data.options[0]).toMatchObject({ code: "D1", takesValue: true });
    expect(body.data.warnings).toEqual([{ tag: "MERGE_CHECK", text: "Ana and Anna" }]);
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
