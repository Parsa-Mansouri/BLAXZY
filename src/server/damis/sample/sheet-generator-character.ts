/**
 * Sample-mode Character Sheet Generator: a deterministic sheet prompt in the owner's fixed layout
 * (face left, headless front and back figures in the middle, six numbered detail frames right),
 * built from the input alone. Fix mode keeps the previous frames and numbers, replaces only the
 * frames a request names, edits the previous sheet when it is attached, and refuses design
 * changes with a `DESIGN_CHANGE_REQUESTED:` warning (as the owner's rule 5 says).
 */
import { isCharacterSheetFix } from "../sheet-generator-character/dami";
import {
  characterSheetInputSchema,
  DESIGN_CHANGE_PREFIX,
  type CharacterSheetOutput,
  type CharacterSheetParsedInput,
  type DetailCell,
} from "../sheet-generator-character/schema";
import { collapseWhitespace, truncate } from "./util";

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth"];

/** The owner's starting assignment: fabric, footwear, then the most distinctive elements. */
function freshCells(input: CharacterSheetParsedInput): DetailCell[] {
  const d = input.character.details;
  const pick = (value: string | undefined, fallback: string) =>
    value ? truncate(value, 80) : fallback;
  return [
    { slot: 1, subject: "main outfit fabric, weave and stitching", reason: "Frame 1 default." },
    { slot: 2, subject: "footwear, clean side view", reason: "Frame 2 default." },
    {
      slot: 3,
      subject: pick(d.accessories, "the belt and its buckle"),
      reason: "A worn accessory a video model can drop between shots.",
    },
    {
      slot: 4,
      subject: pick(d.marks, "a tight crop of the eyes"),
      reason: "An identity mark that must stay in place.",
    },
    {
      slot: 5,
      subject: pick(d.hair, "hair texture and parting"),
      reason: "Hair detail drifts easily between shots.",
    },
    {
      slot: 6,
      subject: "collar, cuffs and closures",
      reason: "Construction details of the outfit.",
    },
  ];
}

/** A request is about the design (face, hair, body, outfit, colours), not the sheet. */
function isDesignChange(code: string, text: string): boolean {
  if (code === "SX01") return true;
  if (code !== "SP99") return false;
  return /\b(face|hair|body|outfit|colou?r|older|younger|taller|shorter|beard|dress|jacket)\b/i.test(
    text,
  );
}

function frameOf(instruction: string): number | null {
  const match = /\bframe (\d)\b/i.exec(instruction);
  const slot = match ? Number(match[1]) : NaN;
  return slot >= 1 && slot <= 6 ? slot : null;
}

function cellsSentence(cells: readonly DetailCell[]): string {
  return cells.map((c) => `frame ${c.slot} shows ${c.subject}`).join("; ");
}

export function sampleSheetGeneratorCharacter(raw: unknown): CharacterSheetOutput {
  const input = characterSheetInputSchema.parse(raw);
  const name = input.character.name;
  const style =
    input.project.styleDescriptor ?? `${input.project.style} style read from the approved image`;
  const refs = input.referenceImages;
  const reference_order = refs.map((r, i) => ({ index: i + 1, role: r.role }));
  const assumptions = [
    "Style taken from the approved image.",
    "The back of the outfit is inferred from the front of the approved board.",
  ];
  const warnings: string[] = [];
  const applied_fixes: CharacterSheetOutput["applied_fixes"] = [];

  if (isCharacterSheetFix(input) && input.previousPrompt) {
    const cells: DetailCell[] = (input.previousDetailCells ?? freshCells(input)).map((c) => ({
      ...c,
    }));
    const edits: string[] = [];
    for (const request of input.fixRequests) {
      const text = request.customText ?? request.instruction;
      if (isDesignChange(request.code, text)) {
        warnings.push(`${DESIGN_CHANGE_PREFIX} ${truncate(text, 300)}`);
        continue;
      }
      const slot = frameOf(request.instruction);
      if ((request.code === "SP01" || request.code === "SP02") && slot) {
        const cell = cells.find((c) => c.slot === slot);
        if (cell && request.code === "SP01") {
          const named = /\bwith: (.+?)\. It must\b/i.exec(request.instruction)?.[1];
          const subject = named ?? request.customText ?? "the next most distinctive element";
          cell.subject = truncate(subject, 80);
          cell.reason = "Replaced at the user's request.";
        }
        edits.push(`frame ${slot}: ${truncate(request.instruction, 160)}`);
        applied_fixes.push({ code: request.code, change: `Changed only detail frame ${slot}.` });
        continue;
      }
      edits.push(truncate(request.instruction, 200));
      applied_fixes.push({ code: request.code, change: truncate(request.instruction, 160) });
    }
    if (input.userNotes) edits.push(`user note: ${truncate(input.userNotes, 200)}`);
    const previousSheet = refs.findIndex((r) => r.role === "previous_sheet");
    const editMode = previousSheet >= 0 && applied_fixes.length > 0;
    const image_prompt = editMode
      ? `Edit the ${ORDINALS[previousSheet] ?? "second"} reference image, the previous sheet of ${name}: ${edits.join("; ")}. Everything else stays exactly as it is: the face, both full-body figures, the other frames and their digits, the layout and the lighting. The first reference image remains the exact character.`
      : `${collapseWhitespace(input.previousPrompt).replace(/[.\s]+$/, "")}. Corrections: ${edits.join("; ") || "keep the sheet as it is"}. The detail frames now read: ${cellsSentence(cells)}.`;
    return {
      character_name: name,
      asset_type: "character",
      image_prompt,
      aspect_ratio: "16:9",
      style_used: style,
      edit_mode: editMode ? "edit_previous_sheet" : "full",
      reference_order,
      detail_cells: cells,
      applied_fixes,
      assumptions,
      warnings,
    };
  }

  const cells = freshCells(input);
  const originals = refs
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.role !== "approved" && r.role !== "previous_sheet")
    .map(
      ({ r, i }) =>
        `Read fine ${r.role.replace("_", " ")} details from the ${ORDINALS[i] ?? `${i + 1}th`} reference image.`,
    );
  const digits = input.renderCellNumbers
    ? "Above each frame sits a small, plain, upright, legible dark-grey digit: 1 above the top-left frame, 2 top right, 3 middle left, 4 middle right, 5 bottom left, 6 bottom right, in reading order."
    : "The frames carry no digits.";
  const image_prompt = [
    `A 16:9 character sheet of ${name} in three equal columns on one plain, seamless neutral light-grey studio background, rendered in the ${style}.`,
    "Use the first reference image as the exact character: keep the face, hair, body, outfit, colours and accessories identical. Ignore its background and its lighting colour.",
    ...originals,
    "Left third: a close-up of the head and upper shoulders facing the camera at eye level, the entire face fully visible and sharp, neutral expression, the hair fully visible.",
    "Middle third: two full-body figures of the same character on one ground line at the same scale. The front figure, at a slight three-quarter angle, is framed from the neckline down to the feet; its body ends cleanly at the base of the neck with plain grey background above it, collar and neckline details visible. No head, no face, no floating head on the front figure. The back figure, at a slight three-quarter angle, shows the back of the head, the hair and the back of the outfit.",
    `Right third: six equal square frames in two columns and three rows, each with a thin plain dark-grey outline; ${cellsSentence(cells)}. ${digits}`,
    "Soft, even, diffused studio light with neutral white balance and true colours, at most a faint contact shadow under the feet.",
    `Constraints: the face appears only once, in the left third; the front figure has no head; no text other than the digits, no labels, no extra characters; same ${style} throughout.`,
  ].join(" ");
  return {
    character_name: name,
    asset_type: "character",
    image_prompt,
    aspect_ratio: "16:9",
    style_used: style,
    edit_mode: "full",
    reference_order,
    detail_cells: cells,
    applied_fixes,
    assumptions,
    warnings,
  };
}
