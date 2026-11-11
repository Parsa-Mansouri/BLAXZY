/**
 * File names of finished clips and the `shots.csv` of an export. Pure.
 *
 * `<project-slug>_E01_B012_<title-slug>.mp4`: episode number and 1-based block order, zero-padded.
 */

/** `The Lighthouse — Night` → `the-lighthouse-night` (ASCII, at most `max` characters). */
export function fileSlug(text: string, fallback: string, max = 40): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return slug || fallback;
}

export function clipDownloadName(input: {
  projectTitle: string;
  episodeNumber: number;
  orderIndex: number;
  title: string | null;
}): string {
  const project = fileSlug(input.projectTitle, "film");
  const episode = String(input.episodeNumber).padStart(2, "0");
  const block = String(input.orderIndex + 1).padStart(3, "0");
  const title = fileSlug(input.title ?? "", "shot");
  return `${project}_E${episode}_B${block}_${title}.mp4`;
}

export function exportDownloadName(projectTitle: string): string {
  return `${fileSlug(projectTitle, "film")}_clips.zip`;
}

/** One CSV field (RFC 4180): quoted when it holds a comma, a quote or a line break. */
function csvField(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export type ShotRow = {
  order: number;
  episode: number;
  title: string;
  durationSeconds: number | null;
  fileName: string;
  scriptExcerpt: string;
};

/** `shots.csv`: one header line and one line per clip, CRLF line ends, UTF-8 with a BOM (spreadsheets). */
export function shotsCsv(rows: readonly ShotRow[]): string {
  const lines = [
    ["order", "episode", "title", "duration_seconds", "file_name", "script_excerpt"].join(","),
    ...rows.map((r) =>
      [r.order, r.episode, r.title, r.durationSeconds ?? "", r.fileName, r.scriptExcerpt]
        .map(csvField)
        .join(","),
    ),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
