/**
 * "Not what you have in mind?" on the Style screen: the user describes a look or genre with any
 * mix of film or show names, reference images and a description. Pure: no server imports, used
 * by the Style screen and by the server that stores the style.
 */

export interface StyleReferenceInput {
  titles: string[];
  description?: string;
  fileIds: string[];
}

export const MAX_REFERENCE_TITLES = 10;
export const MAX_REFERENCE_TITLE_CHARS = 120;
export const MAX_REFERENCE_DESCRIPTION_CHARS = 1000;
export const MAX_REFERENCE_IMAGES = 6;
/** Size limit of one reference image; mirrors the `style_reference` storage purpose. */
export const MAX_REFERENCE_IMAGE_MB = 15;
export const REFERENCE_IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** Trimmed, de-duplicated (ignoring case) titles without empty ones. */
export function cleanTitles(titles: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of titles) {
    const title = raw.trim().replace(/\s+/g, " ");
    const key = title.toLowerCase();
    if (!title || seen.has(key)) continue;
    seen.add(key);
    out.push(title);
  }
  return out;
}

/** The reference with empty parts removed. */
export function normalizeReference(ref: StyleReferenceInput): StyleReferenceInput {
  const description = ref.description?.trim() ?? "";
  return {
    titles: cleanTitles(ref.titles),
    ...(description ? { description } : {}),
    fileIds: [...new Set(ref.fileIds)],
  };
}

/** At least one of names, images or a description. */
export function hasReference(ref: StyleReferenceInput): boolean {
  const r = normalizeReference(ref);
  return r.titles.length > 0 || r.fileIds.length > 0 || Boolean(r.description);
}

/** "A", "A and B", "A, B and C". */
function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The readable style value stored for a reference, e.g. "Like Blade Runner and Arrival. Cold
 * neon at night." Everything that reads only the style string (the writers, the sample mode)
 * gets the user's words this way.
 */
export function describeReference(ref: StyleReferenceInput): string {
  const r = normalizeReference(ref);
  const parts: string[] = [];
  if (r.titles.length > 0) parts.push(`Like ${joinList(r.titles)}`);
  if (r.description) parts.push(r.description.replace(/[.\s]+$/, ""));
  if (parts.length === 0 && r.fileIds.length > 0) {
    parts.push(r.fileIds.length === 1 ? "As in the reference image" : "As in the reference images");
  }
  return parts.length > 0 ? `${parts.join(". ")}.` : "";
}

/**
 * A short summary for the answered row in the questions list: the first name (and how many
 * more), else the start of the description, else the number of images.
 */
export function summarizeReference(ref: StyleReferenceInput, maxChars = 40): string {
  const r = normalizeReference(ref);
  const first = r.titles[0];
  if (first) {
    const more = r.titles.length - 1;
    return more > 0 ? `${first} and ${more} more` : first;
  }
  if (r.description) {
    const text = r.description.replace(/\s+/g, " ");
    return text.length > maxChars ? `${text.slice(0, maxChars - 1).trimEnd()}…` : text;
  }
  if (r.fileIds.length > 0) {
    return r.fileIds.length === 1 ? "1 reference image" : `${r.fileIds.length} reference images`;
  }
  return "";
}
