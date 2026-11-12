/**
 * File names of finished clips and the `shots.csv` of an export. Pure.
 *
 * A movie: `<project-slug>_B012_<title-slug>.mp4`; a series:
 * `<project-slug>_E01_B012_<title-slug>.mp4` (episode number and 1-based block order,
 * zero-padded).
 */

/**
 * `The Lighthouse — Night` → `the-lighthouse-night` (ASCII, at most `max` characters). A slug
 * that is too long is cut after its last whole word that fits (a single long word is cut hard).
 */
export function fileSlug(text: string, fallback: string, max = 40): string {
  const full = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (full.length <= max) return full || fallback;
  const cut = full.slice(0, max + 1);
  const boundary = cut.lastIndexOf("-");
  const slug = (boundary > 0 ? cut.slice(0, boundary) : full.slice(0, max)).replace(/-+$/g, "");
  return slug || fallback;
}

/** A block title as written, without the "…" sectioning puts on a title it shortened. */
export function plainTitle(title: string | null): string {
  return (title ?? "").replace(/\s*…\s*$/u, "").trim();
}

export function clipDownloadName(input: {
  projectTitle: string;
  /** Null for a movie: its clips carry no episode part. */
  episodeNumber: number | null;
  orderIndex: number;
  title: string | null;
}): string {
  const project = fileSlug(input.projectTitle, "film");
  const episode =
    input.episodeNumber === null ? "" : `_E${String(input.episodeNumber).padStart(2, "0")}`;
  const block = String(input.orderIndex + 1).padStart(3, "0");
  const title = fileSlug(plainTitle(input.title), "shot");
  return `${project}${episode}_B${block}_${title}.mp4`;
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
  /** Null for a movie (the column is left out). */
  episode: number | null;
  title: string;
  durationSeconds: number | null;
  fileName: string;
  scriptExcerpt: string;
};

/**
 * `shots.csv`: one header line and one line per clip, CRLF line ends. The episode column only for
 * a series (every row has an episode), titles in full (without a shortening "…").
 */
export function shotsCsv(rows: readonly ShotRow[]): string {
  const series = rows.length > 0 && rows.every((r) => r.episode !== null);
  const header = series
    ? ["order", "episode", "title", "duration_seconds", "file_name", "script_excerpt"]
    : ["order", "title", "duration_seconds", "file_name", "script_excerpt"];
  const lines = [
    header.join(","),
    ...rows.map((r) =>
      [
        r.order,
        ...(series ? [r.episode ?? ""] : []),
        plainTitle(r.title),
        r.durationSeconds ?? "",
        r.fileName,
        r.scriptExcerpt,
      ]
        .map(csvField)
        .join(","),
    ),
  ];
  // The byte order mark is needed: without it Excel reads UTF-8 as the system code page and
  // garbles accented names and the "·" of scene titles. Other spreadsheets and parsers accept it.
  return `﻿${lines.join("\r\n")}\r\n`;
}
