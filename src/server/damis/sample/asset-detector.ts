/**
 * Sample Asset Detector (output_21), deterministic and offline. It reads the script the way the
 * owner's prompt asks (scene by scene, scene index first) with simple rules: locations from scene
 * headings (English or Persian), characters from dialogue cues and ALL-CAPS introductions, props
 * from a small lexicon. Voices are not assets (v2): each scene lists who speaks and who is only
 * heard, and each speaking character carries its language, delivery and voice hints. Every fact,
 * state, fixed element and hint quotes the script exactly (at most 20 words), so the output passes `checkDetection`.
 * Incremental mode reuses known ids; fix mode applies ADT01, ADT02, ADT04, ADT05, ADT06 and ADP02
 * to `previous_output` and records every request in `applied_fixes`.
 */
import { finalizeDetection } from "../asset-detector/dami";
import {
  assetDetectorInputSchema,
  type AssetDetectorOutput,
  type AssetDetectorParsedInput,
  type DetectedCharacter,
  type DetectedLocation,
  type DetectedProp,
  type DetectorFact,
  type DetectorFixRequest,
  type KnownAsset,
  type SceneIndexEntry,
  TIMES_OF_DAY,
  VOICE_DELIVERIES,
} from "../asset-detector/schema";
import { normalizeQuoteText } from "../shared/quotes";
import { isEpisodeHeading, isSceneHeading, splitLines } from "../shared/script-lines";
import {
  collapseWhitespace,
  cueName,
  headingPlace,
  headingTime,
  isTransition,
  titleCase,
} from "./util";

/** Letters of the Arabic script block (U+0600 to U+06FF): Persian dialogue. */
const ARABIC_SCRIPT = new RegExp(`[${String.fromCharCode(0x0600)}-${String.fromCharCode(0x06ff)}]`);

type TimeOfDay = (typeof TIMES_OF_DAY)[number];
type Delivery = (typeof VOICE_DELIVERIES)[number];
type InteriorExterior = DetectedLocation["interior_exterior"];
type AssetType = "char" | "loc" | "prop";

/* ------------------------------------------------------------------------------------------ */
/* Reading the script                                                                          */
/* ------------------------------------------------------------------------------------------ */

type LineKind = "action" | "cue" | "dialogue" | "parenthetical" | "other";

type ScriptLine = {
  text: string;
  kind: LineKind;
  /** Cue lines: the speaker's key; dialogue and parentheticals: the current speaker's key. */
  speaker?: string;
  /** Cue lines: how the voice is heard when the cue has an extension. */
  ext?: "voice_over" | "off_screen" | null;
};

type ParsedHeading = { place: string; ie: InteriorExterior; timeText: string | null };

type Scene = {
  number: string;
  heading: string;
  /** The heading as written in the script, when the script has one (usable as evidence). */
  headingLine: string | null;
  anchor: string | null;
  lines: ScriptLine[];
  parsed: ParsedHeading | null;
  time: TimeOfDay;
};

const PERSIAN_HEADING =
  /^\s*(داخلی|خارجی)(?:\s*[/-]\s*(داخلی|خارجی))?[.\s:]\s*(.+?)\s*(?:[-–—]\s*(.+?))?\s*$/;

/** A scene heading: English (`INT. KITCHEN - NIGHT`) or Persian (`داخلی. آشپزخانه - شب`). */
export function isDetectorHeading(line: string): boolean {
  return isSceneHeading(line) || PERSIAN_HEADING.test(line);
}

function parseHeading(heading: string): ParsedHeading | null {
  const persian = PERSIAN_HEADING.exec(heading);
  if (persian && !isSceneHeading(heading)) {
    const first = persian[1];
    const second = persian[2];
    const ie: InteriorExterior = second ? "int_ext" : first === "داخلی" ? "interior" : "exterior";
    const place = (persian[3] ?? "").trim();
    return place ? { place, ie, timeText: persian[4]?.trim() ?? null } : null;
  }
  if (!isSceneHeading(heading)) return null;
  const place = headingPlace(heading);
  if (!place) return null;
  const ie: InteriorExterior =
    /^\s*(?:\d+[A-Z]?[.)]?\s+)?(INT\.?\s*\/\s*EXT|EXT\.?\s*\/\s*INT|I\/E)/i.test(heading)
      ? "int_ext"
      : /^\s*(?:\d+[A-Z]?[.)]?\s+)?INT/i.test(heading)
        ? "interior"
        : "exterior";
  return { place, ie, timeText: headingTime(heading) };
}

const TIME_WORDS: ReadonlyArray<[string, TimeOfDay]> = [
  ["dawn", "dawn"],
  ["sunrise", "dawn"],
  ["morning", "morning"],
  ["afternoon", "afternoon"],
  ["noon", "day"],
  ["day", "day"],
  ["dusk", "dusk"],
  ["sunset", "dusk"],
  ["twilight", "dusk"],
  ["evening", "evening"],
  ["midnight", "night"],
  ["night", "night"],
  ["سحر", "dawn"],
  ["سپیده", "dawn"],
  ["صبح", "morning"],
  ["بعدازظهر", "afternoon"],
  ["عصر", "afternoon"],
  ["ظهر", "day"],
  ["روز", "day"],
  ["غروب", "dusk"],
  ["شب", "night"],
];
const CONTINUING = /\b(continuous|same|later|moments later|continued|cont'?d)\b/i;

function timeOf(text: string | null): TimeOfDay | "continuing" {
  if (!text) return "unspecified";
  const lower = text.toLowerCase();
  if (CONTINUING.test(lower)) return "continuing";
  for (const [word, time] of TIME_WORDS) if (lower.includes(word)) return time;
  return "unspecified";
}

const EXT_VOICE_OVER = /\((?:V\.?\s?O\.?)\)/i;
const EXT_OFF_SCREEN = /\((?:O\.?\s?S\.?|O\.?\s?C\.?)\)/i;

function hasCase(text: string): boolean {
  return text.toUpperCase() !== text.toLowerCase();
}

/** Classifies a scene's lines: cues, the dialogue under them, parentheticals and action. */
function classify(rawLines: string[]): ScriptLine[] {
  const out: ScriptLine[] = [];
  let speaker: string | null = null;
  rawLines.forEach((raw, i) => {
    const text = raw.trim();
    if (!text) {
      speaker = null;
      return;
    }
    if (speaker !== null) {
      out.push({ text, kind: text.startsWith("(") ? "parenthetical" : "dialogue", speaker });
      return;
    }
    const cue = cueName(rawLines, i);
    if (cue) {
      speaker = hasCase(cue) ? cue.toUpperCase() : cue;
      const ext = EXT_VOICE_OVER.test(text)
        ? "voice_over"
        : EXT_OFF_SCREEN.test(text)
          ? "off_screen"
          : null;
      out.push({ text, kind: "cue", speaker, ext });
      return;
    }
    const other = isTransition(text) || isEpisodeHeading(text) || isDetectorHeading(text);
    out.push({ text, kind: other ? "other" : "action" });
  });
  return out;
}

/** The first `max` words of a text, single-spaced (a quote `containsQuote` finds in the text). */
function firstWords(text: string, max: number): string {
  return collapseWhitespace(text).split(" ").slice(0, max).join(" ");
}

/** At most 20 words of `line` around the character offset `at` (exact, single-spaced). */
function excerptAround(line: string, at: number): string {
  const tokens = [...line.matchAll(/\S+/g)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    text: m[0],
  }));
  if (tokens.length === 0) return "";
  let hit = tokens.findIndex((t) => at >= t.start && at < t.end);
  if (hit < 0) hit = 0;
  const from = Math.max(0, hit - 5);
  return tokens
    .slice(from, from + 20)
    .map((t) => t.text)
    .join(" ");
}

function readScenes(input: AssetDetectorParsedInput): { scenes: Scene[]; assumptions: string[] } {
  const assumptions: string[] = [];
  const drafts: Array<Omit<Scene, "time"> & { timeRaw: TimeOfDay | "continuing" }> = [];
  const given = input.script.scenes ?? [];
  if (given.length > 0) {
    for (const s of given) {
      const parsed = parseHeading(s.heading);
      drafts.push({
        number: s.scene_number,
        heading: s.heading,
        headingLine: s.heading.trim() ? s.heading : null,
        anchor: null,
        lines: classify(splitLines(s.text)),
        parsed,
        timeRaw: timeOf(parsed?.timeText ?? null),
      });
    }
  } else {
    const raw = splitLines(input.script.raw_text ?? "");
    const starts = raw.flatMap((line, i) => (isDetectorHeading(line) ? [i] : []));
    if (starts.length === 0) {
      assumptions.push("The script has no scene headings; it was read as one scene.");
      drafts.push({
        number: "1",
        heading: "INT./EXT. UNKNOWN - UNSPECIFIED",
        headingLine: null,
        anchor: firstWords(raw.join(" "), 8) || null,
        lines: classify(raw),
        parsed: null,
        timeRaw: "unspecified",
      });
    } else {
      starts.forEach((start, k) => {
        const end = starts[k + 1] ?? raw.length;
        const headingLine = (raw[start] ?? "").trim();
        const body = raw.slice(start + 1, end);
        const parsed = parseHeading(headingLine);
        drafts.push({
          number: String(k + 1),
          heading: headingLine,
          headingLine,
          anchor: firstWords([headingLine, ...body].join(" "), 8),
          lines: classify(body),
          parsed,
          timeRaw: timeOf(parsed?.timeText ?? null),
        });
      });
    }
  }
  const scenes: Scene[] = [];
  for (const d of drafts) {
    const previous = scenes.at(-1);
    let time: TimeOfDay = d.timeRaw === "continuing" ? "unspecified" : d.timeRaw;
    if (d.timeRaw === "continuing" && previous) {
      time = previous.time;
      assumptions.push(`Scene ${d.number} continues the time of day of scene ${previous.number}.`);
    }
    scenes.push({
      number: d.number,
      heading: d.heading,
      headingLine: d.headingLine,
      anchor: d.anchor,
      lines: d.lines,
      parsed: d.parsed,
      time,
    });
  }
  return { scenes, assumptions };
}

/* ------------------------------------------------------------------------------------------ */
/* Names                                                                                       */
/* ------------------------------------------------------------------------------------------ */

const PERSIAN_LATIN: Readonly<Record<string, string>> = {
  ا: "a",
  آ: "a",
  أ: "a",
  ب: "b",
  پ: "p",
  ت: "t",
  ث: "s",
  ج: "j",
  چ: "ch",
  ح: "h",
  خ: "kh",
  د: "d",
  ذ: "z",
  ر: "r",
  ز: "z",
  ژ: "zh",
  س: "s",
  ش: "sh",
  ص: "s",
  ض: "z",
  ط: "t",
  ظ: "z",
  ع: "",
  غ: "gh",
  ف: "f",
  ق: "gh",
  ک: "k",
  ك: "k",
  گ: "g",
  ل: "l",
  م: "m",
  ن: "n",
  و: "u",
  ه: "h",
  ی: "i",
  ي: "i",
  ئ: "y",
  ء: "",
};

/** A romanized ASCII form for prompts and file names. */
export function romanize(name: string, fallback: string): string {
  const mapped = [...name.normalize("NFKD")]
    .map((c) => PERSIAN_LATIN[c] ?? c)
    .join("")
    .split("")
    .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (!mapped) return fallback;
  return mapped
    .split(" ")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function keyOf(label: string): string {
  return normalizeQuoteText(label).toLowerCase();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word match, any script (letters on either side break the match). */
function wordPattern(word: string, flags = "iu", suffix = ""): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}${suffix}(?![\\p{L}\\p{N}])`, flags);
}

function displayName(label: string): string {
  return hasCase(label) && label === label.toUpperCase() ? titleCase(label) : label;
}

/* ------------------------------------------------------------------------------------------ */
/* Lexicons                                                                                    */
/* ------------------------------------------------------------------------------------------ */

type PropWord = {
  word: string;
  latin: string;
  category: DetectedProp["category_hint"];
  subtype: string | null;
  /** Food and everyday items: optional when they appear in one scene only. */
  minor?: boolean;
};

/** Longest phrases first, so "brass locket" claims the scenes where "locket" appears. */
const PROP_LEXICON: readonly PropWord[] = [
  { word: "brass locket", latin: "brass locket", category: "hero_prop", subtype: "jewelry" },
  { word: "folded letter", latin: "folded letter", category: "hand_prop", subtype: "document" },
  { word: "old radio", latin: "old radio", category: "functional_prop", subtype: "device" },
  { word: "paper map", latin: "paper map", category: "hand_prop", subtype: "document" },
  { word: "silver key", latin: "silver key", category: "hand_prop", subtype: "tool" },
  { word: "lantern", latin: "lantern", category: "functional_prop", subtype: "light" },
  { word: "letter", latin: "letter", category: "hand_prop", subtype: "document" },
  { word: "map", latin: "map", category: "hand_prop", subtype: "document" },
  { word: "key", latin: "key", category: "hand_prop", subtype: "tool" },
  { word: "locket", latin: "locket", category: "hero_prop", subtype: "jewelry" },
  { word: "photograph", latin: "photograph", category: "hand_prop", subtype: "document" },
  { word: "radio", latin: "radio", category: "functional_prop", subtype: "device" },
  { word: "compass", latin: "compass", category: "hand_prop", subtype: "tool" },
  { word: "notebook", latin: "notebook", category: "hand_prop", subtype: "document" },
  { word: "umbrella", latin: "umbrella", category: "hand_prop", subtype: null },
  { word: "suitcase", latin: "suitcase", category: "hand_prop", subtype: "container" },
  { word: "phone", latin: "phone", category: "functional_prop", subtype: "phone or screen" },
  { word: "bottle", latin: "bottle", category: "hand_prop", subtype: "container" },
  { word: "scarf", latin: "scarf", category: "hand_prop", subtype: null },
  { word: "tray", latin: "tray", category: "hand_prop", subtype: "container", minor: true },
  { word: "cup", latin: "cup", category: "hand_prop", subtype: "container", minor: true },
  { word: "eggs", latin: "eggs", category: "prop_group", subtype: "food", minor: true },
  { word: "candle", latin: "candle", category: "functional_prop", subtype: "light" },
  { word: "چراغ نفتی", latin: "oil lamp", category: "functional_prop", subtype: "light" },
  { word: "نامه", latin: "letter", category: "hand_prop", subtype: "document" },
  { word: "چمدان", latin: "suitcase", category: "hand_prop", subtype: "container" },
  { word: "کلید", latin: "key", category: "hand_prop", subtype: "tool" },
  { word: "نقشه", latin: "map", category: "hand_prop", subtype: "document" },
  { word: "عکس", latin: "photograph", category: "hand_prop", subtype: "document" },
  { word: "رادیو", latin: "radio", category: "functional_prop", subtype: "device" },
  { word: "فانوس", latin: "lantern", category: "functional_prop", subtype: "light" },
  { word: "چتر", latin: "umbrella", category: "hand_prop", subtype: null },
  { word: "فنجان", latin: "cup", category: "hand_prop", subtype: "container", minor: true },
  { word: "تلفن", latin: "phone", category: "functional_prop", subtype: "phone or screen" },
  { word: "بطری", latin: "bottle", category: "hand_prop", subtype: "container" },
];
const MAX_PROPS = 6;

/** Built-in things that belong to the location design, not to props. */
const FIXTURE_LEXICON = [
  "window",
  "fireplace",
  "door",
  "benches",
  "table",
  "shelves",
  "counter",
  "stairs",
];

function propPattern(word: string): RegExp {
  // Persian words take suffixes ("چمدانی", "نامه‌ای"): only the start must be a word start.
  if (!/[A-Za-z]/.test(word)) return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}`, "u");
  return wordPattern(word, "iu", "(?:s|es)?");
}

/* ------------------------------------------------------------------------------------------ */
/* Detection                                                                                   */
/* ------------------------------------------------------------------------------------------ */

type Position = { scene: number; line: number };

function before(a: Position, b: Position): boolean {
  return a.scene < b.scene || (a.scene === b.scene && a.line < b.line);
}

type CharDraft = {
  key: string;
  label: string;
  name: string;
  first: Position;
  present: Set<number>;
  heard: Set<number>;
  cueScenes: Set<number>;
  lines: number;
  deliveries: Set<Delivery>;
  hints: DetectorFact[];
  intro: { line: string; at: number; scene: number } | null;
};

type LocDraft = { key: string; place: string; ie: InteriorExterior; scenes: number[] };

type PropDraft = {
  lex: PropWord;
  aliases: string[];
  first: Position;
  scenes: Set<number>;
  users: Set<string>;
  evidence: { line: string; at: number; scene: number };
};

const INTRO =
  /(?<![\p{L}\p{N}])([A-Z][A-Z'’.-]*[A-Z](?:\s+[A-Z][A-Z'’.-]*[A-Z]){0,2})(?=\s*\(|,)/gu;
const INTRO_STOP = new Set([
  "INT",
  "EXT",
  "OK",
  "TV",
  "CU",
  "POV",
  "SFX",
  "VFX",
  "FX",
  "V.O",
  "O.S",
  "O.C",
]);

function collectCharacters(scenes: Scene[]): CharDraft[] {
  const drafts = new Map<string, CharDraft>();
  const ensure = (label: string, pos: Position): CharDraft => {
    const key = hasCase(label) ? label.toUpperCase() : label;
    let d = drafts.get(key);
    if (!d) {
      d = {
        key,
        label,
        name: displayName(label),
        first: pos,
        present: new Set(),
        heard: new Set(),
        cueScenes: new Set(),
        lines: 0,
        deliveries: new Set(),
        hints: [],
        intro: null,
      };
      drafts.set(key, d);
    } else if (before(pos, d.first)) {
      d.first = pos;
    }
    return d;
  };
  // Candidates: every cue, and ALL-CAPS introductions in action lines.
  scenes.forEach((scene, s) => {
    scene.lines.forEach((line, l) => {
      if (line.kind === "cue" && line.speaker) {
        const label = line.text
          .replace(/\(.*?\)/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        ensure(label || line.speaker, { scene: s, line: l });
      } else if (line.kind === "action" && hasCase(line.text)) {
        for (const m of line.text.matchAll(INTRO)) {
          const label = (m[1] ?? "").trim();
          if (label.replace(/[^A-Z]/g, "").length < 2 || INTRO_STOP.has(label)) continue;
          const d = ensure(label, { scene: s, line: l });
          if (!d.intro) d.intro = { line: line.text, at: m.index, scene: s };
        }
      }
    });
  });
  // Presence, voices and introductions.
  const patterns = new Map([...drafts.values()].map((d) => [d.key, wordPattern(d.label)]));
  scenes.forEach((scene, s) => {
    let speaker: CharDraft | null = null;
    scene.lines.forEach((line, l) => {
      if (line.kind === "cue" && line.speaker) {
        speaker =
          drafts.get(hasCase(line.speaker) ? line.speaker.toUpperCase() : line.speaker) ?? null;
        if (!speaker) return;
        speaker.lines += 1;
        speaker.cueScenes.add(s);
        if (line.ext) {
          speaker.deliveries.add(line.ext);
          speaker.heard.add(s);
        } else {
          speaker.deliveries.add("on_screen");
          speaker.present.add(s);
        }
        return;
      }
      if (line.kind === "parenthetical" && speaker) {
        const inner = line.text.replace(/^\(+|\)+$/g, "").trim();
        if (/phone|radio|speaker|intercom|filtered/i.test(inner))
          speaker.deliveries.add("phone_or_device");
        else if (/whisper/i.test(inner)) speaker.deliveries.add("whisper");
        else if (/sing/i.test(inner)) speaker.deliveries.add("singing");
        else if (
          inner &&
          speaker.hints.length < 2 &&
          !speaker.hints.some((h) => h.value === inner)
        ) {
          speaker.hints.push({
            field: "emotional register",
            value: inner,
            status: "stated",
            scene: scene.number,
            evidence: firstWords(line.text, 20),
          });
        }
        return;
      }
      if (line.kind !== "action") return;
      for (const d of drafts.values()) {
        const m = patterns.get(d.key)?.exec(line.text);
        if (!m) continue;
        d.present.add(s);
        if (before({ scene: s, line: l }, d.first)) d.first = { scene: s, line: l };
        if (!d.intro) d.intro = { line: line.text, at: m.index, scene: s };
      }
    });
  });
  for (const d of drafts.values()) for (const s of d.present) d.heard.delete(s);
  return [...drafts.values()].sort((a, b) =>
    before(a.first, b.first) ? -1 : before(b.first, a.first) ? 1 : 0,
  );
}

function collectLocations(scenes: Scene[]): LocDraft[] {
  const drafts = new Map<string, LocDraft>();
  scenes.forEach((scene, s) => {
    if (!scene.parsed) return;
    const key = `${scene.parsed.ie}|${keyOf(scene.parsed.place)}`;
    const d = drafts.get(key) ?? {
      key,
      place: scene.parsed.place,
      ie: scene.parsed.ie,
      scenes: [],
    };
    d.scenes.push(s);
    drafts.set(key, d);
  });
  return [...drafts.values()];
}

function collectProps(scenes: Scene[], chars: CharDraft[]): PropDraft[] {
  const props: PropDraft[] = [];
  const charPatterns = chars.map((c) => ({ key: c.key, pattern: wordPattern(c.label) }));
  for (const lex of PROP_LEXICON) {
    const pattern = propPattern(lex.word);
    const owner = props.find((p) => keyOf(p.lex.word).includes(keyOf(lex.word)));
    if (!owner && props.length >= MAX_PROPS) continue;
    let draft: PropDraft | null = owner ?? null;
    scenes.forEach((scene, s) => {
      scene.lines.forEach((line, l) => {
        if (line.kind === "cue" || line.kind === "other") return;
        const m = pattern.exec(line.text);
        if (!m) return;
        if (!draft) {
          draft = {
            lex,
            aliases: [],
            first: { scene: s, line: l },
            scenes: new Set(),
            users: new Set(),
            evidence: { line: line.text, at: m.index, scene: s },
          };
          props.push(draft);
        } else if (draft !== owner && before({ scene: s, line: l }, draft.first)) {
          draft.first = { scene: s, line: l };
        }
        draft.scenes.add(s);
        if (line.kind === "action") {
          for (const c of charPatterns) if (c.pattern.test(line.text)) draft.users.add(c.key);
        }
        if (
          draft === owner &&
          !owner.aliases.includes(lex.word) &&
          keyOf(m[0]) !== keyOf(owner.lex.word)
        ) {
          owner.aliases.push(lex.word);
        }
      });
    });
  }
  return props.sort((a, b) => (before(a.first, b.first) ? -1 : before(b.first, a.first) ? 1 : 0));
}

/* ------------------------------------------------------------------------------------------ */
/* Ids and known assets                                                                        */
/* ------------------------------------------------------------------------------------------ */

function idNumber(id: string): number {
  const n = Number(id.slice(id.lastIndexOf("_") + 1));
  return Number.isFinite(n) ? n : 0;
}

function typeOf(id: string): AssetType | null {
  const prefix = id.slice(0, id.lastIndexOf("_"));
  return prefix === "char" || prefix === "loc" || prefix === "prop" ? prefix : null;
}

/** Hands out ids: next after the highest id of each type seen so far (never reused). */
class IdPool {
  private readonly max = new Map<AssetType, number>();

  see(id: string): void {
    const type = typeOf(id);
    if (type) this.max.set(type, Math.max(this.max.get(type) ?? 0, idNumber(id)));
  }

  next(type: AssetType): string {
    const n = (this.max.get(type) ?? 0) + 1;
    this.max.set(type, n);
    return `${type}_${n}`;
  }
}

function stringField(entry: Record<string, unknown>, field: string): string | null {
  const value = entry[field];
  return typeof value === "string" ? value : null;
}

function stringList(entry: Record<string, unknown>, field: string): string[] {
  const value = entry[field];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

class KnownMatcher {
  private readonly used = new Set<string>();

  constructor(private readonly known: readonly KnownAsset[]) {}

  /** The first unused known asset of this type whose name or alias matches one of the labels. */
  match(type: AssetType, labels: readonly string[]): KnownAsset | null {
    const keys = new Set(labels.map(keyOf).filter(Boolean));
    const found = this.known.find((k) => {
      if (this.used.has(k.id) || typeOf(k.id) !== type) return false;
      const names = [stringField(k.entry, "name") ?? "", ...stringList(k.entry, "aliases")];
      return names.some((n) => keys.has(keyOf(n)));
    });
    if (found) this.used.add(found.id);
    return found ?? null;
  }

  unused(): string[] {
    return this.known.filter((k) => !this.used.has(k.id)).map((k) => k.id);
  }
}

/** The known entry's name (kept), with the script's label added as an alias when it differs. */
function knownNaming(
  known: KnownAsset | null,
  name: string,
  aliases: string[],
): { name: string; aliases: string[] } {
  if (!known) return { name, aliases };
  const knownName = stringField(known.entry, "name") ?? name;
  const all = [...stringList(known.entry, "aliases"), ...aliases];
  if (keyOf(name) !== keyOf(knownName)) all.push(name);
  const seen = new Set([keyOf(knownName)]);
  return {
    name: knownName,
    aliases: all.filter((a) => {
      const k = keyOf(a);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    }),
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Assembly                                                                                    */
/* ------------------------------------------------------------------------------------------ */

function sceneList(numbers: readonly string[]): string {
  return numbers.join(", ");
}

function uiSummary(
  lang: string,
  kind: "character" | "location" | "prop",
  name: string,
  refs: readonly string[],
): string {
  if (lang.toLowerCase().startsWith("fa")) {
    const label = { character: "شخصیت", location: "مکان", prop: "وسیله" }[kind];
    return `${name}: ${label}، صحنه‌های ${sceneList(refs)}`;
  }
  return `${name}: ${kind} in scene(s) ${sceneList(refs)}`;
}

function minorFromAge(age: string): "yes" | "no" | "unknown" {
  if (/teen|child|kid|boy|girl|baby|toddler|infant/i.test(age)) return "yes";
  const n = /(\d+)/.exec(age);
  if (!n) return "unknown";
  return Number(n[1]) < 18 && !/\d+s/.test(age) ? "yes" : "no";
}

function emptyOutput(mode: AssetDetectorOutput["mode"]): AssetDetectorOutput {
  return {
    output_version: "output_21",
    mode,
    scene_index: [],
    characters: [],
    locations: [],
    props: [],
    diff: { added: [], updated: [], removed: [] },
    summary: {
      scene_count: 0,
      character_count: 0,
      location_count: 0,
      prop_count: 0,
    },
    applied_fixes: [],
    assumptions: [],
    warnings: [],
  };
}

function withSummary(output: AssetDetectorOutput): AssetDetectorOutput {
  output.summary = {
    scene_count: output.scene_index.length,
    character_count: output.characters.length,
    location_count: output.locations.length,
    prop_count: output.props.length,
  };
  return output;
}

function detect(input: AssetDetectorParsedInput): AssetDetectorOutput {
  const lang = input.project.ui_language;
  const { scenes, assumptions } = readScenes(input);
  const output = emptyOutput(input.mode);
  output.assumptions.push(...assumptions);
  const known = input.known_assets ?? [];
  const pool = new IdPool();
  for (const k of known) pool.see(k.id);
  const matcher = new KnownMatcher(known);
  const added: string[] = [];
  const matched: KnownAsset[] = [];
  const assign = (type: AssetType, k: KnownAsset | null): string => {
    if (k) {
      matched.push(k);
      return k.id;
    }
    const id = pool.next(type);
    added.push(id);
    return id;
  };
  const numberOf = (s: number) => scenes[s]?.number ?? String(s + 1);
  const ordered = (set: Iterable<number>) => [...set].sort((a, b) => a - b);

  // Index rows, filled below.
  const rows: SceneIndexEntry[] = scenes.map((scene) => ({
    scene_number: scene.number,
    heading: scene.heading,
    anchor: scene.anchor,
    location_id: null,
    location_state_id: null,
    time_of_day: scene.time,
    characters_present: [],
    char_looks: [],
    heard_only: [],
    speakers: [],
    props_present: [],
  }));

  // Characters.
  const charDrafts = collectCharacters(scenes);
  const charIdByKey = new Map<string, string>();
  const ranked = [...charDrafts].sort(
    (a, b) => b.present.size + b.heard.size + b.lines - (a.present.size + a.heard.size + a.lines),
  );
  for (const d of charDrafts) {
    const k = matcher.match("char", [d.name, d.label]);
    const id = assign("char", k);
    charIdByKey.set(d.key, id);
    const naming = knownNaming(k, d.name, []);
    const refs = ordered(new Set([...d.present, ...d.heard])).map(numberOf);
    const facts: DetectorFact[] = [];
    let isMinor: DetectedCharacter["is_minor"] = "unknown";
    if (d.intro) {
      const evidence = excerptAround(d.intro.line, d.intro.at);
      const age = new RegExp(`^${escapeRegExp(d.label)}\\s*\\(([^)]{1,20})\\)`, "i").exec(
        d.intro.line.slice(d.intro.at),
      );
      if (age?.[1]) {
        isMinor = minorFromAge(age[1]);
        facts.push({
          field: "age",
          value: age[1],
          status: "stated",
          scene: numberOf(d.intro.scene),
          evidence,
        });
      }
      facts.push({
        field: "presence",
        value: `introduced in scene ${numberOf(d.intro.scene)}`,
        status: "stated",
        scene: numberOf(d.intro.scene),
        evidence,
      });
    }
    const voiceOnly = d.present.size === 0;
    const speaks = d.lines > 0;
    const rank = ranked.indexOf(d);
    const role: DetectedCharacter["role"] =
      rank === 0 ? "lead" : refs.length >= 2 || d.lines >= 2 ? "supporting" : "minor";
    const latin = romanize(d.name, `character ${idNumber(id)}`);
    output.characters.push({
      char_id: id,
      name: naming.name,
      name_latin: latin,
      aliases: naming.aliases,
      kind: voiceOnly ? "voice_only" : "human",
      role,
      asset_priority: speaks || refs.length >= 2 ? "required" : "optional",
      needs_visual: !voiceOnly,
      is_minor: isMinor,
      same_person_as: null,
      script_description: [
        `${latin} appears in scene(s) ${sceneList(refs)}${speaks ? ` and speaks ${d.lines} line(s)` : ""}.`,
        d.intro
          ? `The script introduces them as: "${excerptAround(d.intro.line, d.intro.at)}".`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      facts,
      looks: [],
      signature_prop_ids: [],
      speaks,
      dialogue_line_count: d.lines,
      dialogue_language: speaks ? (ARABIC_SCRIPT.test(d.label) ? "Persian" : "English") : null,
      voice_delivery: speaks ? VOICE_DELIVERIES.filter((v) => d.deliveries.has(v)) : [],
      voice_hints: speaks ? d.hints : [],
      relationships: [],
      scene_refs: refs,
      first_scene: refs[0] ?? numberOf(0),
      ui_summary: uiSummary(lang, "character", naming.name, refs),
    });
    if (isMinor === "yes") output.warnings.push(`MINOR_PRESENT: ${id}`);
    for (const s of d.present) rows[s]?.characters_present.push(id);
    for (const s of d.heard) rows[s]?.heard_only.push(id);
    for (const s of d.cueScenes) rows[s]?.speakers.push(id);
  }
  for (const row of rows) {
    for (const list of [row.characters_present, row.heard_only, row.speakers]) {
      list.sort((a, b) => idNumber(a) - idNumber(b));
    }
  }

  // Locations.
  const locDrafts = collectLocations(scenes);
  const usedNames = new Set<string>();
  const placeCount = new Map<string, number>();
  for (const d of locDrafts)
    placeCount.set(keyOf(d.place), (placeCount.get(keyOf(d.place)) ?? 0) + 1);
  for (const d of locDrafts) {
    let name = displayName(d.place);
    const shared = (placeCount.get(keyOf(d.place)) ?? 0) > 1;
    if (usedNames.has(keyOf(name))) name = `${name} (${d.ie === "int_ext" ? "int-ext" : d.ie})`;
    usedNames.add(keyOf(name));
    const k = matcher.match("loc", [name, d.place]);
    const id = assign("loc", k);
    const naming = knownNaming(k, name, []);
    const refs = d.scenes.map(numberOf);
    const times = d.scenes.map((s) => scenes[s]?.time ?? "unspecified");
    const distinct = [...new Set(times)];
    const frequency = (t: TimeOfDay) => times.filter((x) => x === t).length;
    const main = distinct.reduce(
      (best, t) => (frequency(t) > frequency(best) ? t : best),
      distinct[0] ?? "unspecified",
    );
    const firstScene = scenes[d.scenes[0] ?? 0];
    const states =
      distinct.length > 1
        ? distinct.map((t) => {
            const at = d.scenes.filter((s) => scenes[s]?.time === t);
            const headingLine = scenes[at[0] ?? 0]?.headingLine ?? "";
            return {
              state_id: `${id}_${t}`,
              description: `At ${t}.`,
              scene_refs: at.map(numberOf),
              evidence: firstWords(headingLine, 20),
            };
          })
        : [];
    const fixed: DetectedLocation["fixed_elements_from_script"] = [];
    for (const word of FIXTURE_LEXICON) {
      const pattern = wordPattern(word);
      for (const s of d.scenes) {
        const line = scenes[s]?.lines.find((l) => l.kind === "action" && pattern.test(l.text));
        const m = line ? pattern.exec(line.text) : null;
        if (line && m) {
          fixed.push({
            element: word,
            scene: numberOf(s),
            evidence: excerptAround(line.text, m.index),
          });
          break;
        }
      }
    }
    const firstAction = firstScene?.lines.find((l) => l.kind === "action");
    const ieText = {
      interior: "An interior",
      exterior: "An exterior",
      int_ext: "An interior and exterior",
    }[d.ie];
    const latin = romanize(d.place, `location ${idNumber(id)}`);
    output.locations.push({
      loc_id: id,
      name: naming.name,
      name_latin: latin,
      aliases: naming.aliases,
      location_group: shared ? displayName(d.place) : null,
      interior_exterior: d.ie,
      time_of_day: main,
      times_of_day: distinct,
      states,
      script_description: [
        `${ieText} space (${latin}) used in scene(s) ${sceneList(refs)}, seen at ${distinct.join(", ")}.`,
        firstAction ? `It opens with: "${firstWords(firstAction.text, 20)}".` : "",
      ]
        .filter(Boolean)
        .join(" "),
      facts: firstScene?.headingLine
        ? [
            {
              field: "interior_exterior",
              value: d.ie,
              status: "stated",
              scene: refs[0] ?? "1",
              evidence: firstWords(firstScene.headingLine, 20),
            },
          ]
        : [],
      fixed_elements_from_script: fixed,
      related_asset_ids: [],
      asset_priority: "required",
      scene_refs: refs,
      first_scene: refs[0] ?? "1",
      ui_summary: uiSummary(lang, "location", naming.name, refs),
    });
    for (const s of d.scenes) {
      const row = rows[s];
      if (!row) continue;
      row.location_id = id;
      row.location_state_id =
        states.length > 0 ? `${id}_${scenes[s]?.time ?? "unspecified"}` : null;
    }
  }
  rows.forEach((row) => {
    if (row.location_id === null) {
      output.warnings.push(`NO_LOCATION: scene ${row.scene_number} has no stated place`);
    }
  });

  // Props.
  for (const d of collectProps(scenes, charDrafts)) {
    const name = d.lex.word;
    const k = matcher.match("prop", [name, ...d.aliases]);
    const id = assign("prop", k);
    const naming = knownNaming(k, name, d.aliases);
    const sceneIdx = ordered(d.scenes);
    const refs = sceneIdx.map(numberOf);
    const evidence = excerptAround(d.evidence.line, d.evidence.at);
    const locIds = [
      ...new Set(sceneIdx.map((s) => rows[s]?.location_id).filter((x): x is string => !!x)),
    ];
    output.props.push({
      prop_id: id,
      name: naming.name,
      name_latin: d.lex.latin,
      aliases: naming.aliases,
      category_hint: d.lex.category,
      subtype: d.lex.subtype,
      script_description: `A ${d.lex.latin} named in scene(s) ${sceneList(refs)}: "${evidence}".`,
      facts: [
        {
          field: "presence",
          value: `first seen in scene ${numberOf(d.evidence.scene)}`,
          status: "stated",
          scene: numberOf(d.evidence.scene),
          evidence,
        },
      ],
      states: [],
      text_on_object: [],
      users: [...d.users].map((key) => charIdByKey.get(key)).filter((x): x is string => !!x),
      location_ids: locIds,
      related_asset_ids: [],
      asset_priority: d.lex.minor && refs.length < 2 ? "optional" : "required",
      scene_refs: refs,
      first_scene: refs[0] ?? "1",
      ui_summary: uiSummary(lang, "prop", naming.name, refs),
    });
    for (const s of sceneIdx) rows[s]?.props_present.push(id);
  }

  output.scene_index = rows;
  if (
    output.characters.length === 0 &&
    output.locations.length === 0 &&
    output.props.length === 0
  ) {
    output.warnings.push(
      "SCRIPT_GAP: no characters, locations or props could be read from the script",
    );
  }
  if (input.mode === "incremental") {
    output.diff = {
      added,
      updated: matched.filter((k) => changed(k, output)).map((k) => k.id),
      removed: matcher.unused(),
    };
  }
  return withSummary(output);
}

/** Whether a matched known asset's scene refs or aliases differ from the new entry. */
function changed(known: KnownAsset, output: AssetDetectorOutput): boolean {
  const entry = findEntry(output, known.id);
  if (!entry) return false;
  const previous = JSON.stringify([
    stringList(known.entry, "scene_refs"),
    stringList(known.entry, "aliases"),
  ]);
  const aliases = "aliases" in entry ? entry.aliases : [];
  return previous !== JSON.stringify([entry.scene_refs, aliases]);
}

type AnyEntry = DetectedCharacter | DetectedLocation | DetectedProp;

function findEntry(output: AssetDetectorOutput, id: string): AnyEntry | undefined {
  return (
    output.characters.find((c) => c.char_id === id) ??
    output.locations.find((l) => l.loc_id === id) ??
    output.props.find((p) => p.prop_id === id)
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Fix mode                                                                                    */
/* ------------------------------------------------------------------------------------------ */

function uniq<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

/**
 * Rewrites every reference: ids mapped to another id are renamed, ids mapped to null are removed
 * (a scene's location becomes null). Lists are de-duplicated.
 */
function rewriteIds(output: AssetDetectorOutput, map: ReadonlyMap<string, string | null>): void {
  const one = (id: string): string | null => (map.has(id) ? (map.get(id) ?? null) : id);
  const list = (ids: readonly string[]) =>
    uniq(ids.map(one).filter((x): x is string => x !== null));
  for (const s of output.scene_index) {
    s.characters_present = list(s.characters_present);
    s.heard_only = list(s.heard_only);
    s.speakers = list(s.speakers);
    s.props_present = list(s.props_present);
    s.char_looks = s.char_looks.flatMap((cl) => {
      const id = one(cl.char_id);
      return id ? [{ ...cl, char_id: id }] : [];
    });
    if (s.location_id !== null) {
      const id = one(s.location_id);
      if (id !== s.location_id) {
        if (id === null) s.location_state_id = null;
        s.location_id = id;
      }
    }
  }
  for (const c of output.characters) {
    if (c.same_person_as !== null) c.same_person_as = one(c.same_person_as);
    if (c.same_person_as === c.char_id) c.same_person_as = null;
    c.relationships = c.relationships.flatMap((r) => {
      const id = one(r.char_id);
      return id && id !== c.char_id ? [{ ...r, char_id: id }] : [];
    });
    c.signature_prop_ids = list(c.signature_prop_ids);
  }
  for (const l of output.locations)
    l.related_asset_ids = list(l.related_asset_ids).filter((x) => x !== l.loc_id);
  for (const p of output.props) {
    p.users = list(p.users);
    p.location_ids = list(p.location_ids);
    p.related_asset_ids = list(p.related_asset_ids).filter((x) => x !== p.prop_id);
  }
}

function sortRefs(output: AssetDetectorOutput, refs: Iterable<string>): string[] {
  const order = new Map(output.scene_index.map((s, i) => [s.scene_number, i]));
  return uniq(refs)
    .filter((r) => order.has(r))
    .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

/** Scene refs as the scene index has them (validator 4), and first_scene to match. */
function rebuildRefs(output: AssetDetectorOutput, id: string): void {
  const type = typeOf(id);
  const rows = output.scene_index;
  if (type === "char") {
    const c = output.characters.find((x) => x.char_id === id);
    if (!c) return;
    c.scene_refs = rows
      .filter((s) => s.characters_present.includes(id) || s.heard_only.includes(id))
      .map((s) => s.scene_number);
    c.first_scene = c.scene_refs[0] ?? c.first_scene;
  } else if (type === "loc") {
    const l = output.locations.find((x) => x.loc_id === id);
    if (!l) return;
    l.scene_refs = rows.filter((s) => s.location_id === id).map((s) => s.scene_number);
    l.first_scene = l.scene_refs[0] ?? l.first_scene;
  } else if (type === "prop") {
    const p = output.props.find((x) => x.prop_id === id);
    if (!p) return;
    p.scene_refs = rows.filter((s) => s.props_present.includes(id)).map((s) => s.scene_number);
    p.first_scene = p.scene_refs[0] ?? p.first_scene;
  }
}

type FixContext = {
  input: AssetDetectorParsedInput;
  output: AssetDetectorOutput;
  scenes: Scene[];
  pool: IdPool;
  approved: Set<string>;
};

function record(
  ctx: FixContext,
  req: DetectorFixRequest,
  targetIds: string[],
  change: string,
): void {
  ctx.output.applied_fixes.push({ code: req.code, target_ids: targetIds, change });
}

function requestText(req: DetectorFixRequest): string {
  return (req.custom_text ?? "").trim() || req.instruction.trim();
}

/** ADT01 / ADP02: find the named thing in the script and add it as a character or a prop. */
function addFromScript(ctx: FixContext, req: DetectorFixRequest): void {
  const { output, scenes } = ctx;
  const text = requestText(req);
  const key = keyOf(text);
  const hits: Array<{ scene: number; line: ScriptLine; at: number }> = [];
  scenes.forEach((scene, s) => {
    for (const line of scene.lines) {
      if (line.kind === "other") continue;
      const at = keyOf(line.text).indexOf(key);
      if (key && at >= 0)
        hits.push({ scene: s, line, at: line.text.toLowerCase().indexOf(text.toLowerCase()) });
    }
  });
  if (hits.length === 0) {
    output.warnings.push(`NOT_IN_SCRIPT: ${text}`);
    record(ctx, req, req.target_ids, `not added: "${text}" is not in the script`);
    return;
  }
  // A character: it has a dialogue cue, or an action line introduces it in capitals.
  const upper = text.toUpperCase();
  const isCharacter = hits.some(
    (h) =>
      (h.line.kind === "cue" && keyOf(h.line.speaker ?? "") === key) ||
      (h.line.kind === "action" && hasCase(text) && wordPattern(upper, "u").test(h.line.text)),
  );
  const propScenes = [
    ...new Set(hits.filter((h) => h.line.kind !== "cue").map((h) => h.scene)),
  ].sort((a, b) => a - b);
  if (!isCharacter && propScenes.length === 0) {
    output.warnings.push(`NOT_IN_SCRIPT: ${text}`);
    record(ctx, req, req.target_ids, `not added: "${text}" is only part of a character cue`);
    return;
  }
  const existing = isCharacter
    ? output.characters.find((c) => [c.name, ...c.aliases].some((n) => keyOf(n) === key))
    : output.props.find((p) => [p.name, ...p.aliases].some((n) => keyOf(n) === key));
  if (existing) {
    const id = "char_id" in existing ? existing.char_id : existing.prop_id;
    record(ctx, req, [id], `already listed as ${id}`);
    return;
  }
  // ADP02: the thing leaves the location's fixed elements.
  if (req.code === "ADP02") {
    for (const l of output.locations) {
      if (req.target_ids.length > 0 && !req.target_ids.includes(l.loc_id)) continue;
      l.fixed_elements_from_script = l.fixed_elements_from_script.filter(
        (f) => !keyOf(f.element).includes(key),
      );
    }
  }
  const lang = ctx.input.project.ui_language;
  const numberOf = (s: number) => scenes[s]?.number ?? String(s + 1);
  const first = hits.find((h) => h.line.kind === "action") ?? hits[0];
  if (!first) return;
  const evidence = excerptAround(first.line.text, Math.max(0, first.at));
  const fact: DetectorFact = {
    field: "presence",
    value: `named in scene ${numberOf(first.scene)}`,
    status: "stated",
    scene: numberOf(first.scene),
    evidence,
  };
  const name = displayName(text);
  if (isCharacter) {
    const id = ctx.pool.next("char");
    const present = new Set<number>();
    const heard = new Set<number>();
    const cueScenes = new Set<number>();
    let lines = 0;
    const deliveries = new Set<Delivery>();
    for (const h of hits) {
      if (h.line.kind === "cue" && keyOf(h.line.speaker ?? "") === key) {
        lines += 1;
        cueScenes.add(h.scene);
        if (h.line.ext) {
          heard.add(h.scene);
          deliveries.add(h.line.ext);
        } else {
          present.add(h.scene);
          deliveries.add("on_screen");
        }
      } else if (h.line.kind === "action") {
        present.add(h.scene);
      }
    }
    for (const s of present) heard.delete(s);
    const refs = [...new Set([...present, ...heard])].sort((a, b) => a - b).map(numberOf);
    output.characters.push({
      char_id: id,
      name,
      name_latin: romanize(name, `character ${idNumber(id)}`),
      aliases: [],
      kind: present.size === 0 ? "voice_only" : "human",
      role: refs.length >= 2 ? "supporting" : "minor",
      asset_priority: "required",
      needs_visual: present.size > 0,
      is_minor: "unknown",
      same_person_as: null,
      script_description: `Added on request: ${name} appears in scene(s) ${sceneList(refs)}.`,
      facts: first.line.kind === "action" ? [fact] : [],
      looks: [],
      signature_prop_ids: [],
      speaks: lines > 0,
      dialogue_line_count: lines,
      dialogue_language: lines > 0 ? (ARABIC_SCRIPT.test(text) ? "Persian" : "English") : null,
      voice_delivery: lines > 0 ? VOICE_DELIVERIES.filter((v) => deliveries.has(v)) : [],
      voice_hints: [],
      relationships: [],
      scene_refs: refs,
      first_scene: refs[0] ?? "1",
      ui_summary: uiSummary(lang, "character", name, refs),
    });
    for (const s of present) output.scene_index[s]?.characters_present.push(id);
    for (const s of heard) output.scene_index[s]?.heard_only.push(id);
    for (const s of cueScenes) output.scene_index[s]?.speakers.push(id);
    const addedIds = [id];
    output.diff.added.push(...addedIds);
    record(
      ctx,
      req,
      addedIds,
      `added ${id} "${name}" from the script, scene(s) ${sceneList(refs)}`,
    );
    return;
  }
  const id = ctx.pool.next("prop");
  const sceneIdx = propScenes;
  const refs = sceneIdx.map(numberOf);
  output.props.push({
    prop_id: id,
    name: text,
    name_latin: romanize(text, `prop ${idNumber(id)}`),
    aliases: [],
    category_hint: "hand_prop",
    subtype: null,
    script_description: `Added on request: "${evidence}".`,
    facts: [fact],
    states: [],
    text_on_object: [],
    users: [],
    location_ids: uniq(
      sceneIdx.map((s) => output.scene_index[s]?.location_id).filter((x): x is string => !!x),
    ),
    related_asset_ids: [],
    asset_priority: "required",
    scene_refs: refs,
    first_scene: refs[0] ?? "1",
    ui_summary: uiSummary(lang, "prop", text, refs),
  });
  for (const s of sceneIdx) output.scene_index[s]?.props_present.push(id);
  output.diff.added.push(id);
  record(ctx, req, [id], `added ${id} "${text}" from the script, scene(s) ${sceneList(refs)}`);
}

function mergeLabels(keepName: string, labels: Iterable<string>): string[] {
  const seen = new Set([keyOf(keepName)]);
  const out: string[] = [];
  for (const l of labels) {
    const k = keyOf(l);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out;
}

/** ADT02: merge same-type targets into the approved or lowest id. */
function mergeTargets(ctx: FixContext, req: DetectorFixRequest): void {
  const { output } = ctx;
  const ids = uniq(req.target_ids).filter((id) => findEntry(output, id));
  const types = uniq(ids.map(typeOf));
  if (ids.length < 2 || types.length !== 1) {
    record(ctx, req, req.target_ids, "not applied: pick two or more assets of the same category");
    return;
  }
  const sorted = [...ids].sort((a, b) => idNumber(a) - idNumber(b));
  const keep = sorted.find((id) => ctx.approved.has(id)) ?? (sorted[0] as string);
  const others = sorted.filter((id) => id !== keep);
  const map = new Map<string, string | null>(others.map((id) => [id, keep]));
  const removed = [...others];
  const type = types[0];
  if (type === "char") {
    const k = output.characters.find((c) => c.char_id === keep);
    const os = output.characters.filter((c) => others.includes(c.char_id));
    if (!k) return;
    k.aliases = mergeLabels(k.name, [...k.aliases, ...os.flatMap((o) => [o.name, ...o.aliases])]);
    k.facts = [...k.facts, ...os.flatMap((o) => o.facts)];
    const lookIds = new Set(k.looks.map((l) => l.look_id));
    for (const o of os) for (const l of o.looks) if (!lookIds.has(l.look_id)) k.looks.push(l);
    k.signature_prop_ids = uniq([
      ...k.signature_prop_ids,
      ...os.flatMap((o) => o.signature_prop_ids),
    ]);
    k.relationships = [...k.relationships, ...os.flatMap((o) => o.relationships)];
    k.speaks = k.speaks || os.some((o) => o.speaks);
    k.dialogue_line_count += os.reduce((n, o) => n + o.dialogue_line_count, 0);
    k.needs_visual = k.needs_visual || os.some((o) => o.needs_visual);
    if (k.kind === "voice_only" && os.some((o) => o.kind !== "voice_only")) k.kind = "human";
    if (os.some((o) => o.is_minor === "yes")) k.is_minor = "yes";
    if (os.some((o) => o.asset_priority === "required")) k.asset_priority = "required";
    k.scene_refs = sortRefs(output, [...k.scene_refs, ...os.flatMap((o) => o.scene_refs)]);
    k.first_scene = k.scene_refs[0] ?? k.first_scene;
    k.dialogue_language =
      k.dialogue_language ?? os.find((o) => o.dialogue_language)?.dialogue_language ?? null;
    k.voice_delivery = VOICE_DELIVERIES.filter(
      (d) => k.voice_delivery.includes(d) || os.some((o) => o.voice_delivery.includes(d)),
    );
    k.voice_hints = [...k.voice_hints, ...os.flatMap((o) => o.voice_hints)];
    output.characters = output.characters.filter((c) => !others.includes(c.char_id));
  } else if (type === "loc") {
    const k = output.locations.find((l) => l.loc_id === keep);
    const os = output.locations.filter((l) => others.includes(l.loc_id));
    if (!k) return;
    k.aliases = mergeLabels(k.name, [...k.aliases, ...os.flatMap((o) => [o.name, ...o.aliases])]);
    k.facts = [...k.facts, ...os.flatMap((o) => o.facts)];
    const stateIds = new Set(k.states.map((s) => s.state_id));
    for (const o of os) for (const s of o.states) if (!stateIds.has(s.state_id)) k.states.push(s);
    k.fixed_elements_from_script = [
      ...k.fixed_elements_from_script,
      ...os.flatMap((o) => o.fixed_elements_from_script),
    ];
    k.related_asset_ids = uniq([...k.related_asset_ids, ...os.flatMap((o) => o.related_asset_ids)]);
    k.times_of_day = uniq([...k.times_of_day, ...os.flatMap((o) => o.times_of_day)]);
    k.scene_refs = sortRefs(output, [...k.scene_refs, ...os.flatMap((o) => o.scene_refs)]);
    k.first_scene = k.scene_refs[0] ?? k.first_scene;
    output.locations = output.locations.filter((l) => !others.includes(l.loc_id));
  } else {
    const k = output.props.find((p) => p.prop_id === keep);
    const os = output.props.filter((p) => others.includes(p.prop_id));
    if (!k) return;
    k.aliases = mergeLabels(k.name, [...k.aliases, ...os.flatMap((o) => [o.name, ...o.aliases])]);
    k.facts = [...k.facts, ...os.flatMap((o) => o.facts)];
    const stateIds = new Set(k.states.map((s) => s.state_id));
    for (const o of os) for (const s of o.states) if (!stateIds.has(s.state_id)) k.states.push(s);
    k.text_on_object = [...k.text_on_object, ...os.flatMap((o) => o.text_on_object)];
    k.users = uniq([...k.users, ...os.flatMap((o) => o.users)]);
    k.location_ids = uniq([...k.location_ids, ...os.flatMap((o) => o.location_ids)]);
    k.related_asset_ids = uniq([...k.related_asset_ids, ...os.flatMap((o) => o.related_asset_ids)]);
    if (os.some((o) => o.asset_priority === "required")) k.asset_priority = "required";
    k.scene_refs = sortRefs(output, [...k.scene_refs, ...os.flatMap((o) => o.scene_refs)]);
    k.first_scene = k.scene_refs[0] ?? k.first_scene;
    output.props = output.props.filter((p) => !others.includes(p.prop_id));
  }
  rewriteIds(output, map);
  output.diff.removed.push(...removed);
  output.diff.updated.push(keep);
  record(ctx, req, sorted, `merged ${others.join(", ")} into ${keep}`);
}

const CATEGORY: Readonly<Record<string, AssetType>> = {
  character: "char",
  location: "loc",
  prop: "prop",
};

/** ADT04: move the target to the category named in custom_text, with a new id. */
function moveTarget(ctx: FixContext, req: DetectorFixRequest): void {
  const { output } = ctx;
  const id = req.target_ids.find((t) => findEntry(output, t));
  const word = (req.custom_text ?? "").trim().toLowerCase();
  const to = Object.entries(CATEGORY).find(([w]) => word.includes(w))?.[1];
  const from = id ? typeOf(id) : null;
  if (!id || !to || !from || to === from) {
    record(
      ctx,
      req,
      req.target_ids,
      'not applied: name the target and the new category ("character", "location" or "prop")',
    );
    return;
  }
  const old = findEntry(output, id);
  if (!old || !("name" in old)) return;
  const rows = output.scene_index;
  const refs = [...old.scene_refs];
  // A location needs scenes without another location.
  const freeScenes =
    to === "loc"
      ? rows
          .filter(
            (s) =>
              refs.includes(s.scene_number) && (s.location_id === null || s.location_id === id),
          )
          .map((s) => s.scene_number)
      : refs;
  if (freeScenes.length === 0) {
    output.warnings.push(
      `AMBIGUOUS: ${id} shares all its scenes with other locations; it was not moved`,
    );
    record(ctx, req, [id], "not applied: every scene of the target already has a location");
    return;
  }
  const newId = ctx.pool.next(to);
  const removed = [id];
  const map = new Map<string, string | null>([[id, null]]);
  if (from === "char") {
    output.characters = output.characters.filter((c) => c.char_id !== id);
  } else if (from === "loc") {
    output.locations = output.locations.filter((l) => l.loc_id !== id);
  } else {
    output.props = output.props.filter((p) => p.prop_id !== id);
  }
  const lostLocation =
    from === "loc" ? rows.filter((s) => s.location_id === id).map((s) => s.scene_number) : [];
  rewriteIds(output, map);
  const lang = ctx.input.project.ui_language;
  const base = {
    name: old.name,
    name_latin: old.name_latin,
    aliases: old.aliases,
    script_description: old.script_description,
    facts: "facts" in old ? old.facts : [],
  };
  if (to === "char") {
    output.characters.push({
      ...base,
      char_id: newId,
      kind: "human",
      role: "minor",
      asset_priority: "required",
      needs_visual: true,
      is_minor: "unknown",
      same_person_as: null,
      looks: [],
      signature_prop_ids: [],
      speaks: false,
      dialogue_line_count: 0,
      dialogue_language: null,
      voice_delivery: [],
      voice_hints: [],
      relationships: [],
      scene_refs: refs,
      first_scene: refs[0] ?? old.first_scene,
      ui_summary: uiSummary(lang, "character", old.name, refs),
    });
    for (const s of rows) if (refs.includes(s.scene_number)) s.characters_present.push(newId);
  } else if (to === "prop") {
    output.props.push({
      ...base,
      prop_id: newId,
      category_hint: "hand_prop",
      subtype: null,
      states: [],
      text_on_object: [],
      users: [],
      location_ids: uniq(
        rows
          .filter((s) => refs.includes(s.scene_number))
          .flatMap((s) => (s.location_id ? [s.location_id] : [])),
      ),
      related_asset_ids: [],
      asset_priority: "required",
      scene_refs: refs,
      first_scene: refs[0] ?? old.first_scene,
      ui_summary: uiSummary(lang, "prop", old.name, refs),
    });
    for (const s of rows) if (refs.includes(s.scene_number)) s.props_present.push(newId);
  } else {
    const at = rows.filter((s) => freeScenes.includes(s.scene_number));
    const times = uniq(at.map((s) => s.time_of_day));
    const heading = ctx.scenes.find((s) => s.number === at[0]?.scene_number)?.parsed;
    output.locations.push({
      ...base,
      loc_id: newId,
      location_group: null,
      interior_exterior: heading?.ie ?? "interior",
      time_of_day: times[0] ?? "unspecified",
      times_of_day: times,
      states: [],
      fixed_elements_from_script: [],
      related_asset_ids: [],
      asset_priority: "required",
      scene_refs: freeScenes,
      first_scene: freeScenes[0] ?? old.first_scene,
      ui_summary: uiSummary(lang, "location", old.name, freeScenes),
    });
    for (const s of at) {
      s.location_id = newId;
      s.location_state_id = null;
    }
  }
  for (const n of lostLocation)
    output.warnings.push(`NO_LOCATION: scene ${n} lost its location when ${id} was moved`);
  output.diff.removed.push(...removed);
  output.diff.added.push(newId);
  record(ctx, req, [id, newId], `moved ${id} to ${newId}`);
}

function sampleFix(input: AssetDetectorParsedInput): AssetDetectorOutput {
  const previous = input.previous_output;
  if (!previous) throw new Error("fix mode needs previous_output");
  const output: AssetDetectorOutput = structuredClone(previous);
  output.mode = "fix";
  output.diff = { added: [], updated: [], removed: [] };
  output.applied_fixes = [];
  const pool = new IdPool();
  for (const id of [
    ...output.characters.map((c) => c.char_id),
    ...output.locations.map((l) => l.loc_id),
    ...output.props.map((p) => p.prop_id),
    ...previous.diff.removed,
    ...(input.known_assets ?? []).map((k) => k.id),
  ]) {
    pool.see(id);
  }
  const ctx: FixContext = {
    input,
    output,
    scenes: readScenes(input).scenes,
    pool,
    approved: new Set(
      (input.known_assets ?? []).filter((k) => k.status === "approved").map((k) => k.id),
    ),
  };
  for (const req of input.fix_requests ?? []) {
    switch (req.code) {
      case "ADT01":
      case "ADP02":
        addFromScript(ctx, req);
        break;
      case "ADT02":
        mergeTargets(ctx, req);
        break;
      case "ADT04":
        moveTarget(ctx, req);
        break;
      case "ADT05": {
        const assumptionsBefore = output.assumptions.length;
        const checked = finalizeDetection(ctx.output, input);
        Object.assign(ctx.output, checked);
        const removed = ctx.output.assumptions.length - assumptionsBefore;
        ctx.output.diff.updated.push(...req.target_ids.filter((t) => findEntry(ctx.output, t)));
        record(
          ctx,
          req,
          req.target_ids,
          `re-checked facts against the script; ${removed} without evidence removed`,
        );
        break;
      }
      case "ADT06":
        for (const t of req.target_ids) rebuildRefs(ctx.output, t);
        ctx.output.diff.updated.push(...req.target_ids.filter((t) => findEntry(ctx.output, t)));
        record(ctx, req, req.target_ids, "rebuilt scene_refs from the scene index");
        break;
      default:
        record(ctx, req, req.target_ids, "kept as is: the script gives nothing more to change");
    }
  }
  const out = ctx.output;
  const live = (id: string) => !!findEntry(out, id);
  out.diff = {
    added: uniq(out.diff.added).filter(live),
    updated: uniq(out.diff.updated).filter((id) => live(id) && !out.diff.added.includes(id)),
    removed: uniq(out.diff.removed).filter((id) => !live(id)),
  };
  return withSummary(out);
}

/* ------------------------------------------------------------------------------------------ */

/**
 * Entries of one type that share a name or alias (a known asset matched under one label, the
 * script calling it by another) are flagged for the user with MERGE_CHECK, as the owner asks for
 * uncertain merges.
 */
function flagOverlaps(output: AssetDetectorOutput): AssetDetectorOutput {
  const groups: { id: string; labels: string[] }[][] = [
    output.characters.map((c) => ({ id: c.char_id, labels: [c.name, ...c.aliases] })),
    output.locations.map((l) => ({ id: l.loc_id, labels: [l.name, ...l.aliases] })),
    output.props.map((p) => ({ id: p.prop_id, labels: [p.name, ...p.aliases] })),
  ];
  for (const entries of groups) {
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i];
        const b = entries[j];
        if (!a || !b) continue;
        const keys = new Set(a.labels.map(keyOf));
        const shared = b.labels.find((l) => keys.has(keyOf(l)));
        if (!shared) continue;
        const warning = `MERGE_CHECK: ${a.id} and ${b.id} may be the same (both are called "${shared}")`;
        if (!output.warnings.includes(warning)) output.warnings.push(warning);
      }
    }
  }
  return output;
}

export function sampleAssetDetector(raw: unknown): AssetDetectorOutput {
  const input = assetDetectorInputSchema.parse(raw);
  return flagOverlaps(input.mode === "fix" ? sampleFix(input) : detect(input));
}
