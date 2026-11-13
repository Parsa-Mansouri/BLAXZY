import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock("@/server/auth", () => ({ getSession: () => mocks.getSession() }));
vi.mock("@/server/ratelimit", () => ({
  checkRateLimit: (input: unknown) => mocks.checkRateLimit(input),
}));

const { countParam, optionalUuid, pollRoute, uuidParam } = await import("./poll-route");
const { AssetInputError } = await import("@/server/assets");

const ID = "7f9c2a1e-3b4d-4c5e-8f60-123456789abc";
const user = { id: "u1", emailVerified: true };
const logged = vi.spyOn(console, "error").mockImplementation(() => {});
const logs = vi.spyOn(console, "log").mockImplementation(() => {});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ user });
  mocks.checkRateLimit.mockResolvedValue({ ok: true });
});

const request = (query = "") => new Request(`http://localhost/api/poll/x${query}`);
const context = (params: { id: string }) => ({ params: Promise.resolve(params) });

describe("pollRoute", () => {
  const GET = pollRoute<{ id: string }>("test.poll", async ({ user: who, params, query }) => ({
    id: uuidParam(params.id),
    user: who.id,
    n: countParam(query, "count", 10, 100),
  }));

  it("answers 401 without a session and never runs the handler or the limiter", async () => {
    const handler = vi.fn();
    mocks.getSession.mockResolvedValue(null);
    const res = await pollRoute("test.poll", handler)(request(), context({ id: ID }));
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(handler).not.toHaveBeenCalled();
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
  });

  it("answers 401 for an unverified email", async () => {
    mocks.getSession.mockResolvedValue({ user: { ...user, emailVerified: false } });
    const res = await GET(request(), context({ id: ID }));
    expect(res.status).toBe(401);
  });

  it("answers 429 with Retry-After over the poll limit", async () => {
    mocks.checkRateLimit.mockResolvedValue({ ok: false, reason: "limited", retryAfterSeconds: 7 });
    const res = await GET(request(), context({ id: ID }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("7");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.checkRateLimit).toHaveBeenCalledWith({ userId: "u1", bucket: "poll" });
  });

  it("answers 503 with Retry-After when the limiter is down (fail closed)", async () => {
    mocks.checkRateLimit.mockResolvedValue({
      ok: false,
      reason: "unavailable",
      retryAfterSeconds: 5,
    });
    const res = await GET(request(), context({ id: ID }));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("5");
  });

  it("answers 400 for a path id that is not a UUID", async () => {
    const res = await GET(request(), context({ id: "../../dashboard" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
  });

  it("answers 400 for a count that is not a number, and clamps one out of range", async () => {
    expect((await GET(request("?count=abc"), context({ id: ID }))).status).toBe(400);
    const res = await GET(request("?count=100000"), context({ id: ID }));
    expect((await res.json()).n).toBe(100);
    expect((await (await GET(request(), context({ id: ID }))).json()).n).toBe(10);
  });

  it("answers 200 with the payload, no-store and nosniff", async () => {
    const res = await GET(request("?count=20"), context({ id: ID }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ id: ID, user: "u1", n: 20 });
  });

  it("answers a null payload as JSON null", async () => {
    const res = await pollRoute("test.poll", async () => null)(request(), context({ id: ID }));
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("answers 500 with an empty body for an unexpected error and logs it", async () => {
    const secret = "connection to db.internal:5432 refused";
    const res = await pollRoute("test.poll", async () => {
      throw new Error(secret);
    })(request(), context({ id: ID }));
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({});
    expect(text).not.toContain("db.internal");
    expect(logged.mock.calls.length + logs.mock.calls.length).toBeGreaterThan(0);
  });

  it("answers 500 with an empty body when reading the session fails", async () => {
    mocks.getSession.mockRejectedValue(new Error("secret session failure"));
    const res = await GET(request(), context({ id: ID }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({});
  });

  it("answers a user-facing service error as 400 without its text", async () => {
    const res = await pollRoute("test.poll", async () => {
      throw new AssetInputError("Pick a smaller image, please.");
    })(request(), context({ id: ID }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain("smaller");
  });
});

describe("parameter helpers", () => {
  it("optionalUuid is null when absent or empty and a 400 when malformed", () => {
    expect(optionalUuid(new URLSearchParams(), "accepted")).toBeNull();
    expect(optionalUuid(new URLSearchParams("accepted="), "accepted")).toBeNull();
    expect(optionalUuid(new URLSearchParams(`accepted=${ID}`), "accepted")).toBe(ID);
    expect(() => optionalUuid(new URLSearchParams("accepted=nope"), "accepted")).toThrow();
  });
});
