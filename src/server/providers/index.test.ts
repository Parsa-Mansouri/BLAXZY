import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/env", () => ({ getEnv: () => ({ GENERATION_PROVIDER: "sample" }) }));

describe("getProvider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("throws on an unknown provider id instead of falling back to the sample provider", async () => {
    const { getProvider } = await import("./index");
    expect(() => getProvider("nonsense")).toThrow(/Unknown generation provider "nonsense"/);
  });

  it("returns the sample provider for its own id", async () => {
    const { getProvider } = await import("./index");
    expect(getProvider("sample").id).toBe("sample");
  });

  it("warns once, structured, when the sample provider is used in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { getProvider } = await import("./index");
    getProvider("sample");
    getProvider("sample");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({
      event: "sample_mode_in_production",
      component: "providers",
    });
  });

  it("stays quiet outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { getProvider } = await import("./index");
    getProvider("sample");
    expect(warn).not.toHaveBeenCalled();
  });
});
