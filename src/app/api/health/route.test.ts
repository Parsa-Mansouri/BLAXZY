import { afterEach, describe, expect, it, vi } from "vitest";

const isDatabaseHealthy = vi.fn();
vi.mock("@/server/health", () => ({ isDatabaseHealthy: () => isDatabaseHealthy() }));

import { GET } from "./route";

afterEach(() => isDatabaseHealthy.mockReset());

describe("GET /api/health", () => {
  it("answers 200 {status:ok} without caching when the database is healthy", async () => {
    isDatabaseHealthy.mockResolvedValue(true);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("answers 503 with no details when it is not", async () => {
    isDatabaseHealthy.mockResolvedValue(false);
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "unavailable" });
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});
