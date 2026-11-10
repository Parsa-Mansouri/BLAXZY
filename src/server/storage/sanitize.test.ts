import { describe, expect, it } from "vitest";
import {
  attachmentDisposition,
  cleanDisplayName,
  fileExtension,
  sanitizeFileName,
} from "@/server/storage/sanitize";

describe("sanitizeFileName", () => {
  it.each([
    ["script.pdf", "script.pdf"],
    ["My Script (final).DOCX", "My_Script_final.docx"],
    ["résumé.pdf", "resume.pdf"],
    ["文件.pdf", "file.pdf"],
    ["my.report.v2.md", "my_report_v2.md"],
  ])("keeps a readable name: %s", (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  it.each([
    ["../../etc/passwd", "passwd"],
    ["..\\..\\windows\\system32\\evil.txt", "evil.txt"],
    ["C:\\Users\\me\\Desktop\\notes.txt", "notes.txt"],
    ["..", "file"],
    ["....", "file"],
    ["/", "file"],
    [".env", "env"],
    ["a/..", "file"],
  ])("removes paths and traversal: %s", (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  it("removes control and bidi characters", () => {
    expect(sanitizeFileName("a\u0000b\nc\u007f.txt")).toBe("a_b_c.txt");
    expect(sanitizeFileName("invoice\u202Efdp.exe")).toBe("invoice_fdp.exe");
  });

  it("drops an extension that is not short and alphanumeric", () => {
    expect(sanitizeFileName("archive.tar gz")).toBe("archive_tar_gz");
    expect(sanitizeFileName(`a.${"x".repeat(17)}`)).toBe(`a_${"x".repeat(17)}`);
  });

  it("limits the length and keeps the extension", () => {
    const result = sanitizeFileName(`${"a".repeat(300)}.png`);
    expect(result).toHaveLength(100);
    expect(result.endsWith(".png")).toBe(true);
  });

  it("never returns an empty name", () => {
    expect(sanitizeFileName("")).toBe("file");
    expect(sanitizeFileName("   ")).toBe("file");
    expect(sanitizeFileName(".pdf")).toBe("pdf");
  });
});

describe("fileExtension", () => {
  it("returns the lower-case extension", () => {
    expect(fileExtension("Photo.JPEG")).toBe("jpeg");
    expect(fileExtension("dir.v1/photo")).toBe("");
    expect(fileExtension(".bashrc")).toBe("");
    expect(fileExtension("a.tar.gz")).toBe("gz");
  });
});

describe("cleanDisplayName", () => {
  it("keeps unicode but removes paths, control characters and extra whitespace", () => {
    expect(cleanDisplayName("  文件  名.pdf ")).toBe("文件 名.pdf");
    expect(cleanDisplayName("../secret\u0000\u202E.txt")).toBe("secret.txt");
    expect(cleanDisplayName("")).toBe("file");
  });

  it("limits the length and keeps the extension", () => {
    const result = cleanDisplayName(`${"é".repeat(400)}.pdf`);
    expect([...result]).toHaveLength(255);
    expect(result.endsWith(".pdf")).toBe(true);
  });
});

describe("attachmentDisposition", () => {
  it("sends an ASCII fallback and the encoded UTF-8 name", () => {
    expect(attachmentDisposition("résumé (1).pdf")).toBe(
      "attachment; filename=\"resume_1.pdf\"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%281%29.pdf",
    );
  });

  it("cannot break out of the header value", () => {
    const header = attachmentDisposition('a";\r\nX-Evil: 1.txt');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header.split('"')).toHaveLength(3);
  });
});
