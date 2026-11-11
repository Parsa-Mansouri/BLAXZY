import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { ScriptInputError } from "./errors";
import { extractScriptText, MAX_SCRIPT_CHARS } from "./extract";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const enc = (s: string) => new TextEncoder().encode(s);

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Builds a minimal .docx; each entry is one paragraph (raw inner XML runs allowed via `{xml}`). */
function docx(paragraphs: (string | { xml: string })[]): Uint8Array {
  const body = paragraphs
    .map((p) =>
      typeof p === "string"
        ? p === ""
          ? "<w:p/>"
          : `<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`
        : `<w:p>${p.xml}</w:p>`,
    )
    .join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  return zipSync({ "word/document.xml": strToU8(xml), "[Content_Types].xml": strToU8("<Types/>") });
}

function emptyPdf(): Uint8Array {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
  ];
  let out = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 4\n0000000000 65535 f \n`;
  for (const o of offs) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return enc(out);
}

const SCREENPLAY = [
  "INT. KITCHEN - NIGHT",
  "MARA stands at the sink.",
  "",
  "MARA",
  "Who is there?",
];

describe("extractScriptText: txt and md", () => {
  it("keeps screenplay lines in order and normalises line endings", async () => {
    const text = await extractScriptText(
      enc("INT. KITCHEN - NIGHT\r\nMARA stands.\r\n\r\n\r\n\r\n\r\nMARA\rWho?\r\n"),
      "text/plain",
      "a.txt",
    );
    expect(text).toBe("INT. KITCHEN - NIGHT\nMARA stands.\n\nMARA\nWho?");
  });

  it("strips a UTF-8 BOM and reads UTF-16 with a BOM", async () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc("Hello")]);
    expect(await extractScriptText(bom, "text/plain", "a.txt")).toBe("Hello");
    const utf16 = new Uint8Array([0xff, 0xfe]);
    const chars = new Uint8Array("Hi\nسلام".length * 2);
    [..."Hi\nسلام"].forEach((c, i) => {
      const code = c.charCodeAt(0);
      chars[i * 2] = code & 0xff;
      chars[i * 2 + 1] = code >> 8;
    });
    const merged = new Uint8Array([...utf16, ...chars]);
    expect(await extractScriptText(merged, "text/plain", "a.txt")).toBe("Hi\nسلام");
  });

  it("round-trips Persian text and treats markdown as text", async () => {
    const fa = "داخلی. آشپزخانه - شب\nمارا کنار سینک ایستاده است.";
    expect(await extractScriptText(enc(fa), "text/markdown", "fa.md")).toBe(fa);
  });

  it("decides by extension first, then mime type", async () => {
    expect(await extractScriptText(enc("x"), "application/octet-stream", "a.txt")).toBe("x");
    expect(await extractScriptText(enc("y"), "text/plain", "noext")).toBe("y");
  });
});

describe("extractScriptText: docx", () => {
  it("keeps paragraphs in order with blank paragraphs as blank lines", async () => {
    const text = await extractScriptText(docx(SCREENPLAY), DOCX_MIME, "s.docx");
    expect(text).toBe(SCREENPLAY.join("\n"));
  });

  it("handles tabs, breaks, split runs and XML entities", async () => {
    const bytes = docx([
      {
        xml: `<w:r><w:t>MARA</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>(quietly)</w:t></w:r>`,
      },
      { xml: `<w:r><w:t>Line one</w:t><w:br/><w:t>Line two</w:t></w:r>` },
      { xml: "<w:r><w:t>Tom &amp; Jerry &lt;3 &#1587; &#x633;</w:t></w:r>" },
    ]);
    const text = await extractScriptText(bytes, "", "s.docx");
    expect(text).toBe("MARA\t(quietly)\nLine one\nLine two\nTom & Jerry <3 س س");
    const raw = await extractScriptText(docx(["Tom & Jerry <3"]), "", "s.docx");
    expect(raw).toBe("Tom & Jerry <3");
  });

  it("round-trips Persian text", async () => {
    const fa = ["داخلی. آشپزخانه - شب", "مارا: کی اونجاست؟"];
    expect(await extractScriptText(docx(fa), DOCX_MIME, "fa.docx")).toBe(fa.join("\n"));
  });

  it("rejects a corrupt docx and an empty one", async () => {
    await expect(extractScriptText(enc("not a zip"), DOCX_MIME, "s.docx")).rejects.toThrow(
      /Word file could not be read/,
    );
    await expect(extractScriptText(docx([""]), DOCX_MIME, "s.docx")).rejects.toThrow(/no text/);
  });
});

// The first pdfjs import is slow on a busy machine; the default 5 s is not enough.
describe("extractScriptText: pdf", { timeout: 30_000 }, () => {
  const fixture = new Uint8Array(readFileSync(join(__dirname, "fixtures", "screenplay.pdf")));

  it("rebuilds lines in order, joins same-line items and separates pages", async () => {
    const text = await extractScriptText(fixture, "application/pdf", "s.pdf");
    expect(text).toBe(
      [
        "INT. KITCHEN - NIGHT",
        "MARA stands at the sink.",
        "",
        "MARA (whispering)",
        "Who is there?",
        "",
        "EXT. STREET - DAY",
        "Rain falls.",
      ].join("\n"),
    );
  });

  it("can be extracted repeatedly", async () => {
    const a = await extractScriptText(fixture, "application/pdf", "s.pdf");
    const b = await extractScriptText(fixture, "", "s.PDF");
    expect(b).toBe(a);
  });

  it("says so when a PDF has no selectable text", async () => {
    await expect(extractScriptText(emptyPdf(), "application/pdf", "scan.pdf")).rejects.toThrow(
      "This PDF has no selectable text. Export it as .docx or paste the text instead.",
    );
  });

  it("rejects a corrupt PDF", async () => {
    await expect(extractScriptText(enc("%PDF-1.4 garbage"), "", "x.pdf")).rejects.toBeInstanceOf(
      ScriptInputError,
    );
  });
});

describe("extractScriptText: errors", () => {
  it("rejects unsupported types, empty files and whitespace-only text", async () => {
    await expect(extractScriptText(enc("x"), "image/png", "a.png")).rejects.toThrow(
      /not supported/,
    );
    await expect(extractScriptText(new Uint8Array(0), "text/plain", "a.txt")).rejects.toThrow(
      /empty/,
    );
    await expect(extractScriptText(enc(" \n\t\n "), "text/plain", "a.txt")).rejects.toThrow(
      /no text/,
    );
  });

  it("rejects over-long text but accepts the limit", async () => {
    const ok = "a".repeat(MAX_SCRIPT_CHARS);
    expect((await extractScriptText(enc(ok), "text/plain", "a.txt")).length).toBe(MAX_SCRIPT_CHARS);
    await expect(extractScriptText(enc(ok + "b"), "text/plain", "a.txt")).rejects.toBeInstanceOf(
      ScriptInputError,
    );
  });
});
