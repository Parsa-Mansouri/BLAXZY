/**
 * Pure helpers for demo hints (see DemoHint): the sample prompt a typing scene writes, and the
 * timing of every character it types. No React, no DOM.
 */

/** The asset kinds with a template of their own. Any other kind gets the generic template. */
export const DEMO_PROMPT_KINDS = [
  "character",
  "location",
  "prop",
  "voice",
  "creature",
  "costume",
  "other",
] as const;

export type DemoPromptKind = (typeof DEMO_PROMPT_KINDS)[number];

interface PromptTemplate {
  /** Stands in for a missing name: "The character". */
  noun: string;
  /** Second sentence when the asset has no description. */
  plain: string;
  /** Closing sentence: how a good reference of this kind is shown. */
  framing: string;
}

const TEMPLATES: Record<DemoPromptKind, PromptTemplate> = {
  character: {
    noun: "The character",
    plain: "Face, hair and clothing clearly shown.",
    framing: "Full figure, standing alone, even light on a plain background.",
  },
  location: {
    noun: "The location",
    plain: "The whole place in one wide view.",
    framing: "Even daylight, no people, materials and colours clear.",
  },
  prop: {
    noun: "The prop",
    plain: "Its material, size and condition clearly shown.",
    framing: "The object alone, evenly lit, on a plain background.",
  },
  voice: {
    noun: "The voice",
    plain: "A natural speaking voice, close and clear.",
    framing: "Steady pace, no music, no room echo.",
  },
  creature: {
    noun: "The creature",
    plain: "Body, markings and face clearly shown.",
    framing: "Whole and alone, evenly lit, on a plain background.",
  },
  costume: {
    noun: "The costume",
    plain: "Every garment, its fabric and its colours.",
    framing: "Shown whole, evenly lit, on a plain background.",
  },
  other: {
    noun: "The subject",
    plain: "Its shape, materials and colours clearly shown.",
    framing: "Shown whole and evenly lit.",
  },
};

const GENERIC: PromptTemplate = TEMPLATES.other;

/** Longest description sentence a sample prompt carries. */
const DESCRIPTION_MAX = 96;

function isKnownKind(kind: string): kind is DemoPromptKind {
  return (DEMO_PROMPT_KINDS as readonly string[]).includes(kind);
}

function tidy(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Cuts at a word boundary, without a trailing comma or dash. Never adds an ellipsis. */
export function clipText(text: string, max: number): string {
  const clean = tidy(text);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max + 1);
  const space = cut.lastIndexOf(" ");
  const clipped = space > max * 0.5 ? cut.slice(0, space) : clean.slice(0, max);
  return clipped.replace(/[\s,;:\-–—]+$/, "");
}

/** The description's first sentence, clipped, capitalised and closed with a full stop. */
function descriptionSentence(description: string | null | undefined): string | null {
  const clean = tidy(description ?? "");
  if (!clean) return null;
  const first = clean.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? clean;
  const body = clipText(first, DESCRIPTION_MAX).replace(/[.!?,;:\s]+$/, "");
  if (!body) return null;
  return `${body.charAt(0).toUpperCase()}${body.slice(1)}.`;
}

/**
 * A believable prompt for one asset, in the tone of the real prompt field: the name, what the
 * asset is (its description when there is one), and how a good reference of that kind is
 * shown. Two or three short sentences. Unknown kinds get the generic template.
 *
 *   samplePrompt("character", "Ines", "The keeper's daughter, thirty, in a patched oilskin")
 *   // "Ines. The keeper's daughter, thirty, in a patched oilskin. Full figure, standing
 *   //  alone, even light on a plain background."
 */
export function samplePrompt(
  kind: string,
  name: string | null | undefined,
  description?: string | null,
): string {
  const template = isKnownKind(kind) ? TEMPLATES[kind] : GENERIC;
  const cleanName = tidy(name ?? "").replace(/[.!?,;:\s]+$/, "");
  const subject = cleanName ? clipText(cleanName, 48) : template.noun;
  const about = descriptionSentence(description) ?? template.plain;
  return `${subject}. ${about} ${template.framing}`;
}

/* ---------- Typing timing ---------- */

export interface TypingOptions {
  /** Average time per character while typing. Default 34ms. */
  stepMs?: number;
  /** Time per character while erasing. Default 9ms. */
  eraseStepMs?: number;
  /** How long a finished line stays before it is erased. Default 1400ms. */
  holdMs?: number;
  /** The pause between an erased line and the next one. Default 320ms. */
  gapMs?: number;
  /** Delay before the first character. Default 300ms. */
  startMs?: number;
  /** Lines are clipped to this many characters. Default 150. */
  maxChars?: number;
}

export interface TypedChar {
  char: string;
  /** When the character appears, from the start of the scene. */
  inMs: number;
  /** How long the caret stays behind this character (until the next one appears). */
  caretMs: number;
  /** When the character is erased; null in the pass that stays. */
  outMs: number | null;
}

export interface TypingPass {
  text: string;
  chars: TypedChar[];
  /** When the last character has appeared. */
  typedMs: number;
  /** When the pass is over: fully erased, or fully typed for the pass that stays. */
  endMs: number;
  /** True for the last pass, which is never erased: the scene's still frame. */
  stays: boolean;
}

export interface TypingPlan {
  passes: TypingPass[];
  totalMs: number;
}

/** The caret blinks once per this long while a finished line is held. */
export const CARET_BLINK_MS = 700;

/** A steady hand is not a metronome: each key lands between 0.6 and 1.4 steps after the last. */
function rhythm(index: number): number {
  const wave = (index * 0.618_033_988_75) % 1;
  return 0.6 + wave * 0.8;
}

/** Writers pause after a comma and longer after a sentence. In steps. */
function pauseAfter(char: string): number {
  if (char === "." || char === "!" || char === "?") return 8;
  if (char === "," || char === ";" || char === ":") return 4;
  return 0;
}

/**
 * When every character of a typing scene appears and disappears.
 *
 * Each line is typed, held and erased in turn; then the first line is typed once more and stays,
 * so the last frame (also what reduced motion shows) is the first line fully typed. A single
 * line is typed once and stays. Empty lines are dropped; long lines are clipped.
 */
export function typingPlan(lines: readonly string[], options: TypingOptions = {}): TypingPlan {
  const {
    stepMs = 34,
    eraseStepMs = 9,
    holdMs = 1400,
    gapMs = 320,
    startMs = 300,
    maxChars = 150,
  } = options;

  const texts = lines.map((line) => clipText(line, maxChars)).filter((line) => line.length > 0);
  const first = texts[0];
  if (first === undefined) return { passes: [], totalMs: 0 };
  const sequence = texts.length > 1 ? [...texts, first] : texts;

  const passes: TypingPass[] = [];
  let clock = startMs;

  sequence.forEach((text, passIndex) => {
    const stays = passIndex === sequence.length - 1;
    const letters = Array.from(text);
    const ins: number[] = [];
    let at = clock;
    letters.forEach((char, i) => {
      ins.push(Math.round(at));
      at += stepMs * (rhythm(i) + pauseAfter(char));
    });
    const typedMs = ins[ins.length - 1] ?? clock;
    const eraseAt = typedMs + holdMs;

    const chars = letters.map<TypedChar>((char, i) => {
      const inMs = ins[i] ?? typedMs;
      const next = ins[i + 1];
      return {
        char,
        inMs,
        caretMs: next === undefined ? holdMs : Math.max(1, next - inMs),
        outMs: stays ? null : Math.round(eraseAt + (letters.length - 1 - i) * eraseStepMs),
      };
    });

    const endMs = stays ? typedMs : Math.round(eraseAt + letters.length * eraseStepMs);
    passes.push({ text, chars, typedMs, endMs, stays });
    clock = endMs + gapMs;
  });

  return { passes, totalMs: passes[passes.length - 1]?.endMs ?? 0 };
}

/** How many times the caret blinks behind a finished line that is held for `holdMs`. */
export function caretBlinks(holdMs: number): number {
  return Math.max(1, Math.round(holdMs / CARET_BLINK_MS));
}
