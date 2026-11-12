/**
 * The sample provider's placeholder images: an SVG rendered to PNG with sharp. Deterministic: the
 * same spec always gives the same bytes (no clock, no randomness; tints come from the digest).
 */
import type { GenerationPurpose } from "@/server/db/schema";
import type { AspectRatio } from "../policy";

export type SampleImageSpec = {
  purpose: GenerationPurpose;
  /** The large text, usually the asset's name. */
  label: string;
  aspectRatio: AspectRatio;
  /** Hex digest of the request; tints the image so different requests look different. */
  digest: string;
};

export const PURPOSE_TEXT: Record<GenerationPurpose, string> = {
  asset_look: "Look",
  asset_sheet: "Reference sheet",
  block_draft: "Draft shot",
  block_final: "Final shot",
};

export const FONT = "DejaVu Sans, Segoe UI, Helvetica Neue, Arial, sans-serif";
export const MONO = "DejaVu Sans Mono, Consolas, Menlo, monospace";
export const SAMPLE_COLOR = "#f5b83d";
export const LABEL_COLOR = "#f4f4f5";
export const MUTED = "#a1a1aa";

export function isSheet(purpose: GenerationPurpose): boolean {
  return purpose === "asset_sheet";
}

/** Pixel size of the image for a spec. */
export function sampleImageSize(spec: Pick<SampleImageSpec, "purpose" | "aspectRatio">): {
  width: number;
  height: number;
} {
  const sheet = isSheet(spec.purpose);
  switch (spec.aspectRatio) {
    case "16:9":
      return sheet ? { width: 1600, height: 900 } : { width: 1280, height: 720 };
    case "9:16":
      return sheet ? { width: 900, height: 1600 } : { width: 720, height: 1280 };
    case "1:1":
      return sheet ? { width: 1400, height: 1400 } : { width: 1024, height: 1024 };
    case "4:3":
      return sheet ? { width: 1600, height: 1200 } : { width: 1280, height: 960 };
    case "3:4":
      return sheet ? { width: 1200, height: 1600 } : { width: 960, height: 1280 };
  }
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** A byte of the digest as 0..1 (cycles when the digest is short). */
export function digestUnit(digest: string, index: number): number {
  const hex = /^[0-9a-f]+$/i.test(digest) && digest.length >= 2 ? digest : "00";
  const pos = (index * 2) % (hex.length - (hex.length % 2) || 2);
  return parseInt(hex.slice(pos, pos + 2), 16) / 255;
}

/** Greedy word wrap to at most `maxLines` lines of `maxChars`; the last line gets an ellipsis. */
export function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (let word of words) {
    while (word.length > maxChars) {
      if (current) {
        lines.push(current);
        current = "";
      }
      lines.push(word.slice(0, maxChars));
      word = word.slice(maxChars);
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) current = next;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines.length > 0 ? lines : [""];
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1] ?? "";
  kept[maxLines - 1] = `${last.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
  return kept;
}

export type Palette = { accent: string; accentSoft: string; glow: string; swatches: string[] };

export function paletteFor(digest: string): Palette {
  const hue = digestUnit(digest, 0) * 360;
  return {
    accent: hslToHex(hue, 0.32, 0.68),
    accentSoft: hslToHex(hue, 0.18, 0.32),
    glow: hslToHex(hue, 0.12, 0.13),
    swatches: [1, 2, 3, 4, 5].map((i) =>
      hslToHex((hue + digestUnit(digest, i) * 120 - 60 + 360) % 360, 0.28, 0.28 + 0.07 * i),
    ),
  };
}

export function background(width: number, height: number, p: Palette): string {
  const m = Math.min(width, height);
  const step = Math.round(m * 0.035);
  return `
  <defs>
    <radialGradient id="bg" cx="50%" cy="45%" r="75%">
      <stop offset="0" stop-color="${p.glow}"/>
      <stop offset="1" stop-color="#0d0d0f"/>
    </radialGradient>
    <pattern id="hatch" width="${step}" height="${step}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="${step}" stroke="#ffffff" stroke-opacity="0.035" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="${width}" height="${height}" fill="#111113"/>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect width="${width}" height="${height}" fill="url(#hatch)"/>`;
}

export function watermark(width: number, height: number): string {
  const size = Math.round(Math.min(width, height) * 0.2);
  return `<text x="${width / 2}" y="${height / 2}" transform="rotate(-24 ${width / 2} ${height / 2})"
    font-family="${FONT}" font-weight="800" font-size="${size}" letter-spacing="${size * 0.08}"
    fill="#ffffff" fill-opacity="0.045" text-anchor="middle" dominant-baseline="central">SAMPLE</text>`;
}

/** The amber "SAMPLE" badge; `x`, `y` is its top-left (or top-right with `alignRight`). */
export function sampleBadge(x: number, y: number, m: number, alignRight = false): string {
  const size = Math.round(m * 0.032);
  const padX = Math.round(size * 0.7);
  const h = Math.round(size * 1.9);
  const w = Math.round(size * 0.78 * 6 + size * 0.15 * 5 + padX * 2);
  const left = alignRight ? x - w : x;
  return `<g>
    <rect x="${left}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${SAMPLE_COLOR}" fill-opacity="0.14" stroke="${SAMPLE_COLOR}" stroke-width="2"/>
    <text x="${left + w / 2}" y="${y + h / 2}" font-family="${FONT}" font-weight="700" font-size="${size}"
      letter-spacing="${size * 0.15}" fill="${SAMPLE_COLOR}" text-anchor="middle" dominant-baseline="central">SAMPLE</text>
  </g>`;
}

function footer(width: number, height: number, m: number, digest: string): string {
  const size = Math.round(m * 0.022);
  const y = height - Math.round(m * 0.065);
  return `<text x="${width / 2}" y="${y}" font-family="${FONT}" font-size="${size}" fill="${MUTED}" fill-opacity="0.75"
      text-anchor="middle">Placeholder image · not a real generation</text>
    <text x="${width - Math.round(m * 0.075)}" y="${y}" font-family="${MONO}" font-size="${Math.round(size * 0.9)}"
      fill="${MUTED}" fill-opacity="0.45" text-anchor="end">#${escapeXml(digest.slice(0, 8))}</text>`;
}

export function textLines(
  lines: string[],
  x: number,
  firstBaseline: number,
  size: number,
  anchor: "middle" | "start",
): string {
  return lines
    .map(
      (line, i) =>
        `<text x="${x}" y="${Math.round(firstBaseline + i * size * 1.18)}" font-family="${FONT}" font-weight="600"
          font-size="${size}" fill="${LABEL_COLOR}" text-anchor="${anchor}">${escapeXml(line)}</text>`,
    )
    .join("\n");
}

function lookSvg(
  spec: SampleImageSpec,
  width: number,
  height: number,
  caption: string = PURPOSE_TEXT[spec.purpose],
): string {
  const p = paletteFor(spec.digest);
  const m = Math.min(width, height);
  const inset = Math.round(m * 0.04);
  const labelSize = Math.round(m * 0.085);
  const maxChars = Math.max(8, Math.floor((width * 0.8) / (labelSize * 0.6)));
  const lines = wrapText(spec.label || "Untitled", maxChars, 3);
  const blockHeight = labelSize * (1 + (lines.length - 1) * 1.18);
  const purposeSize = Math.round(m * 0.03);
  const top = height / 2 - blockHeight / 2 + labelSize * 0.35;
  const purposeY = Math.round(top - labelSize * 0.95);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${background(width, height, p)}
  <rect x="${inset}" y="${inset}" width="${width - inset * 2}" height="${height - inset * 2}" rx="${Math.round(m * 0.014)}"
    fill="none" stroke="${p.accent}" stroke-opacity="0.35" stroke-width="2"/>
  ${watermark(width, height)}
  ${sampleBadge(inset + Math.round(m * 0.03), inset + Math.round(m * 0.03), m)}
  <text x="${width / 2}" y="${purposeY}" font-family="${FONT}" font-weight="600" font-size="${purposeSize}"
    letter-spacing="${purposeSize * 0.2}" fill="${p.accent}" text-anchor="middle">${escapeXml(caption.toUpperCase())}</text>
  ${textLines(lines, width / 2, top + labelSize * 0.35, labelSize, "middle")}
  ${footer(width, height, m, spec.digest)}
</svg>`;
}

function silhouette(cx: number, cy: number, h: number, widthScale: number, p: Palette): string {
  const head = h * 0.11;
  const bodyW = h * 0.3 * widthScale;
  const bodyH = h * 0.5;
  const top = cy - h / 2;
  return `<g fill="#ffffff" fill-opacity="0.05" stroke="${p.accent}" stroke-opacity="0.55" stroke-width="2">
    <circle cx="${cx}" cy="${top + head}" r="${head}"/>
    <rect x="${cx - bodyW / 2}" y="${top + head * 2 + h * 0.03}" width="${bodyW}" height="${bodyH}" rx="${bodyW * 0.3}"/>
    <rect x="${cx - bodyW * 0.32}" y="${top + head * 2 + h * 0.03 + bodyH * 0.95}" width="${bodyW * 0.22}" height="${h * 0.26}" rx="${bodyW * 0.08}"/>
    <rect x="${cx + bodyW * 0.1}" y="${top + head * 2 + h * 0.03 + bodyH * 0.95}" width="${bodyW * 0.22}" height="${h * 0.26}" rx="${bodyW * 0.08}"/>
  </g>`;
}

type Panel = {
  x: number;
  y: number;
  w: number;
  h: number;
  caption: string;
  content: "figure" | "palette" | "detail";
  scale?: number;
};

function panelSvg(panel: Panel, m: number, p: Palette): string {
  const { x, y, w, h } = panel;
  const captionSize = Math.round(m * 0.022);
  const pad = Math.round(m * 0.018);
  let inner = "";
  const innerTop = y + pad * 2 + captionSize;
  const innerH = y + h - pad - innerTop;
  if (panel.content === "figure") {
    inner = silhouette(x + w / 2, innerTop + innerH / 2, innerH * 0.92, panel.scale ?? 1, p);
  } else if (panel.content === "palette") {
    const n = p.swatches.length;
    const gap = pad * 0.6;
    const sw = (w - pad * 2 - gap * (n - 1)) / n;
    inner = p.swatches
      .map(
        (c, i) =>
          `<rect x="${x + pad + i * (sw + gap)}" y="${innerTop + innerH * 0.2}" width="${sw}" height="${innerH * 0.6}" rx="${Math.round(m * 0.008)}" fill="${c}"/>`,
      )
      .join("");
  } else {
    const r = Math.min(w, innerH) * 0.32;
    inner = `<circle cx="${x + w / 2}" cy="${innerTop + innerH / 2}" r="${r}" fill="#ffffff" fill-opacity="0.04" stroke="${p.accent}" stroke-opacity="0.55" stroke-width="2"/>
      <circle cx="${x + w / 2}" cy="${innerTop + innerH / 2}" r="${r * 0.45}" fill="none" stroke="${p.accent}" stroke-opacity="0.35" stroke-width="2" stroke-dasharray="6 6"/>`;
  }
  return `<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.round(m * 0.012)}" fill="#ffffff" fill-opacity="0.025" stroke="${p.accentSoft}" stroke-width="2"/>
    <text x="${x + pad}" y="${y + pad + captionSize * 0.85}" font-family="${FONT}" font-weight="600" font-size="${captionSize}"
      letter-spacing="${captionSize * 0.15}" fill="${MUTED}">${escapeXml(panel.caption)}</text>
    ${inner}
  </g>`;
}

const GRID_PANELS: Pick<Panel, "caption" | "content" | "scale">[] = [
  { caption: "SIDE", content: "figure", scale: 0.55 },
  { caption: "BACK", content: "figure", scale: 1 },
  { caption: "THREE-QUARTER", content: "figure", scale: 0.8 },
  { caption: "DETAIL", content: "detail" },
  { caption: "EXPRESSION", content: "detail" },
  { caption: "PALETTE", content: "palette" },
];

function sheetSvg(spec: SampleImageSpec, width: number, height: number): string {
  const p = paletteFor(spec.digest);
  const m = Math.min(width, height);
  const inset = Math.round(m * 0.05);
  const gap = Math.round(m * 0.022);
  const landscape = width >= height;
  const labelSize = Math.round(m * 0.06);
  const purposeSize = Math.round(m * 0.026);
  const headerH = Math.round(labelSize * 1.1 + purposeSize * 2.2);
  const maxChars = Math.max(8, Math.floor((width - inset * 2 - m * 0.3) / (labelSize * 0.6)));
  const [line = ""] = wrapText(spec.label || "Untitled", maxChars, 1);

  const areaTop = inset + headerH + gap;
  const areaBottom = height - inset - Math.round(m * 0.05);
  const areaH = areaBottom - areaTop;
  const areaW = width - inset * 2;

  const panels: Panel[] = [];
  let gridX: number, gridY: number, gridW: number, gridH: number;
  if (landscape) {
    const mainW = Math.round(areaW * 0.36);
    panels.push({
      x: inset,
      y: areaTop,
      w: mainW,
      h: areaH,
      caption: "FRONT",
      content: "figure",
      scale: 1,
    });
    gridX = inset + mainW + gap;
    gridY = areaTop;
    gridW = areaW - mainW - gap;
    gridH = areaH;
  } else {
    const mainH = Math.round(areaH * 0.45);
    panels.push({
      x: inset,
      y: areaTop,
      w: areaW,
      h: mainH,
      caption: "FRONT",
      content: "figure",
      scale: 1,
    });
    gridX = inset;
    gridY = areaTop + mainH + gap;
    gridW = areaW;
    gridH = areaH - mainH - gap;
  }
  const cols = 3;
  const rows = 2;
  const cellW = (gridW - gap * (cols - 1)) / cols;
  const cellH = (gridH - gap * (rows - 1)) / rows;
  GRID_PANELS.forEach((panel, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    panels.push({
      ...panel,
      x: Math.round(gridX + col * (cellW + gap)),
      y: Math.round(gridY + row * (cellH + gap)),
      w: Math.round(cellW),
      h: Math.round(cellH),
    });
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${background(width, height, p)}
  <text x="${inset}" y="${inset + purposeSize}" font-family="${FONT}" font-weight="600" font-size="${purposeSize}"
    letter-spacing="${purposeSize * 0.2}" fill="${p.accent}">${escapeXml(PURPOSE_TEXT[spec.purpose].toUpperCase())}</text>
  ${textLines([line], inset, inset + purposeSize * 2 + labelSize * 0.95, labelSize, "start")}
  ${sampleBadge(width - inset, inset, m, true)}
  ${panels.map((panel) => panelSvg(panel, m, p)).join("\n")}
  ${watermark(width, height)}
  ${footer(width, height, m, spec.digest)}
</svg>`;
}

/** The SVG source of a sample image (exported for tests). */
export function sampleImageSvg(spec: SampleImageSpec): string {
  const { width, height } = sampleImageSize(spec);
  if (isPackView(spec)) return lookSvg(spec, width, height, "View");
  return isSheet(spec.purpose) ? sheetSvg(spec, width, height) : lookSvg(spec, width, height);
}

/**
 * One view of a location or prop pack ("Harbour Pier: Reverse"): a single picture, not a
 * character sheet. Asset names never contain ":" (see cleanAssetName), so the colon marks a view.
 */
function isPackView(spec: SampleImageSpec): boolean {
  return isSheet(spec.purpose) && spec.label.includes(": ");
}

/** Renders the sample image as PNG bytes. sharp is loaded on first use (worker only). */
export async function renderSampleImage(spec: SampleImageSpec): Promise<Uint8Array> {
  const { default: sharp } = await import("sharp");
  const buffer = await sharp(Buffer.from(sampleImageSvg(spec)))
    .png({ compressionLevel: 9 })
    .toBuffer();
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}
