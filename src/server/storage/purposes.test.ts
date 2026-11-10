import { describe, expect, it } from "vitest";
import { StorageError } from "@/server/storage/errors";
import { checkFileAllowed } from "@/server/storage/purposes";

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
