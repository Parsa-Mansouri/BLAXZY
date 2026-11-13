import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawned: FakeChild[] = [];

class FakeChild extends EventEmitter {
  readonly stderr = new PassThrough();
  readonly signals: string[] = [];
  /** Signals that make the fake process exit; SIGTERM is ignored (a hung ffmpeg). */
  constructor(private readonly diesOn: readonly string[]) {
    super();
  }
  kill(signal: string): boolean {
    this.signals.push(signal);
    if (this.diesOn.includes(signal)) queueMicrotask(() => this.emit("close", null));
    return true;
  }
}

let diesOn: readonly string[] = ["SIGKILL"];

vi.mock("node:child_process", () => ({
  spawn: () => {
    const child = new FakeChild(diesOn);
    spawned.push(child);
    return child;
  },
}));

describe("runFfmpeg", () => {
  beforeEach(() => {
    spawned.length = 0;
    diesOn = ["SIGKILL"];
    // Any executable file passes the binary lookup; the spawn itself is mocked.
    vi.stubEnv("FFMPEG_PATH", process.execPath);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("kills a hung ffmpeg with SIGTERM, then SIGKILL, when the timeout passes", async () => {
    const { runFfmpeg, FfmpegTimeoutError } = await import("./ffmpeg");
    const error = await runFfmpeg(["-i", "x"], { timeoutMs: 20, killGraceMs: 20 }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(FfmpegTimeoutError);
    expect(spawned[0]?.signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("escalates to SIGKILL on abort and rejects with the abort reason", async () => {
    const { runFfmpeg } = await import("./ffmpeg");
    const controller = new AbortController();
    const run = runFfmpeg(["-i", "x"], {
      signal: controller.signal,
      timeoutMs: 10_000,
      killGraceMs: 20,
    }).catch((e: unknown) => e);
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    controller.abort(new Error("stop"));
    expect(((await run) as Error).message).toBe("stop");
    expect(spawned[0]?.signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("does not send SIGKILL when SIGTERM is enough", async () => {
    diesOn = ["SIGTERM", "SIGKILL"];
    const { runFfmpeg } = await import("./ffmpeg");
    await runFfmpeg(["-i", "x"], { timeoutMs: 10, killGraceMs: 50 }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 80));
    expect(spawned[0]?.signals).toEqual(["SIGTERM"]);
  });

  it("resolves with stderr when ffmpeg exits 0 in time", async () => {
    const { runFfmpeg } = await import("./ffmpeg");
    const run = runFfmpeg(["-i", "x"]);
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    spawned[0]!.stderr.write("hello");
    spawned[0]!.emit("close", 0);
    await expect(run).resolves.toMatchObject({ code: 0, stderr: "hello" });
  });
});
