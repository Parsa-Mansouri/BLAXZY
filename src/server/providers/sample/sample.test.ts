import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { GenerationRequest } from "@/server/providers";
import { decodeSampleJobId, encodeSampleJobId } from "./job-id";
import { FLAKY_WINDOW_MS, requestDigest, SampleProvider } from "./provider";
import { parseProbe } from "../ffmpeg";
import { renderSampleImage, sampleImageSvg, wrapText } from "./render";
import { sampleVideoSize, sampleVideoSvg, timecodeText } from "./video";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    kind: "image",
    purpose: "asset_look",
    model: "nano_banana_pro",
    prompt: "An old fisherman with a grey beard",
    params: { aspectRatio: "16:9", resolution: "2k" },
    references: [],
    label: "Tomas",
    ...overrides,
  };
}

function videoRequest(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return request({
    kind: "video",
    purpose: "block_draft",
    model: "seedance_2_5",
    prompt: "Tomas walks to the harbour",
    params: { aspectRatio: "16:9", resolution: "480p", durationSeconds: 3, sound: false },
    label: "Harbour at dawn",
    ...overrides,
  });
}

function fakeClock(start = 1_700_000_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe("sample image", () => {
  const spec = {
    purpose: "asset_look",
    label: "Tomas, the old fisherman",
    aspectRatio: "16:9",
    digest: "a1b2c3d4e5f60718",
  } as const;

  it("is a valid PNG with the request's aspect ratio", async () => {
    const cases = [
      { ...spec, aspectRatio: "16:9", size: [1280, 720] },
      { ...spec, aspectRatio: "9:16", size: [720, 1280] },
      { ...spec, purpose: "asset_sheet", aspectRatio: "16:9", size: [1600, 900] },
      { ...spec, purpose: "asset_sheet", aspectRatio: "9:16", size: [900, 1600] },
      { ...spec, aspectRatio: "1:1", size: [1024, 1024] },
      { ...spec, aspectRatio: "4:3", size: [1280, 960] },
      { ...spec, aspectRatio: "3:4", size: [960, 1280] },
      { ...spec, purpose: "asset_sheet", aspectRatio: "1:1", size: [1400, 1400] },
    ] as const;
    for (const { size, ...s } of cases) {
      const bytes = await renderSampleImage(s);
      expect([...bytes.slice(0, 8)]).toEqual(PNG_SIGNATURE);
      const meta = await sharp(bytes).metadata();
      expect(meta.format).toBe("png");
      expect([meta.width, meta.height]).toEqual(size);
    }
  });

  it("is deterministic for the same spec and differs for another", async () => {
    const a = await renderSampleImage(spec);
    const b = await renderSampleImage({ ...spec });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const c = await renderSampleImage({ ...spec, label: "Someone else" });
    expect(Buffer.from(a).equals(Buffer.from(c))).toBe(false);
  });

  it("shows the label, the purpose and a sample mark; sheets have panels", () => {
    const look = sampleImageSvg(spec);
    expect(look).toContain("Tomas, the old fisherman");
    expect(look).toContain("LOOK");
    expect(look).toContain("SAMPLE");
    const sheet = sampleImageSvg({ ...spec, purpose: "asset_sheet" });
    for (const caption of ["FRONT", "SIDE", "BACK", "PALETTE"]) expect(sheet).toContain(caption);
  });

  it("escapes markup in the label", () => {
    const svg = sampleImageSvg({ ...spec, label: `<script>"a" & 'b'</script>` });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });

  it("wraps long labels to a few lines with an ellipsis", () => {
    expect(wrapText("one two three", 20, 3)).toEqual(["one two three"]);
    const lines = wrapText("word ".repeat(40), 12, 3);
    expect(lines).toHaveLength(3);
    expect(lines[2]?.endsWith("…")).toBe(true);
    expect(wrapText("x".repeat(30), 10, 5)).toEqual([
      "x".repeat(10),
      "x".repeat(10),
      "x".repeat(10),
    ]);
  });
});

describe("SampleProvider", () => {
  it("prices by purpose", async () => {
    const provider = new SampleProvider(fakeClock(), () => 0);
    expect(await provider.price(request())).toBe(4);
    expect(await provider.price(request({ purpose: "asset_sheet" }))).toBe(6);
    expect(await provider.price(request({ purpose: "block_draft", kind: "video" }))).toBe(20);
    expect(await provider.price(request({ purpose: "block_final", kind: "video" }))).toBe(60);
  });

  it("keeps the whole job in its id: running until ready, then a PNG", async () => {
    const clock = fakeClock();
    const provider = new SampleProvider(clock, () => 2_500);
    const { providerJobId } = await provider.create(request());
    // Another instance (another process) answers for the same job.
    const other = new SampleProvider(clock, () => 0);
    expect(await other.getStatus(providerJobId)).toEqual({ state: "running", retryAfterMs: 2_500 });
    clock.advance(2_500);
    expect(await other.getStatus(providerJobId)).toEqual({ state: "succeeded" });
    const result = await other.fetchResult(providerJobId);
    expect(result.mimeType).toBe("image/png");
    if (!("bytes" in result)) throw new Error("expected an image in memory");
    expect((await sharp(result.bytes).metadata()).width).toBe(1280);
    expect(decodeSampleJobId(providerJobId)).toMatchObject({ l: "Tomas", a: "16:9", o: "ok" });
  });

  it("[[fail]] fails for good, [[flaky]] fails once then succeeds", async () => {
    const clock = fakeClock();
    const provider = new SampleProvider(clock, () => 0);
    const failed = await provider.create(request({ prompt: "x [[fail]]" }));
    expect(await provider.getStatus(failed.providerJobId)).toMatchObject({
      state: "failed",
      retryable: false,
    });
    const flaky = await provider.create(request({ prompt: "x [[flaky]]" }));
    expect(await provider.getStatus(flaky.providerJobId)).toMatchObject({
      state: "failed",
      retryable: true,
    });
    clock.advance(FLAKY_WINDOW_MS);
    expect(await provider.getStatus(flaky.providerJobId)).toEqual({ state: "succeeded" });
  });

  it("refuses invalid job ids and a final whose draft is not a sample video", async () => {
    const provider = new SampleProvider(fakeClock(), () => 0);
    await expect(
      provider.create(videoRequest({ purpose: "block_final", draftProviderJobId: "sample_bad" })),
    ).rejects.toThrow(/draft to finish/);
    const image = await provider.create(request());
    await expect(
      provider.create(
        videoRequest({ purpose: "block_final", draftProviderJobId: image.providerJobId }),
      ),
    ).rejects.toThrow(/draft to finish/);
    await expect(provider.getStatus("sample_bad")).rejects.toThrow(/not valid/);
    const forged = encodeSampleJobId({
      v: 1,
      c: 0,
      r: 0,
      o: "ok",
      k: "image",
      p: "asset_look",
      a: "16:9",
      l: "x",
      d: "0000000000000000",
    });
    expect(await provider.getStatus(forged)).toEqual({ state: "succeeded" });
  });

  it("keeps an image's ratio and a video's 16:9 or 9:16 in the job", async () => {
    const provider = new SampleProvider(fakeClock(), () => 0);
    const square = await provider.create(
      request({ params: { aspectRatio: "1:1", resolution: "2k" } }),
    );
    expect(decodeSampleJobId(square.providerJobId)?.a).toBe("1:1");
    const video = await provider.create(
      videoRequest({ params: { aspectRatio: "4:3", resolution: "480p", durationSeconds: 3 } }),
    );
    expect(decodeSampleJobId(video.providerJobId)?.a).toBe("16:9");
  });

  it("gives a re-roll (a new variant) a new digest", () => {
    const base = requestDigest(request());
    const reroll = requestDigest(
      request({ params: { aspectRatio: "16:9", resolution: "2k", variant: "r1" } }),
    );
    const again = requestDigest(
      request({ params: { aspectRatio: "16:9", resolution: "2k", variant: "r2" } }),
    );
    expect(new Set([base, reroll, again]).size).toBe(3);
  });

  it("digests requests by content, ignoring key order", () => {
    const a = requestDigest(request({ params: { aspectRatio: "16:9", resolution: "2k" } }));
    const b = requestDigest(request({ params: { resolution: "2k", aspectRatio: "16:9" } }));
    expect(a).toBe(b);
    const withRef = requestDigest(
      request({
        references: [{ bytes: new Uint8Array([1, 2]), mimeType: "image/png", name: "a.png" }],
      }),
    );
    expect(withRef).not.toBe(a);
  });
});

describe("SampleProvider video jobs", () => {
  it("keeps duration, resolution and sound in the job id (duration clamped)", async () => {
    const provider = new SampleProvider(fakeClock(), () => 0);
    const { providerJobId } = await provider.create(
      videoRequest({ params: { aspectRatio: "9:16", durationSeconds: 99, sound: true } }),
    );
    expect(decodeSampleJobId(providerJobId)).toMatchObject({
      k: "video",
      p: "block_draft",
      a: "9:16",
      s: 15,
      q: "480p",
      n: true,
    });
  });

  it("a final made from a draft reuses the draft's seed", async () => {
    const provider = new SampleProvider(fakeClock(), () => 0);
    const draft = await provider.create(videoRequest());
    const final = await provider.create(
      videoRequest({
        purpose: "block_final",
        params: { aspectRatio: "16:9", resolution: "1080p", durationSeconds: 3, sound: false },
        draftProviderJobId: draft.providerJobId,
      }),
    );
    const d = decodeSampleJobId(draft.providerJobId);
    const f = decodeSampleJobId(final.providerJobId);
    expect(f).toMatchObject({ p: "block_final", q: "1080p", d: d?.d });
    const alone = await provider.create(
      videoRequest({
        purpose: "block_final",
        params: { aspectRatio: "16:9", resolution: "1080p", durationSeconds: 3, sound: false },
      }),
    );
    expect(decodeSampleJobId(alone.providerJobId)?.d).not.toBe(d?.d);
  });

  it("[[fail]] video fails for good", async () => {
    const provider = new SampleProvider(fakeClock(), () => 0);
    const { providerJobId } = await provider.create(videoRequest({ prompt: "x [[fail]]" }));
    expect(await provider.getStatus(providerJobId)).toMatchObject({
      state: "failed",
      retryable: false,
    });
  });
});

describe("sample video frames", () => {
  const spec = {
    purpose: "block_draft",
    label: "Harbour <at> dawn",
    aspectRatio: "16:9",
    resolution: "480p",
    durationSeconds: 3,
    sound: false,
    digest: "a1b2c3d4e5f60718",
  } as const;

  it("sizes drafts and finals per aspect ratio", () => {
    expect(sampleVideoSize({ resolution: "480p", aspectRatio: "16:9" })).toEqual({
      width: 854,
      height: 480,
    });
    expect(sampleVideoSize({ resolution: "480p", aspectRatio: "9:16" })).toEqual({
      width: 480,
      height: 854,
    });
    expect(sampleVideoSize({ resolution: "1080p", aspectRatio: "16:9" })).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(sampleVideoSize({ resolution: "1080p", aspectRatio: "9:16" })).toEqual({
      width: 1080,
      height: 1920,
    });
  });

  it("shows the label (escaped), the purpose and a sample mark", () => {
    const svg = sampleVideoSvg(spec);
    expect(svg).toContain("Harbour &lt;at&gt; dawn");
    expect(svg).toContain("DRAFT SHOT");
    expect(svg).toContain("SAMPLE");
    expect(sampleVideoSvg({ ...spec, purpose: "block_final" })).toContain("FINAL SHOT");
  });

  it("counts frames in the timecode", () => {
    expect(timecodeText(0, 3)).toBe("00:00:00:00  F001/72");
    expect(timecodeText(37, 3)).toBe("00:00:01:13  F038/72");
  });

  it("parses ffmpeg's stream summary", () => {
    const probe = parseProbe(
      [
        "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.mp4':",
        "  Duration: 00:00:10.02, start: 0.000000, bitrate: 85 kb/s",
        "  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 854x480 [SAR 1:1 DAR 427:240], 80 kb/s, 24 fps",
        "  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 2 kb/s",
      ].join("\n"),
    );
    expect(probe).toEqual({
      durationSeconds: 10.02,
      video: { codec: "h264", pixelFormat: "yuv420p", width: 854, height: 480 },
      audio: { codec: "aac" },
    });
  });
});
