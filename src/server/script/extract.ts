import { strFromU8, unzipSync } from "fflate";
import { ScriptInputError } from "./errors";

export const MAX_SCRIPT_CHARS = 400_000;
/** Refuse absurd uploads before decompressing or parsing them. */
const MAX_INPUT_BYTES = 40 * 1024 * 1024;
const MAX_DOCX_XML_BYTES = 30 * 1024 * 1024;
const MAX_PDF_PAGES = 600;

type Kind = "txt" | "docx" | "pdf";

const UNSUPPORTED =
  "This file type is not supported. Upload a .txt, .md, .docx or .pdf file, or paste the text instead.";

function detectKind(mimeType: string, name: string): Kind {
  const ext = /\.([a-z0-9]+)$/i.exec(name.trim())?.[1]?.toLowerCase();
  if (ext === "txt" || ext === "md" || ext === "markdown") return "txt";
  if (ext === "docx") return "docx";
  if (ext === "pdf") return "pdf";
  const mime = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (mime === "text/plain" || mime === "text/markdown") return "txt";
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return "docx";
  }
  if (mime === "application/pdf") return "pdf";
  throw new ScriptInputError(UNSUPPORTED);
}

/** Extracts plain screenplay text from an uploaded .txt, .md, .docx or .pdf file. */
export async function extractScriptText(
  bytes: Uint8Array,
  mimeType: string,
  name: string,
): Promise<string> {
  const kind = detectKind(mimeType, name);
  if (bytes.byteLength === 0) throw new ScriptInputError("This file is empty.");
  if (bytes.byteLength > MAX_INPUT_BYTES) {
    throw new ScriptInputError("This file is too large. Upload a smaller script.");
  }
  const raw =
    kind === "txt"
      ? decodeText(bytes)
      : kind === "docx"
        ? extractDocx(bytes)
        : await extractPdf(bytes);
  const text = tidy(raw);
  if (text.length === 0) {
    throw new ScriptInputError(
      kind === "pdf"
        ? "This PDF has no selectable text. Export it as .docx or paste the text instead."
        : "This file has no text in it.",
    );
  }
  if (text.length > MAX_SCRIPT_CHARS) {
    throw new ScriptInputError(
      `This script is too long (over ${MAX_SCRIPT_CHARS.toLocaleString("en-US")} characters). Split it into parts.`,
    );
  }
  return text;
}

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const LINE_BREAKS = new RegExp("\\r\\n?|" + LS + "|" + PS, "g");

/** Normalise line endings, drop control characters, collapse blank-line runs, trim. */
function tidy(input: string): string {
  return input
    .replace(LINE_BREAKS, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeText(bytes: Uint8Array): string {
  const b0 = bytes[0];
  const b1 = bytes[1];
  if (b0 === 0xff && b1 === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (b0 === 0xfe && b1 === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  const text = new TextDecoder("utf-8").decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/* ------------------------------------ docx ------------------------------------ */

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, ent: string) => {
    if (ent.startsWith("#")) {
      const hex = ent[1]?.toLowerCase() === "x";
      const code = hex ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    }
    return XML_ENTITIES[ent] ?? match;
  });
}

function extractDocx(bytes: Uint8Array): string {
  let xml: string;
  try {
    const files = unzipSync(bytes, {
      filter: (f) => f.name === "word/document.xml" && f.originalSize <= MAX_DOCX_XML_BYTES,
    });
    const doc = files["word/document.xml"];
    if (!doc) throw new Error("missing document.xml");
    xml = strFromU8(doc);
  } catch {
    throw new ScriptInputError(
      "This Word file could not be read. Re-save it as .docx or paste the text instead.",
    );
  }
  const out: string[] = [];
  const paragraphs = xml.match(/<w:p(?:\s[^>]*)?\/>|<w:p[ >][\s\S]*?<\/w:p>/g) ?? [];
  for (const p of paragraphs) {
    let line = "";
    const tokens = p.matchAll(
      /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\b[^>]*\/>|<w:cr\s*\/>/g,
    );
    for (const t of tokens) {
      if (t[1] !== undefined) line += decodeXml(t[1]);
      else if (t[0].startsWith("<w:tab")) line += "\t";
      else line += "\n";
    }
    out.push(line);
  }
  return out.join("\n");
}

/* ------------------------------------- pdf ------------------------------------ */

type PdfTextItem = { str: string; transform: number[]; width: number; hasEOL?: boolean };

type PdfjsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfjsPromise: Promise<PdfjsModule> | null = null;

/**
 * pdfjs-dist is loaded lazily so the web and worker bundles only pay for it when a PDF arrives.
 * The worker module is imported explicitly and handed over through `globalThis.pdfjsWorker`, which
 * makes pdfjs run its "fake worker" in-process without resolving a worker file at runtime (needed
 * for the single-file esbuild worker bundle).
 */
function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= (async () => {
    const g = globalThis as { pdfjsWorker?: unknown };
    if (!g.pdfjsWorker) {
      g.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    }
    return import("pdfjs-dist/legacy/build/pdf.mjs");
  })();
  return pdfjsPromise;
}

async function extractPdf(bytes: Uint8Array): Promise<string> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes), // pdfjs detaches the buffer it is given
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  try {
    const doc = await task.promise;
    if (doc.numPages > MAX_PDF_PAGES) {
      throw new ScriptInputError(
        `This PDF has too many pages (over ${MAX_PDF_PAGES}). Split the script into parts.`,
      );
    }
    const pages: string[] = [];
    let total = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items: PdfTextItem[] = [];
      for (const i of content.items) if ("str" in i) items.push(i);
      const text = linesFromItems(items);
      page.cleanup();
      total += text.length;
      pages.push(text);
      if (total > MAX_SCRIPT_CHARS * 2) break; // far past the limit, stop early
    }
    return pages.join("\n\n");
  } catch (err) {
    if (err instanceof ScriptInputError) throw err;
    if ((err as { name?: string }).name === "PasswordException") {
      throw new ScriptInputError(
        "This PDF is password protected. Remove the password and try again.",
      );
    }
    throw new ScriptInputError(
      "This PDF could not be read. Export it again, or paste the text instead.",
    );
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

/** Rebuilds lines: group items by baseline y, sort each line by x, insert spaces at gaps. */
function linesFromItems(items: PdfTextItem[]): string {
  type Line = { y: number; height: number; items: PdfTextItem[] };
  const lines: Line[] = [];
  for (const item of items) {
    if (item.str.length === 0) continue;
    const y = item.transform[5] ?? 0;
    const height = Math.abs(item.transform[3] ?? 0) || Math.abs(item.transform[0] ?? 0) || 10;
    const line = lines.find(
      (l) => Math.abs(l.y - y) <= Math.max(2, Math.min(l.height, height) * 0.4),
    );
    if (line) line.items.push(item);
    else lines.push({ y, height, items: [item] });
  }
  lines.sort((a, b) => b.y - a.y);
  const out: string[] = [];
  let prevY: number | null = null;
  let prevHeight = 0;
  for (const line of lines) {
    line.items.sort((a, b) => (a.transform[4] ?? 0) - (b.transform[4] ?? 0));
    let text = "";
    let endX: number | null = null;
    for (const item of line.items) {
      const x = item.transform[4] ?? 0;
      if (endX !== null && text.length > 0 && !/\s$/.test(text) && !/^\s/.test(item.str)) {
        if (x - endX > line.height * 0.15) text += " ";
      }
      text += item.str;
      endX = x + item.width;
    }
    text = text.replace(/[ \t]+$/g, "");
    if (text.length === 0) continue;
    // A vertical jump well over one line height is a paragraph (blank line) break.
    if (prevY !== null && prevY - line.y > Math.max(prevHeight, line.height) * 1.9) out.push("");
    out.push(text);
    prevY = line.y;
    prevHeight = line.height;
  }
  return out.join("\n");
}
