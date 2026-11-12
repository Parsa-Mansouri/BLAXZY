import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import { defineDami } from "./define";
import { DamiInputError, DamiTruncatedError } from "./errors";
import { MAX_IMAGE_EDGE_PX, prepareImageBytes, type ImageResolver } from "./images";
import { buildClaudeRequest, countBreakpoints } from "./request";
import { runDami } from "./runner";

const looker = defineDami({
  key: "test-looker",
  version: "0.0.1",
  description: "Test dami with images",
  input: z.object({ fileIds: z.array(z.string()).min(1) }),
  output: z.object({ seen: z.number().int() }),
  model: "claude-opus-5-5",
  effort: "low",
  maxOutputTokens: 1000,
  build: (input) => ({
    system: [{ text: "Base prompt", cache: true }],
    messages: [
      {
        role: "user",
        content: [
          ...input.fileIds.map((fileId, i) => ({
            image: { fileId },
            cache: i === input.fileIds.length - 1,
          })),
          { text: "Describe these images." },
        ],
      },
    ],
  }),
});

const fakeResolver = (calls: string[]): ImageResolver => {
  return async (fileId) => {
    calls.push(fileId);
    return { mediaType: "image/png", data: `b64-${fileId}` };
  };
};

describe("dami images", () => {
  it("counts image blocks with cache as breakpoints", () => {
    const prompt = looker.build({ fileIds: ["a", "b"] });
    expect(countBreakpoints(prompt)).toBe(2);
  });

  it("resolves images once each and sends base64 image blocks in live mode", async () => {
    const calls: string[] = [];
    const client = new FakeClaudeClient([jsonResponse({ seen: 2 })]);
    const { deps } = testDeps(client, { resolveImage: fakeResolver(calls) });
    const result = await runDami(looker, { fileIds: ["a", "b", "a"] }, {}, deps);

    expect(result.output).toEqual({ seen: 2 });
    expect(calls).toEqual(["a", "b"]);
    const [request] = client.requests;
    const content = request!.messages[0]!.content;
    expect(Array.isArray(content) && content[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "b64-a" },
    });
    expect(Array.isArray(content) && content[2]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "b64-a" },
      cache_control: { type: "ephemeral" },
    });
  });

  it("keeps only file ids in the recorded run input", async () => {
    const client = new FakeClaudeClient([jsonResponse({ seen: 1 })]);
    const { deps, store } = testDeps(client, { resolveImage: fakeResolver([]) });
    await runDami(looker, { fileIds: ["only-id"] }, {}, deps);
    expect(store.runs[0]!.input).toEqual({ fileIds: ["only-id"] });
  });

  it("fails with an input error when an image cannot be loaded", async () => {
    const client = new FakeClaudeClient([jsonResponse({ seen: 1 })]);
    const { deps } = testDeps(client, {
      resolveImage: async () => {
        throw new Error("File not found");
      },
    });
    await expect(runDami(looker, { fileIds: ["x"] }, {}, deps)).rejects.toBeInstanceOf(
      DamiInputError,
    );
    expect(client.requests).toHaveLength(0);
  });

  it("never resolves images in sample mode", async () => {
    const calls: string[] = [];
    const prompt = looker.build({ fileIds: ["a"] });
    const request = buildClaudeRequest(prompt, {
      model: "m",
      maxTokens: 10,
      effort: undefined,
      outputSchema: looker.output,
    });
    expect(calls).toEqual([]);
    const content = request.messages[0]!.content;
    expect(Array.isArray(content) && content[0]).toMatchObject({
      type: "text",
      text: "[image file a]",
    });
  });

  it("downscales large images to the long-edge limit and keeps small ones", async () => {
    const { default: sharp } = await import("sharp");
    const big = await sharp({
      create: { width: 3000, height: 1500, channels: 3, background: "#336699" },
    })
      .jpeg()
      .toBuffer();
    const out = await prepareImageBytes(new Uint8Array(big));
    expect(out.mediaType).toBe("image/jpeg");
    const meta = await sharp(Buffer.from(out.data, "base64")).metadata();
    expect(meta.width).toBe(MAX_IMAGE_EDGE_PX);
    expect(meta.height).toBe(MAX_IMAGE_EDGE_PX / 2);

    const small = await sharp({
      create: { width: 40, height: 20, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0.5 } },
    })
      .png()
      .toBuffer();
    const kept = await prepareImageBytes(new Uint8Array(small));
    expect(kept.mediaType).toBe("image/png");
    const keptMeta = await sharp(Buffer.from(kept.data, "base64")).metadata();
    expect(keptMeta.width).toBe(40);
  });
});

describe("per-call maxOutputTokens", () => {
  const echo = defineDami({
    key: "test-tokens",
    version: "0.0.1",
    description: "Test",
    input: z.object({}),
    output: z.object({ ok: z.boolean() }),
    model: "claude-opus-5-5",
    maxOutputTokens: 1000,
    build: () => ({
      system: [{ text: "s" }],
      messages: [{ role: "user", content: [{ text: "u" }] }],
    }),
  });

  it("overrides the dami default in the request and in the truncation error", async () => {
    const client = new FakeClaudeClient([
      jsonResponse({ ok: true }),
      jsonResponse({ ok: true }, { stopReason: "max_tokens" }),
    ]);
    const { deps } = testDeps(client);
    await runDami(echo, {}, { maxOutputTokens: 4321 }, deps);
    expect(client.requests[0]!.max_tokens).toBe(4321);

    const error = await runDami(echo, {}, { maxOutputTokens: 777 }, deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DamiTruncatedError);
    expect((error as DamiTruncatedError).message).toContain("777");
  });

  it("streams when the per-call limit is large", async () => {
    const client = new FakeClaudeClient([jsonResponse({ ok: true })]);
    const { deps } = testDeps(client);
    await runDami(echo, {}, { maxOutputTokens: 32_000 }, deps);
    expect(client.methods).toEqual(["stream"]);
  });
});
