import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/client", () => ({
  getDb: () => {
    throw new Error("connection refused");
  },
}));

const { checkRateLimit } = await import("./limiter");

describe("checkRateLimit when the database fails", () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});

  afterEach(() => logged.mockClear());

  it.each(["poll", "read", "mutate"] as const)("fails open for %s and logs it", async (bucket) => {
    await expect(checkRateLimit({ userId: "u1", bucket })).resolves.toEqual({ ok: true });
    expect(logged).toHaveBeenCalledOnce();
    expect(String(logged.mock.calls[0]?.[0])).toContain("rate limit check failed");
  });

  it.each(["expensive", "upload"] as const)("fails closed for %s and logs it", async (bucket) => {
    await expect(checkRateLimit({ userId: "u1", bucket })).resolves.toEqual({
      ok: false,
      retryAfterSeconds: 5,
      reason: "unavailable",
    });
    expect(logged).toHaveBeenCalledOnce();
  });
});
