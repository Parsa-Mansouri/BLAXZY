import { Readable } from "node:stream";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { promptForChosenAssets, promptTail } from "./jobs";
import { clipDownloadName, exportDownloadName, fileSlug, shotsCsv } from "./names";
import { assertZipFits, crc32Of, storedZipSize, storedZipStream, ZipLimitError } from "./zip";

async function collect(stream: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return new Uint8Array(Buffer.concat(chunks));
}

describe("download names", () => {
  it("builds organised clip names: no episode part in a movie, E01 in a series", () => {
    expect(
      clipDownloadName({
        projectTitle: "QA Run 14:03",
        episodeNumber: null,
        orderIndex: 11,
        title: "Sc 1 · Harbour Pier. A single warm lamp…",
      }),
    ).toBe("qa-run-14-03_B012_sc-1-harbour-pier-a-single-warm-lamp.mp4");
    expect(
      clipDownloadName({ projectTitle: "Ünïcode", episodeNumber: 12, orderIndex: 0, title: null }),
    ).toBe("unicode_E12_B001_shot.mp4");
    expect(exportDownloadName("!!!")).toBe("film_clips.zip");
  });

  it("cuts a long slug after its last whole word", () => {
    expect(fileSlug("Sc 1 · Harbour Pier. Rain streaks the air silver under", "x")).toBe(
      "sc-1-harbour-pier-rain-streaks-the-air",
    );
    expect(fileSlug("Sc 2 · TOMAS (50s), silver-rimmed glasses, cardigan", "x")).toBe(
      "sc-2-tomas-50s-silver-rimmed-glasses",
    );
    // One word longer than the limit is cut hard.
    expect(fileSlug("a".repeat(60), "x")).toHaveLength(40);
    expect(fileSlug("short title", "x")).toBe("short-title");
  });

  it("writes shots.csv for a movie without the episode column, titles in full", () => {
    expect(
      shotsCsv([
        {
          order: 2,
          episode: null,
          title: "Sc 1 · Harbour Pier. Rain streaks the air silver under…",
          durationSeconds: 14,
          fileName: "b.mp4",
          scriptExcerpt: "Rain.",
        },
      ]),
    ).toBe(
      "﻿order,title,duration_seconds,file_name,script_excerpt\r\n" +
        "2,Sc 1 · Harbour Pier. Rain streaks the air silver under,14,b.mp4,Rain.\r\n",
    );
  });

  it("writes shots.csv for a series with quoting", () => {
    const csv = shotsCsv([
      {
        order: 1,
        episode: 1,
        title: 'He said "go", then left',
        durationSeconds: 5,
        fileName: "a.mp4",
        scriptExcerpt: "LINE ONE\nLINE, TWO",
      },
    ]);
    expect(
      csv.startsWith("\uFEFForder,episode,title,duration_seconds,file_name,script_excerpt\r\n"),
    ).toBe(true);
    expect(csv).toContain('1,1,"He said ""go"", then left",5,a.mp4,"LINE ONE\nLINE, TWO"\r\n');
  });
});

describe("promptTail", () => {
  it("passes a short prompt whole", () => {
    expect(promptTail("Tomas climbs the stairs.  He stops.")).toBe(
      "Tomas climbs the stairs. He stops.",
    );
  });

  it("caps a long prompt and starts it at a sentence", () => {
    const sentences = Array.from(
      { length: 30 },
      (_, i) => `Sentence number ${i + 1} describes the light on the water.`,
    );
    const tail = promptTail(sentences.join(" "));
    expect(tail.length).toBeLessThanOrEqual(300);
    expect(tail).toMatch(/^Sentence number \d+ describes/);
    expect(tail.endsWith("Sentence number 30 describes the light on the water.")).toBe(true);
  });

  it("starts at a word when there is no sentence end to cut at", () => {
    const tail = promptTail(`${"word ".repeat(100)}end`, 50);
    expect(tail.length).toBeLessThanOrEqual(50);
    expect(tail.startsWith("word")).toBe(true);
    expect(tail.endsWith("end")).toBe(true);
  });
});

describe("stored ZIP stream", () => {
  it("has exactly the computed size and unzips to the entries", async () => {
    const a = new TextEncoder().encode("hello, world");
    const b = new Uint8Array(70_000).map((_, i) => i % 251);
    const entries = [
      { name: "shots.csv", size: a.byteLength, crc: (await crc32Of(a)).crc, open: async () => a },
      {
        name: "clips/ü-b.mp4",
        size: b.byteLength,
        crc: (await crc32Of(Readable.from([b.subarray(0, 1000), b.subarray(1000)]))).crc,
        open: async () => Readable.from([b.subarray(0, 30_000), b.subarray(30_000)]),
      },
    ];
    const bytes = await collect(storedZipStream(entries));
    expect(bytes.byteLength).toBe(storedZipSize(entries));
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toEqual(["shots.csv", "clips/ü-b.mp4"]);
    expect(new TextDecoder().decode(files["shots.csv"])).toBe("hello, world");
    expect(files["clips/ü-b.mp4"]).toEqual(b);
  });

  it("fails when an entry's data has another length", async () => {
    const data = new Uint8Array([1, 2, 3]);
    const stream = storedZipStream([{ name: "x", size: 4, crc: 0, open: async () => data }]);
    await expect(collect(stream)).rejects.toThrow(/expected 4/);
  });

  it("refuses archives over the classic ZIP limit", () => {
    expect(() => assertZipFits([{ name: "big.mp4", size: 0xffff_ffff }])).toThrow(ZipLimitError);
  });
});

describe("promptForChosenAssets", () => {
  it("drops tags left out and adds the chosen assets the prompt does not tag", () => {
    const prompt =
      "SCENE: Pier [location:pier].\nCAST: Elif [character:elif], Teo [character:teo] [voice:teo].";
    const names = new Map([["prop:radio", "Old radio"]]);
    expect(promptForChosenAssets(prompt, ["character:elif", "prop:radio"], names)).toBe(
      "SCENE: Pier.\nCAST: Elif [character:elif], Teo [voice:teo].\nALSO IN THIS SHOT: Old radio [prop:radio].",
    );
  });
});
