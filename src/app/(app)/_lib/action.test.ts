import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getSession: vi.fn(),
  checkRateLimit: vi.fn(),
  revalidatePath: vi.fn(),
  completeProduction: vi.fn(),
  loadBackgroundStatus: vi.fn(),
  createUpload: vi.fn(),
  getDetectionPanel: vi.fn(),
  startDrafts: vi.fn(),
}));

vi.mock("@/server/auth", () => ({
  requireUser: () => mocks.requireUser(),
  getSession: () => mocks.getSession(),
}));
vi.mock("@/server/ratelimit", () => ({
  checkRateLimit: (input: unknown) => mocks.checkRateLimit(input),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/server/production", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/production")>()),
  completeProduction: (input: unknown) => mocks.completeProduction(input),
  startDrafts: (input: unknown) => mocks.startDrafts(input),
}));
vi.mock("@/server/assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/assets")>()),
  getDetectionPanel: (...args: unknown[]) => mocks.getDetectionPanel(...args),
}));
vi.mock("@/server/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/storage")>()),
  createUpload: (input: unknown) => mocks.createUpload(input),
}));
vi.mock("../projects/[id]/_lib/background-status", () => ({
  loadBackgroundStatus: (...args: unknown[]) => mocks.loadBackgroundStatus(...args),
}));

const {
  clampCount,
  isUuid,
  pollAction,
  pollFailure,
  pollNull,
  SERVER_PROBLEM,
  SIGNED_OUT,
  TOO_MANY_REQUESTS,
  TOO_MANY_UPLOADS,
  userAction,
} = await import("./action");
const { issueUploadTicket, uploadIncomplete } = await import("./upload-ticket");
const { AssetInputError } = await import("@/server/assets");
const { StorageError } = await import("@/server/storage");

const user = { id: "u1", emailVerified: true };
const PROJECT = "7f9c2a1e-3b4d-4c5e-8f60-123456789abc";

const logged = vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue(user);
  mocks.getSession.mockResolvedValue({ user });
  mocks.checkRateLimit.mockResolvedValue({ ok: true });
});

describe("userAction", () => {
  it("lets requireUser's redirect through and does nothing else", async () => {
    mocks.requireUser.mockRejectedValue(new Error("NEXT_REDIRECT"));
    const fn = vi.fn();
    await expect(userAction("mutate", "t", fn)).rejects.toThrow("NEXT_REDIRECT");
    expect(fn).not.toHaveBeenCalled();
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
  });

  it("checks the bucket for the user, then runs the action", async () => {
    await expect(
      userAction("expensive", "t", async (u) => ({ ok: true, id: u.id })),
    ).resolves.toEqual({ ok: true, id: "u1" });
    expect(mocks.checkRateLimit).toHaveBeenCalledWith({ userId: "u1", bucket: "expensive" });
  });

  it("answers the uniform message when rate limited, without running the action", async () => {
    mocks.checkRateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 3, reason: "limited" });
    const fn = vi.fn();
    await expect(userAction("mutate", "t", fn)).resolves.toEqual({
      ok: false,
      error: TOO_MANY_REQUESTS,
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("answers the server problem when a fail-closed limiter is unavailable", async () => {
    mocks.checkRateLimit.mockResolvedValue({
      ok: false,
      retryAfterSeconds: 5,
      reason: "unavailable",
    });
    await expect(userAction("expensive", "t", vi.fn())).resolves.toEqual({
      ok: false,
      error: SERVER_PROBLEM,
    });
  });

  it("shows a service input error's message and does not log it", async () => {
    const result = await userAction("mutate", "t", async () => {
      throw new AssetInputError("That name is taken.");
    });
    expect(result).toEqual({ ok: false, error: "That name is taken." });
    expect(logged).not.toHaveBeenCalled();
  });

  it("logs an unexpected error with the tag and answers the server problem", async () => {
    const result = await userAction("mutate", "dashboard.rename", async () => {
      throw new Error("connection reset");
    });
    expect(result).toEqual({ ok: false, error: SERVER_PROBLEM });
    const line = String(logged.mock.calls[0]?.[0]);
    expect(line).toContain("dashboard.rename");
    expect(line).toContain("connection reset");
  });

  it("maps too many pending uploads, and lets mapError go first", async () => {
    const tooMany = new StorageError("too_many_uploads", "internal wording");
    await expect(
      userAction("upload", "t", async () => {
        throw tooMany;
      }),
    ).resolves.toEqual({ ok: false, error: TOO_MANY_UPLOADS });
    await expect(
      userAction(
        "mutate",
        "t",
        async () => {
          throw new StorageError("not_uploaded", "x");
        },
        { mapError: uploadIncomplete("Add it again.") },
      ),
    ).resolves.toEqual({ ok: false, error: "Add it again." });
  });
});

describe("pollAction", () => {
  it("never redirects: signed out or unverified answers the quiet value", async () => {
    mocks.getSession.mockResolvedValue(null);
    await expect(pollAction("p", pollNull, vi.fn())).resolves.toBeNull();
    mocks.getSession.mockResolvedValue({ user: { id: "u1", emailVerified: false } });
    await expect(pollAction("p", pollFailure, vi.fn())).resolves.toEqual({
      ok: false,
      error: SIGNED_OUT,
    });
    expect(mocks.requireUser).not.toHaveBeenCalled();
  });

  it("uses the poll bucket and answers quietly when limited", async () => {
    mocks.checkRateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 3, reason: "limited" });
    const fn = vi.fn();
    await expect(pollAction("p", pollFailure, fn)).resolves.toEqual({
      ok: false,
      error: TOO_MANY_REQUESTS,
    });
    expect(mocks.checkRateLimit).toHaveBeenCalledWith({ userId: "u1", bucket: "poll" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("answers quietly and logs when the session lookup or the poll fails", async () => {
    mocks.getSession.mockRejectedValue(new Error("db down"));
    await expect(pollAction("p.session", pollNull, vi.fn())).resolves.toBeNull();
    mocks.getSession.mockResolvedValue({ user });
    await expect(
      pollAction("p.body", pollNull, async () => {
        throw new Error("boom");
      }),
    ).resolves.toBeNull();
    expect(logged).toHaveBeenCalledTimes(2);
  });

  it("returns the poll's own answer", async () => {
    await expect(pollAction("p", pollNull, async () => "key-1")).resolves.toBe("key-1");
  });
});

describe("helpers", () => {
  it("isUuid accepts only UUIDs", () => {
    expect(isUuid(PROJECT)).toBe(true);
    expect(isUuid("../../dashboard")).toBe(false);
    expect(isUuid(`${PROJECT}/x`)).toBe(false);
    expect(isUuid(42)).toBe(false);
  });

  it("clampCount treats anything but a finite number as the minimum", () => {
    expect(clampCount(Number.NaN, 24, 500)).toBe(24);
    expect(clampCount(Number.POSITIVE_INFINITY, 24, 500)).toBe(24);
    expect(clampCount("30", 24, 500)).toBe(24);
    expect(clampCount(30.7, 24, 500)).toBe(30);
    expect(clampCount(10_000, 24, 500)).toBe(500);
  });
});

describe("issueUploadTicket", () => {
  const input = {
    ownerId: "u1",
    projectId: PROJECT,
    originalName: "a.png",
    mimeType: "image/png",
    sizeBytes: 10,
    purpose: "style_reference" as const,
  };

  it("returns the ticket", async () => {
    mocks.createUpload.mockResolvedValue({
      fileId: "f1",
      uploadUrl: "https://s3/x",
      headers: { a: "b" },
      expiresAt: new Date(),
    });
    await expect(issueUploadTicket(input, "bad file")).resolves.toEqual({
      ok: true,
      data: { fileId: "f1", uploadUrl: "https://s3/x", headers: { a: "b" } },
    });
  });

  it("maps a refused file and too many pending uploads, and rethrows the rest", async () => {
    mocks.createUpload.mockRejectedValueOnce(new StorageError("invalid_file", "x"));
    await expect(issueUploadTicket(input, "bad file")).resolves.toEqual({
      ok: false,
      error: "bad file",
    });
    mocks.createUpload.mockRejectedValueOnce(new StorageError("too_many_uploads", "x"));
    await expect(issueUploadTicket(input, "bad file")).resolves.toEqual({
      ok: false,
      error: TOO_MANY_UPLOADS,
    });
    mocks.createUpload.mockRejectedValueOnce(new Error("s3 down"));
    await expect(issueUploadTicket(input, "bad file")).rejects.toThrow("s3 down");
  });
});

describe("converted actions", () => {
  it("finishProductionAction reports a project that could not be finished", async () => {
    const { finishProductionAction } = await import("../projects/[id]/production/clips/actions");
    mocks.completeProduction.mockResolvedValue(false);
    await expect(finishProductionAction(PROJECT)).resolves.toEqual({
      ok: false,
      error: "This project no longer exists. It may have been archived.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();

    mocks.completeProduction.mockResolvedValue(true);
    await expect(finishProductionAction(PROJECT)).resolves.toEqual({ ok: true, data: null });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/projects/${PROJECT}`, "layout");
  });

  it("finishProductionAction never puts a non-UUID into a revalidated path", async () => {
    const { finishProductionAction } = await import("../projects/[id]/production/clips/actions");
    const result = await finishProductionAction("../../dashboard");
    expect(result.ok).toBe(false);
    expect(mocks.completeProduction).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("backgroundStatusAction answers null for a malformed version id and when signed out", async () => {
    const { backgroundStatusAction } = await import("../projects/[id]/script/actions");
    await expect(backgroundStatusAction(PROJECT, "not-a-uuid")).resolves.toBeNull();
    expect(mocks.loadBackgroundStatus).not.toHaveBeenCalled();

    mocks.getSession.mockResolvedValue(null);
    await expect(backgroundStatusAction(PROJECT, null)).resolves.toBeNull();
    expect(mocks.requireUser).not.toHaveBeenCalled();
  });
});

/** Every key of `value`, at any depth. */
function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, inner]) => [key, ...allKeys(inner)]);
}

describe("action payloads stay client-safe", () => {
  it("detectionPanelAction never sends the fix instructions", async () => {
    const { detectionPanelAction } = await import("../projects/[id]/pre-production/[kind]/actions");
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
    const result = await detectionPanelAction(PROJECT);
    expect(result.ok).toBe(true);
    expect(allKeys(result).filter((key) => key.startsWith("instruction"))).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("SECRET");
    if (result.ok) {
      expect(result.data.options[0]).toMatchObject({ code: "D1", takesValue: true });
      expect(result.data.warnings).toEqual([{ tag: "MERGE_CHECK", text: "Ana and Anna" }]);
    }
  });
});

describe("startDraftsAction", () => {
  it("keeps priceChanged on a changed price and the plain failure otherwise", async () => {
    const { startDraftsAction } = await import("../projects/[id]/production/blocks/actions");
    const { PriceChangedError, ProductionInputError } = await import("@/server/production");
    const changed = new PriceChangedError();
    mocks.startDrafts.mockRejectedValueOnce(changed);
    await expect(startDraftsAction(PROJECT, 10)).resolves.toEqual({
      ok: false,
      error: changed.message,
      priceChanged: true,
    });
    mocks.startDrafts.mockRejectedValueOnce(new ProductionInputError("No shots to draw."));
    await expect(startDraftsAction(PROJECT, 10)).resolves.toEqual({
      ok: false,
      error: "No shots to draw.",
    });
  });
});
