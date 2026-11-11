import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { GenerationRequest } from "@/server/providers";
import { decodeSampleJobId, encodeSampleJobId } from "./job-id";
import { FLAKY_WINDOW_MS, requestDigest, SampleProvider } from "./provider";
import { renderSampleImage, sampleImageSvg, wrapText } from "./render";

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

  it("refuses video and invalid job ids", async () => {
    const provider = new SampleProvider(fakeClock(), () => 0);
    await expect(provider.create(request({ kind: "video" }))).rejects.toThrow(/not available/);
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
