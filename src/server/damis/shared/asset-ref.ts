/**
 * Asset identity. An asset is identified within its project by its kind and its real name, which
 * is unique per project and kind regardless of case ("Mara", "Mara (2)", "Mara (3)", like Windows
 * file copies). The ref is `kind:Name`; prompts tag assets as `[kind:Name]`.
 *
 * This is the one module that knows the format: every ref, tag and name check goes through it.
 */
import { z } from "zod";
import { ASSET_KINDS, type AssetKind } from "@/server/db/schema";

/** The longest asset name, including a " (n)" duplicate suffix. */
export const MAX_ASSET_NAME = 120;

/** Characters a name may not contain: they would break `[kind:Name]` tags and `<<<image_N>>>` tokens. */
const NAME_CHAR = String.raw`[^\[\]<>:\r\n]`;
const KIND_ALTERNATION = ASSET_KINDS.join("|");

const DUPLICATE_SUFFIX = /^(.*?) \((\d+)\)$/;

/**
 * A name as stored: square brackets become parentheses, `<` and `>` are dropped, a colon becomes
 * " - ", line breaks and runs of whitespace become one space, the ends are trimmed, and the result
 * is cut to `MAX_ASSET_NAME`. May return "" (callers decide the fallback).
 */
export function cleanAssetName(name: string): string {
  const cleaned = name
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .replace(/[<>]/g, "")
    .replace(/\s*:\s*/g, " - ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, MAX_ASSET_NAME).trim();
}

/** The case-insensitive key two names collide on. */
export function nameKey(name: string): string {
  return name.toLocaleLowerCase("en-US");
}

/**
 * `name` if no name in `taken` matches it (ignoring case), else the next free "Name (n)" from 2.
 * A name that already ends in " (n)" counts up from its base: "Mara (2)" taken gives "Mara (3)".
 */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const used = new Set<string>();
  for (const t of taken) used.add(nameKey(t));
  if (!used.has(nameKey(name))) return name;
  const match = DUPLICATE_SUFFIX.exec(name);
  const base = match ? (match[1] ?? name) : name;
  let n = match ? Number(match[2]) + 1 : 2;
  for (; ; n++) {
    const suffix = ` (${n})`;
    const candidate = `${base.slice(0, MAX_ASSET_NAME - suffix.length).trimEnd()}${suffix}`;
    if (!used.has(nameKey(candidate))) return candidate;
  }
}

/** `character`, `Mara` → `character:Mara`. */
export function formatAssetRef(kind: AssetKind, name: string): string {
  return `${kind}:${name}`;
}

export type ParsedAssetRef = { kind: AssetKind; name: string };

function isAssetKind(value: string): value is AssetKind {
  return (ASSET_KINDS as readonly string[]).includes(value);
}

/** True when `name` is a clean, non-empty name (what `cleanAssetName` would keep unchanged). */
export function isCleanAssetName(name: string): boolean {
  return name.length > 0 && cleanAssetName(name) === name;
}

/** `character:Mara (2)` → `{ kind, name }`: split at the first colon; null when malformed. */
export function parseAssetRef(ref: string): ParsedAssetRef | null {
  const colon = ref.indexOf(":");
  if (colon < 0) return null;
  const kind = ref.slice(0, colon);
  const name = ref.slice(colon + 1);
  if (!isAssetKind(kind) || !isCleanAssetName(name)) return null;
  return { kind, name };
}

export function isAssetRef(ref: string): boolean {
  return parseAssetRef(ref) !== null;
}

/** A voice is never an image reference. */
export function isVoiceRef(ref: string): boolean {
  return parseAssetRef(ref)?.kind === "voice";
}

/** A ref in full: `^kind:Name$` (prefer `parseAssetRef`, which also checks the name is clean). */
export const ASSET_REF_PATTERN = new RegExp(`^(?:${KIND_ALTERNATION}):${NAME_CHAR}+$`);

/**
 * An asset tag inside prompt text: `[character:Mara]`, `[prop:Mara's Locket (2)]`. Group 1 is the
 * ref. Global: use with `matchAll` / `replace`, or `assetTagPattern()` for a fresh instance.
 */
export const ASSET_TAG_PATTERN = new RegExp(`\\[((?:${KIND_ALTERNATION}):${NAME_CHAR}+)\\]`, "g");

/** A fresh global tag pattern (no shared `lastIndex` state). */
export function assetTagPattern(): RegExp {
  return new RegExp(ASSET_TAG_PATTERN.source, "g");
}

/** `[kind:Name]` for a ref. */
export function assetTag(ref: string): string {
  return `[${ref}]`;
}

/** The refs tagged in a prompt, in order of appearance (repeats kept). Malformed tags are skipped. */
export function taggedRefs(prompt: string): string[] {
  return [...prompt.matchAll(assetTagPattern())]
    .map((m) => m[1] ?? "")
    .filter((ref) => isAssetRef(ref));
}

/** Replaces every `[from]` tag in `text` with `[to]`. */
export function replaceAssetTag(text: string, from: string, to: string): string {
  return text.split(assetTag(from)).join(assetTag(to));
}

/** A ref, validated (kind from the enum, clean name). */
export const assetRefSchema = z
  .string()
  .refine(isAssetRef, "asset refs are written kind:Name, with the asset's exact name");

/** A name as given by a person or a dami: cleaned, then required to be non-empty. */
export const assetNameSchema = z
  .string()
  .transform(cleanAssetName)
  .pipe(z.string().min(1, "the name is empty"));
