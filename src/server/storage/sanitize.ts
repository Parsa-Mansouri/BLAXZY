const MAX_KEY_NAME_LENGTH = 100;
const MAX_EXTENSION_LENGTH = 16;
const MAX_DISPLAY_NAME_LENGTH = 255;

/** C0/C1 control characters and Unicode bidi overrides (used to disguise extensions). */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

/** The part after the last `/` or `\`: a name never carries a path. */
function lastSegment(name: string): string {
  const parts = name.split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

/** The lower-case extension without the dot, or "" (a leading dot does not start one). */
export function fileExtension(name: string): string {
  const base = lastSegment(name).trim();
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function keySafe(value: string): string {
  return value
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "");
}

/**
 * A file name that is safe as the last segment of a storage key: ASCII letters, digits, `_` and
 * `-`, at most one `.` before a short alphanumeric extension, no path, no leading dot, at most
 * 100 characters. Never empty. Accents are folded (`résumé.pdf` → `resume.pdf`).
 */
export function sanitizeFileName(name: string): string {
  const base = lastSegment(name).normalize("NFKD").replace(/\p{M}/gu, "");
  const dot = base.lastIndexOf(".");
  const rawExtension = dot > 0 ? base.slice(dot + 1) : "";
  const extension = /^[A-Za-z0-9]{1,16}$/.test(rawExtension) ? rawExtension.toLowerCase() : "";
  const rawStem = dot > 0 && extension ? base.slice(0, dot) : base;
  const room = MAX_KEY_NAME_LENGTH - (extension ? extension.length + 1 : 0);
  const stem = keySafe(keySafe(rawStem).slice(0, room)) || "file";
  return extension ? `${stem}.${extension}` : stem;
}

/**
 * The name shown to users and offered on download: no path, no control or bidi characters,
 * whitespace collapsed, at most 255 characters. Never empty.
 */
export function cleanDisplayName(name: string): string {
  const cleaned = lastSegment(name.normalize("NFC"))
    .replace(CONTROL_CHARACTERS, "")
    .replace(/\s+/g, " ")
    .trim();
  const characters = [...cleaned];
  if (characters.length <= MAX_DISPLAY_NAME_LENGTH) return cleaned || "file";
  const extension = fileExtension(cleaned);
  const suffix = extension && extension.length <= MAX_EXTENSION_LENGTH ? `.${extension}` : "";
  return (
    characters
      .slice(0, MAX_DISPLAY_NAME_LENGTH - suffix.length)
      .join("")
      .trimEnd() + suffix
  );
}

/** `Content-Disposition: attachment` with an ASCII fallback and the UTF-8 name (RFC 6266). */
export function attachmentDisposition(name: string): string {
  const display = cleanDisplayName(name);
  const encoded = encodeURIComponent(display).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${sanitizeFileName(display)}"; filename*=UTF-8''${encoded}`;
}
