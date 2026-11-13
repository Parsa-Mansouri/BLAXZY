import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { promptForChosenAssets, promptTail } from "./jobs";
import { clipDownloadName, csvField, exportDownloadName, fileSlug, shotsCsv } from "./names";
import {
  assertZipFits,
  crc32Of,
  storedZipSize,
  storedZipStream,
  ZipLimitError,
  type StoredEntry,
  type ZipLimits,
} from "./zip";

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

  it("defuses text cells a spreadsheet would run as a formula; numbers stay as they are", () => {
    expect(csvField('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    for (const text of ["+1", "-2", "@SUM(A1)", "\tTab"]) expect(csvField(text)).toBe(`'${text}`);
    expect(csvField("Plain - title")).toBe("Plain - title");
    expect(csvField(-3)).toBe("-3");
    const csv = shotsCsv([
      {
        order: 1,
        episode: null,
        title: "=cmd|' /C calc'!A0",
        durationSeconds: 5,
        fileName: "a.mp4",
        scriptExcerpt: "@risk",
      },
    ]);
    expect(csv).toContain("1,'=cmd|' /C calc'!A0,5,a.mp4,'@risk\r\n");
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

  it("sizes archives past the classic limit (ZIP64) and refuses only what exceeds the cap", () => {
    const big = [{ name: "big.mp4", size: 0xffff_ffff }];
    // Local header + ZIP64 extra (20), central header + ZIP64 sizes (20), ZIP64 end + locator.
    const expected = 30 + 7 + 20 + 0xffff_ffff + 46 + 7 + 20 + 56 + 20 + 22;
    expect(assertZipFits(big)).toBe(expected);
    expect(() => assertZipFits(big, 20 * 1024 ** 3)).not.toThrow();
    expect(() => assertZipFits(big, 0xffff_ffff)).toThrow(ZipLimitError);
  });

  it("keeps the classic layout byte for byte while everything fits", async () => {
    const data = new TextEncoder().encode("abc");
    const entries = [
      { name: "a.txt", size: 3, crc: (await crc32Of(data)).crc, open: async () => data },
    ];
    const bytes = Buffer.from(
      await collect(storedZipStream(entries, new Date(Date.UTC(2026, 0, 2)))),
    );
    expect(bytes.byteLength).toBe(30 + 5 + 3 + 46 + 5 + 22);
    expect(bytes.readUInt16LE(4)).toBe(10); // version needed 1.0, no ZIP64
    expect(bytes.readUInt16LE(28)).toBe(0); // no extra field
    expect(bytes.indexOf(Buffer.from([0x50, 0x4b, 0x06, 0x06]))).toBe(-1); // no ZIP64 end record

    // The same bytes as the classic-only writer produced before ZIP64 (hash of its output).
    const a = new TextEncoder().encode("hello, world");
    const b = new Uint8Array(70_000).map((_, i) => i % 251);
    const pair = [
      { name: "shots.csv", size: a.byteLength, crc: (await crc32Of(a)).crc, open: async () => a },
      {
        name: "clips/ü-b.mp4",
        size: b.byteLength,
        crc: (await crc32Of(b)).crc,
        open: async () => Readable.from([b]),
      },
    ];
    const archive = await collect(storedZipStream(pair, new Date(Date.UTC(2026, 4, 6, 7, 8, 10))));
    expect(createHash("sha256").update(archive).digest("hex")).toBe(
      "7c52b94cdddbdbfc8d3e9d873c73c0fc173f871d444b990bdeb153f4f18844ad",
    );
  });

  it("writes ZIP64 records past the limits, readable and exactly the computed size", async () => {
    // Tiny limits stand in for 4 GiB and 65,535 entries: sizes over 40 bytes, offsets over 40
    // and more than 2 entries need ZIP64.
    const limits: ZipLimits = { max32: 40, max16: 2 };
    const small = new TextEncoder().encode("tiny");
    const large = new Uint8Array(100).map((_, i) => i);
    const entries: StoredEntry[] = [
      {
        name: "a.csv",
        size: small.byteLength,
        crc: (await crc32Of(small)).crc,
        open: async () => small,
      },
      {
        name: "b.mp4",
        size: large.byteLength,
        crc: (await crc32Of(large)).crc,
        open: async () => Readable.from([large.subarray(0, 60), large.subarray(60)]),
      },
      {
        name: "c.csv",
        size: small.byteLength,
        crc: (await crc32Of(small)).crc,
        open: async () => small,
      },
    ];
    const bytes = Buffer.from(await collect(storedZipStream(entries, new Date(), limits)));
    expect(bytes.byteLength).toBe(storedZipSize(entries, limits));

    // Every entry reads back (fflate follows the ZIP64 fields).
    const files = unzipSync(new Uint8Array(bytes));
    expect(Object.keys(files)).toEqual(["a.csv", "b.mp4", "c.csv"]);
    expect(files["b.mp4"]).toEqual(large);
    expect(new TextDecoder().decode(files["c.csv"])).toBe("tiny");

    // b.mp4's local header: sizes are markers, the ZIP64 extra holds them.
    const b = 30 + 5 + small.byteLength;
    expect(bytes.readUInt32LE(b)).toBe(0x04034b50);
    expect(bytes.readUInt16LE(b + 4)).toBe(45);
    expect(bytes.readUInt32LE(b + 18)).toBe(0xffff_ffff);
    expect(bytes.readUInt16LE(b + 28)).toBe(20);
    expect(bytes.readUInt16LE(b + 30 + 5)).toBe(0x0001);
    expect(Number(bytes.readBigUInt64LE(b + 30 + 5 + 4))).toBe(100);

    // The end: ZIP64 end record, its locator, then the classic record with markers.
    const end = bytes.byteLength - 22;
    expect(bytes.readUInt32LE(end)).toBe(0x06054b50);
    expect(bytes.readUInt16LE(end + 10)).toBe(0xffff);
    expect(bytes.readUInt32LE(end + 16)).toBe(0xffff_ffff);
    const locator = end - 20;
    expect(bytes.readUInt32LE(locator)).toBe(0x07064b50);
    const record = Number(bytes.readBigUInt64LE(locator + 8));
    expect(record).toBe(locator - 56);
    expect(bytes.readUInt32LE(record)).toBe(0x06064b50);
    expect(Number(bytes.readBigUInt64LE(record + 32))).toBe(3);
    const directoryOffset = Number(bytes.readBigUInt64LE(record + 48));
    expect(bytes.readUInt32LE(directoryOffset)).toBe(0x02014b50);

    // c.csv's central header: its offset (over 40) is in the ZIP64 extra, its size is not.
    let at = directoryOffset;
    const offsets: number[] = [];
    for (let i = 0; i < 3; i++) {
      const nameLength = bytes.readUInt16LE(at + 28);
      const extraLength = bytes.readUInt16LE(at + 30);
      const classic = bytes.readUInt32LE(at + 42);
      offsets.push(
        classic === 0xffff_ffff
          ? Number(bytes.readBigUInt64LE(at + 46 + nameLength + extraLength - 8))
          : classic,
      );
      if (i === 2) {
        expect(bytes.readUInt32LE(at + 24)).toBe(small.byteLength);
        expect(extraLength).toBe(12);
      }
      at += 46 + nameLength + extraLength;
    }
    expect(offsets).toEqual([0, b, b + 30 + 5 + 20 + 100]);
    for (const offset of offsets) expect(bytes.readUInt32LE(offset)).toBe(0x04034b50);
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
