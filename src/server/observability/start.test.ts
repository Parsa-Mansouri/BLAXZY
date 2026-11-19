import { afterEach, describe, expect, it, vi } from "vitest";
import { logLine } from "@/server/log";
import { installTracker, isTracking } from "./tracker";

const sdk = vi.hoisted(() => {
  const scope = {
    setTags: vi.fn(),
    setExtras: vi.fn(),
    setUser: vi.fn(),
    setFingerprint: vi.fn(),
  };
  return {
    scope,
    imported: vi.fn(),
    init: vi.fn(),
    withScope: vi.fn((callback: (s: typeof scope) => unknown) => callback(scope)),
    captureException: vi.fn(() => "id"),
    captureMessage: vi.fn(() => "id"),
    flush: vi.fn(async () => true),
  };
});

function fakeSdk() {
  sdk.imported();
  return {
    init: sdk.init,
    withScope: sdk.withScope,
    captureException: sdk.captureException,
    captureMessage: sdk.captureMessage,
    flush: sdk.flush,
  };
}

vi.mock("@sentry/nextjs", fakeSdk);
vi.mock("@sentry/node", fakeSdk);

const { startWebTracking } = await import("./web");
const { startWorkerTracking } = await import("../../../worker/tracking");

vi.spyOn(console, "error").mockImplementation(() => {});

afterEach(() => {
  installTracker(null);
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe.each([
  ["web", startWebTracking],
  ["worker", startWorkerTracking],
])("%s tracking", (service, start) => {
  it("stays off without SENTRY_DSN: the SDK is never loaded", async () => {
    vi.stubEnv("SENTRY_DSN", "");
    await start();
    expect(isTracking()).toBe(false);
    expect(sdk.imported).not.toHaveBeenCalled();
    logLine("error", "boom", { alert: true });
    expect(sdk.captureMessage).not.toHaveBeenCalled();
  });

  it("initialises the SDK without PII and forwards error lines to it", async () => {
    vi.stubEnv("SENTRY_DSN", "http://key@localhost:8000/1");
    vi.stubEnv("SENTRY_ENVIRONMENT", "staging");
    await start();
    expect(isTracking()).toBe(true);
    const options = sdk.init.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options).toMatchObject({
      dsn: "http://key@localhost:8000/1",
      environment: "staging",
      tracesSampleRate: 0,
      initialScope: { tags: { service } },
      dataCollection: expect.objectContaining({ userInfo: false, cookies: false }),
    });
    expect(options).not.toHaveProperty("sendDefaultPii");

    logLine("error", "could not record", { dami: "k", alert: true });
    expect(sdk.captureMessage).toHaveBeenCalledWith("could not record", "error");
    expect(sdk.scope.setTags).toHaveBeenCalledWith(expect.objectContaining({ dami: "k" }));
  });
});
