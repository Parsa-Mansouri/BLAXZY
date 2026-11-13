import { describe, expect, it } from "vitest";
import { StorageError } from "@/server/storage/errors";
import {
  CONTENT_SIGNATURES,
  FILE_PURPOSES,
  checkFileAllowed,
  matchesContentSignature,
} from "@/server/storage/purposes";

const MB = 1024 * 1024;

function rejection(input: Parameters<typeof checkFileAllowed>[0]): StorageError {
  try {
    checkFileAllowed(input);
  } catch (err) {
    if (err instanceof StorageError) return err;
    throw err;
  }
  throw new Error("expected the file to be refused");
}

describe("checkFileAllowed", () => {
  it("accepts allowed documents and images and normalizes the type", () => {
    expect(
      checkFileAllowed({
        purpose: "script_document",
        name: "Script.PDF",
        mimeType: "application/pdf",
        sizeBytes: 10 * MB,
      }),
    ).toBe("application/pdf");
    expect(
      checkFileAllowed({
        purpose: "script_document",
        name: "notes.txt",
        mimeType: "Text/Plain; charset=utf-8",
        sizeBytes: 1,
      }),
    ).toBe("text/plain");
    expect(
      checkFileAllowed({
        purpose: "asset_image",
        name: "hero.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 25 * MB,
      }),
    ).toBe("image/jpeg");
  });

  it("refuses a type that is not allowed for the purpose", () => {
    const err = rejection({
      purpose: "asset_image",
      name: "a.gif",
      mimeType: "image/gif",
      sizeBytes: 1,
    });
    expect(err.code).toBe("invalid_file");
    expect(
      rejection({
        purpose: "asset_image",
        name: "a.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
      }).code,
    ).toBe("invalid_file");
  });

  it("refuses an extension that does not match the type", () => {
    expect(
      rejection({ purpose: "asset_image", name: "a.exe", mimeType: "image/png", sizeBytes: 1 })
        .message,
    ).toMatch(/\.png/);
    expect(
      rejection({
        purpose: "script_document",
        name: "script",
        mimeType: "text/plain",
        sizeBytes: 1,
      }).code,
    ).toBe("invalid_file");
  });

  it("refuses empty, oversized and non-integer sizes", () => {
    const base = { purpose: "script_document", name: "a.txt", mimeType: "text/plain" } as const;
    expect(rejection({ ...base, sizeBytes: 0 }).code).toBe("invalid_file");
    expect(rejection({ ...base, sizeBytes: 10 * MB + 1 }).message).toMatch(/10 MB/);
    expect(rejection({ ...base, sizeBytes: 1.5 }).code).toBe("invalid_file");
  });
});

describe("matchesContentSignature", () => {
  const bytes = (...values: number[]) => new Uint8Array(values);
  const ascii = (text: string) => new TextEncoder().encode(text);
  const riff = (kind: string) => ascii(`RIFF\0\0\0\0${kind}`);
  const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  it("has a signature rule for every MIME type any purpose allows", () => {
    const allowed = new Set(Object.values(FILE_PURPOSES).flatMap((p) => Object.keys(p.types)));
    expect([...allowed].filter((type) => !(type in CONTENT_SIGNATURES))).toEqual([]);
    expect(Object.keys(CONTENT_SIGNATURES).filter((type) => !allowed.has(type))).toEqual([]);
  });

  it("accepts real signatures", () => {
    const ok: Array<[string, Uint8Array]> = [
      ["image/png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
      ["image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0)],
      ["image/webp", riff("WEBP")],
      ["application/pdf", ascii("%PDF-1.7\n")],
      [DOCX, ascii("PK\x03\x04")],
      ["application/zip", ascii("PK\x03\x04")],
      ["application/zip", ascii("PK\x05\x06")],
      ["video/mp4", ascii("\0\0\0\x18ftypmp42")],
      ["audio/mp4", ascii("\0\0\0\x18ftypM4A ")],
      ["audio/wav", riff("WAVE")],
      ["audio/mpeg", ascii("ID3\x04")],
      ["audio/mpeg", bytes(0xff, 0xfb, 0x90)],
      ["text/plain", ascii("héllo\nwörld")],
      ["text/markdown", ascii("# Title")],
    ];
    for (const [type, sample] of ok) {
      expect(matchesContentSignature(type, sample, true), type).toBe(true);
    }
  });

  it("rejects other content, whatever the declared type", () => {
    const html = ascii("<html><script>alert(1)</script>");
    for (const type of Object.keys(CONTENT_SIGNATURES)) {
      if (type.startsWith("text/")) continue;
      expect(matchesContentSignature(type, html, true), type).toBe(false);
    }
    expect(matchesContentSignature("image/png", bytes(0xff, 0xd8, 0xff), true)).toBe(false);
    expect(matchesContentSignature("image/webp", riff("WAVE"), true)).toBe(false);
    expect(matchesContentSignature("audio/wav", riff("WEBP"), true)).toBe(false);
    expect(matchesContentSignature(DOCX, ascii("PK\x05\x06"), true)).toBe(false);
    expect(matchesContentSignature("image/gif", ascii("GIF89a"), true)).toBe(false);
    expect(matchesContentSignature("image/png", new Uint8Array(), true)).toBe(false);
  });

  it("refuses text with NUL bytes or invalid UTF-8, tolerating a cut final character", () => {
    expect(matchesContentSignature("text/plain", bytes(0x61, 0x00, 0x62), true)).toBe(false);
    expect(matchesContentSignature("text/plain", bytes(0x61, 0xff, 0xfe), true)).toBe(false);
    const cut = bytes(0x61, 0xc3); // "a" plus half of "é"
    expect(matchesContentSignature("text/plain", cut, false)).toBe(true);
    expect(matchesContentSignature("text/plain", cut, true)).toBe(false);
  });
});
