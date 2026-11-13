import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSampleModeWarning, warnSampleModeInProduction } from "./mode";

describe("warnSampleModeInProduction", () => {
  beforeEach(() => resetSampleModeWarning());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("logs one structured warning per process in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    warnSampleModeInProduction();
    warnSampleModeInProduction();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({
      level: "warn",
      event: "sample_mode_in_production",
      component: "damis",
    });
  });

  it("stays quiet outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    warnSampleModeInProduction();
    expect(warn).not.toHaveBeenCalled();
  });
});
