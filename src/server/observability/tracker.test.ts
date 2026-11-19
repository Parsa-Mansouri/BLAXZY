import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logLine } from "@/server/log";
import { withJobScope, withRequestScope, setScopeUser } from "./scope";
import {
  flushTracker,
  installTracker,
  isTracking,
  reportError,
  type Tracker,
  type TrackerEvent,
} from "./tracker";

const quiet = [
  vi.spyOn(console, "error").mockImplementation(() => {}),
  vi.spyOn(console, "log").mockImplementation(() => {}),
];

function fakeTracker() {
  const exceptions: { error: unknown; event: TrackerEvent }[] = [];
  const messages: { message: string; level: string; event: TrackerEvent }[] = [];
  const tracker: Tracker = {
    captureException: (error, event) => void exceptions.push({ error, event }),
    captureMessage: (message, level, event) => void messages.push({ message, level, event }),
    flush: vi.fn(async () => true),
  };
  return { tracker, exceptions, messages };
}

let fake: ReturnType<typeof fakeTracker>;

beforeEach(() => {
  fake = fakeTracker();
  installTracker(fake.tracker);
});

afterEach(() => {
  installTracker(null);
  for (const spy of quiet) spy.mockClear();
});

describe("logLine → tracker", () => {
  it("reports an error line as a message, grouped by message and job, with its fields", () => {
    logLine("error", "job", { job: "script.write", outcome: "rejected", error: "bad payload" });
    expect(fake.messages).toHaveLength(1);
    const [sent] = fake.messages;
    expect(sent?.level).toBe("error");
    expect(sent?.message).toBe("job: bad payload");
    expect(sent?.event.tags).toMatchObject({ job: "script.write", outcome: "rejected" });
    expect(sent?.event.extra).toMatchObject({ msg: "job", error: "bad payload" });
    expect(sent?.event.fingerprint).toEqual(["job", "script.write"]);
  });

  it("reports the exception field with its stack, and prints its message", () => {
    const boom = new Error("connection reset");
    logLine("error", "server action failed", { action: "x.y", exception: boom });
    expect(fake.exceptions).toEqual([expect.objectContaining({ error: boom })]);
    expect(fake.exceptions[0]?.event.tags).toMatchObject({ action: "x.y" });
    const printed = JSON.parse(String(quiet[0]?.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(printed).toMatchObject({ msg: "server action failed", error: "connection reset" });
    expect(String(printed.stack)).toContain("connection reset");
    expect(printed).not.toHaveProperty("exception");
  });

  it("raises an alert at warning level for a warn line with alert: true", () => {
    logLine("warn", "stuck generation failed and refunded", { generationId: "g1", alert: true });
    expect(fake.messages).toEqual([
      expect.objectContaining({
        level: "warning",
        message: "stuck generation failed and refunded",
      }),
    ]);
    expect(fake.messages[0]?.event.tags).toMatchObject({ alert: "true" });
    expect(fake.messages[0]?.event.extra).toMatchObject({ generationId: "g1" });
    expect(fake.messages[0]?.event.extra).not.toHaveProperty("alert");
  });

  it("an error line with alert: true is an error", () => {
    logLine("error", "could not record", { alert: true, exception: new Error("db") });
    expect(fake.exceptions).toHaveLength(1);
    expect(fake.exceptions[0]?.event.tags).toMatchObject({ alert: "true" });
  });

  it("does not report info lines or warn lines without alert", () => {
    logLine("info", "job", { outcome: "completed" });
    logLine("warn", "job", { outcome: "interrupted" });
    expect(fake.messages).toHaveLength(0);
    expect(fake.exceptions).toHaveLength(0);
  });

  it("drops fields whose names look sensitive", () => {
    logLine("error", "sign-in failed", { email: "a@b.c", password: "x", token: "t", userId: "u1" });
    const extra = fake.messages[0]?.event.extra ?? {};
    expect(extra).toMatchObject({ userId: "u1" });
    for (const key of ["email", "password", "token"]) expect(extra).not.toHaveProperty(key);
  });

  it("tags events with the request id and user, and adds the request id to the line", () => {
    withRequestScope("req-0123456789", () => {
      setScopeUser("u1");
      logLine("error", "boom");
    });
    expect(fake.messages[0]?.event.tags).toMatchObject({ requestId: "req-0123456789" });
    expect(fake.messages[0]?.event.userId).toBe("u1");
    expect(String(quiet[0]?.mock.calls[0]?.[0])).toContain('"requestId":"req-0123456789"');
  });

  it("tags events with the job name, id and attempt", async () => {
    await withJobScope({ job: "asset.detect", jobId: "j1", attempt: 3 }, async () => {
      await Promise.resolve();
      reportError(new Error("x"));
    });
    expect(fake.exceptions[0]?.event.tags).toEqual({
      job: "asset.detect",
      jobId: "j1",
      attempt: "3",
    });
  });

  it("never throws when the tracker does", () => {
    installTracker({
      captureException: () => {
        throw new Error("sdk broke");
      },
      captureMessage: () => {
        throw new Error("sdk broke");
      },
      flush: async () => {
        throw new Error("sdk broke");
      },
    });
    expect(() => logLine("error", "x", { exception: new Error("y") })).not.toThrow();
    expect(() => logLine("error", "x")).not.toThrow();
    return expect(flushTracker(10)).resolves.toBe(false);
  });
});

describe("tracking off", () => {
  it("does nothing without an installed tracker", async () => {
    installTracker(null);
    expect(isTracking()).toBe(false);
    logLine("error", "x", { alert: true, exception: new Error("y") });
    reportError(new Error("z"));
    await expect(flushTracker(10)).resolves.toBe(true);
    expect(fake.messages).toHaveLength(0);
    expect(fake.exceptions).toHaveLength(0);
  });
});
