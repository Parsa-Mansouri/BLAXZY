import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
const getDownloadUrl = vi.fn();
const checkRateLimit = vi.fn();

vi.mock("@/server/auth", () => ({ getSession: () => getSession() }));
vi.mock("@/server/ratelimit", () => ({
  checkRateLimit: (input: unknown) => checkRateLimit(input),
}));
vi.mock("@/server/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/storage")>()),
  getDownloadUrl: (input: unknown) => getDownloadUrl(input),
}));

const { GET } = await import("./route");
const { StorageError } = await import("@/server/storage");

const call = (id = "f1") =>
  GET(new Request(`http://localhost/api/files/${id}`), { params: Promise.resolve({ id }) });

describe("GET /api/files/[id]", () => {
  beforeEach(() => {
    getSession.mockReset();
    getDownloadUrl.mockReset();
    checkRateLimit.mockReset();
    checkRateLimit.mockResolvedValue({ ok: true });
  });

  it("answers 401 without a session and never looks the file up", async () => {
    getSession.mockResolvedValue(null);
    const response = await call();
    expect(response.status).toBe(401);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(getDownloadUrl).not.toHaveBeenCalled();
  });

  it("answers 404 for a missing, foreign or pending file", async () => {
    getSession.mockResolvedValue({ user: { id: "u1" } });
    getDownloadUrl.mockRejectedValue(new StorageError("not_found", "File not found"));
    const response = await call();
    expect(response.status).toBe(404);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(getDownloadUrl).toHaveBeenCalledWith({ fileId: "f1", userId: "u1" });
  });

  it("redirects to the presigned URL with private caching", async () => {
    getSession.mockResolvedValue({ user: { id: "u1" } });
    getDownloadUrl.mockResolvedValue({ url: "https://store.test/x?sig=1", expiresAt: new Date() });
    const response = await call();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://store.test/x?sig=1");
    expect(response.headers.get("cache-control")).toBe("private, max-age=120");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("answers 429 with Retry-After over the read limit and never looks the file up", async () => {
    getSession.mockResolvedValue({ user: { id: "u1" } });
    checkRateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 17, reason: "limited" });
    const response = await call();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(checkRateLimit).toHaveBeenCalledWith({ userId: "u1", bucket: "file" });
    expect(getDownloadUrl).not.toHaveBeenCalled();
  });

  it("does not swallow unexpected errors", async () => {
    getSession.mockResolvedValue({ user: { id: "u1" } });
    getDownloadUrl.mockRejectedValue(new Error("store down"));
    await expect(call()).rejects.toThrow("store down");
  });
});
