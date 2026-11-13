import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sweepStaleSampleVideoDirs } from "./video";

describe("sweepStaleSampleVideoDirs", () => {
  let root = "";
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "sweep-test-"));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const age = (path: string, ms: number) => {
    const t = new Date(Date.now() - ms);
    return utimes(path, t, t);
  };

  it("removes only stale directories with the exact prefix", async () => {
    const stale = join(root, "blaxzy-video-stale");
    const fresh = join(root, "blaxzy-video-fresh");
    const otherDir = join(root, "other-video-stale");
    const lookalike = join(root, "xblaxzy-video-stale");
    const file = join(root, "blaxzy-video-file");
    for (const dir of [stale, fresh, otherDir, lookalike]) await mkdir(dir);
    await writeFile(join(stale, "clip.mp4"), "x");
    await writeFile(file, "x");
    for (const p of [stale, otherDir, lookalike, file]) await age(p, 10_000);

    const removed = await sweepStaleSampleVideoDirs(5_000, { dir: root });

    expect(removed).toBe(1);
    expect((await readdir(root)).sort()).toEqual(
      [
        "blaxzy-video-file",
        "blaxzy-video-fresh",
        "other-video-stale",
        "xblaxzy-video-stale",
      ].sort(),
    );
  });

  it("returns 0 for a missing directory", async () => {
    expect(await sweepStaleSampleVideoDirs(1, { dir: join(root, "nope") })).toBe(0);
  });
});
