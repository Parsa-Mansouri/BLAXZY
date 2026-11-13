/** The locked pack's contact sheet, composed with sharp from the stored images. */
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { assetSheet } from "@/server/db/schema";
import { logProjectEvent } from "@/server/projects";
import { putFileBytes, readFileBytes } from "@/server/storage";
import { loadPackJob } from "./queries";
import { type DnaCard, dnaCardOf, packKindOf } from "./rules";

const W = 2400;

const H = 1500;

const PAD = 40;

const GREY = { r: 58, g: 58, b: 60, alpha: 1 };

function xml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function textSvg(
  width: number,
  height: number,
  lines: { text: string; size: number; bold?: boolean }[],
) {
  let y = 0;
  const parts = lines.map((l) => {
    y += l.size * 1.4;
    return `<text x="0" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${l.size}" fill="#e8e6e1"${l.bold ? ' font-weight="700"' : ""}>${xml(l.text)}</text>`;
  });
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join("")}</svg>`,
  );
}

/**
 * The pack's contact sheet (`pack_contact_sheet.png` / `prop_sheet.png`): the Hero large on the
 * left, the approved views in a labelled grid on the right, and the DNA card (plus the prop's
 * scale card) below. Composed with sharp from the stored images; nothing is re-rendered.
 */
async function composeContactSheet(input: {
  heroBytes: Uint8Array;
  heroLabel: string;
  views: { label: string; bytes: Uint8Array }[];
  title: string;
  card: DnaCard | null;
  scaleText: string | null;
}): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  const heroW = 1360;
  const heroH = 900;
  const composites: { input: Buffer; left: number; top: number }[] = [];
  const fit = (bytes: Uint8Array, w: number, h: number) =>
    sharp(bytes).resize(w, h, { fit: "contain", background: GREY }).png().toBuffer();
  composites.push({ input: await fit(input.heroBytes, heroW, heroH), left: PAD, top: PAD + 60 });
  composites.push({
    input: textSvg(heroW, 60, [
      { text: `${input.title} · ${input.heroLabel}`, size: 34, bold: true },
    ]),
    left: PAD,
    top: PAD - 4,
  });
  const gridX = PAD * 2 + heroW;
  const gridW = W - gridX - PAD;
  const cols = 2;
  const cellW = Math.floor((gridW - PAD) / cols);
  const cellH = Math.floor(cellW * 0.5625);
  const shown = input.views.slice(0, 8);
  for (const [i, view] of shown.entries()) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const left = gridX + col * (cellW + PAD);
    const top = PAD + row * (cellH + 54);
    composites.push({ input: await fit(view.bytes, cellW, cellH), left, top });
    composites.push({
      input: textSvg(cellW, 40, [{ text: cut(view.label, 40), size: 24 }]),
      left,
      top: top + cellH + 4,
    });
  }
  const cardTop = PAD + 60 + heroH + PAD;
  const card = input.card;
  const lines: { text: string; size: number; bold?: boolean }[] = [];
  if (card) {
    lines.push({ text: cut(card.summary, 90), size: 26, bold: true });
    for (const a of card.anchors.slice(0, 4)) lines.push({ text: cut(a, 110), size: 22 });
    for (const c of card.constraints.slice(0, 3)) lines.push({ text: cut(c, 110), size: 22 });
  }
  if (input.scaleText)
    lines.push({ text: `Scale: ${cut(input.scaleText, 140)}`, size: 24, bold: true });
  if (lines.length > 0) {
    composites.push({ input: textSvg(heroW, H - cardTop - PAD, lines), left: PAD, top: cardTop });
  }
  return sharp({ create: { width: W, height: H, channels: 4, background: GREY } })
    .composite(composites)
    .png()
    .toBuffer();
}

/** True when there is no contact sheet to store: the sheet has its file, is gone or not accepted. */
async function hasContactSheet(sheetId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ fileId: assetSheet.fileId, status: assetSheet.status })
    .from(assetSheet)
    .where(eq(assetSheet.id, sheetId))
    .limit(1);
  return !row || row.status !== "accepted" || row.fileId !== null;
}

/**
 * Builds and stores a locked pack's contact sheet as the sheet's file (once: only while the
 * accepted sheet has none). Logs `asset.sheet_ready`. False when there is nothing to do. The
 * images are read as the project owner's files. A duplicate run that loses the final
 * compare-and-set leaves its upload unreferenced: it is logged with its file id (the storage
 * module exports no way to mark it abandoned), and the sheet is re-checked right before the upload
 * so this only happens when two runs compose at the same moment.
 */
export async function assemblePackSheet(sheetId: string, signal?: AbortSignal): Promise<boolean> {
  const ctx = await loadPackJob(sheetId);
  if (!ctx || ctx.sheet.status !== "accepted" || ctx.sheet.fileId || !ctx.look.fileId) return false;
  const kind = packKindOf(ctx.asset.kind);
  if (!kind) return false;
  const accepted = ctx.views.filter((v) => v.status === "accepted" && v.fileId);
  const ownerId = ctx.project.ownerId;
  const read = (id: string) => readFileBytes(id, signal ? { signal, ownerId } : { ownerId });
  const png = await composeContactSheet({
    heroBytes: await read(ctx.look.fileId),
    heroLabel: kind === "location" ? "Hero" : "Hero 3/4",
    views: await Promise.all(
      accepted.map(async (v) => ({ label: v.label, bytes: await read(v.fileId ?? "") })),
    ),
    title: ctx.asset.name,
    card: dnaCardOf(kind, ctx.look.spec),
    scaleText: ctx.sheet.spec?.scaleCard?.text ?? null,
  });
  // Another run may have stored it while this one composed: nothing to upload then.
  if (await hasContactSheet(sheetId)) return false;
  const file = await putFileBytes({
    ownerId: ctx.project.ownerId,
    projectId: ctx.project.id,
    name: kind === "location" ? "pack_contact_sheet.png" : "prop_sheet.png",
    mimeType: "image/png",
    purpose: "sheet_image",
    bytes: new Uint8Array(png),
    ...(signal ? { signal } : {}),
  });
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(assetSheet)
      .set({ fileId: file.id })
      .where(
        and(
          eq(assetSheet.id, sheetId),
          eq(assetSheet.status, "accepted"),
          isNull(assetSheet.fileId),
        ),
      )
      .returning();
    if (!row) {
      console.warn(
        `[assets] contact sheet ${file.id} of sheet ${sheetId} lost to another run; the file is unreferenced`,
      );
      return false;
    }
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId: null,
      type: "asset.sheet_ready",
      payload: {
        assetId: row.assetId,
        sheetId: row.id,
        contactSheet: true,
      },
    });
    return true;
  });
}
