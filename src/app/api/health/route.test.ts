import { afterEach, describe, expect, it, vi } from "vitest";
import type { Readiness } from "@/server/health";

const checkReadiness = vi.fn<() => Promise<Readiness>>();
vi.mock("@/server/health", () => ({ checkReadiness: () => checkReadiness() }));

import { GET } from "./route";
import { GET as LIVE } from "./live/route";

afterEach(() => checkReadiness.mockReset());

const all = (state: "ok" | "fail") => ({
  database: state,
  storage: state,
  queue: state,
  worker: state === "ok" ? ("ok" as const) : ("unknown" as const),
});

describe("GET /api/health (readiness)", () => {
  it("answers 200 ok without caching when everything is up", async () => {
    checkReadiness.mockResolvedValue({ status: "ok", checks: all("ok") });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", checks: all("ok") });
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("answers 200 degraded when only the worker is down", async () => {
    const checks = { ...all("ok"), worker: "down" as const };
    checkReadiness.mockResolvedValue({ status: "degraded", checks });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "degraded", checks });
  });

  it("answers 503 when a dependency is unavailable", async () => {
    checkReadiness.mockResolvedValue({ status: "unavailable", checks: all("fail") });
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "unavailable", checks: all("fail") });
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});

describe("GET /api/health/live (liveness)", () => {
  it("answers 200 without checking anything", async () => {
    const res = LIVE();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(checkReadiness).not.toHaveBeenCalled();
  });
});
