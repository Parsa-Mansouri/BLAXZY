/**
 * The owner's six cinematographer cards. Each card (in `source/`) is a single-image prompt enhancer:
 * Rule 1 (the content belongs to the user), Rule 2 (the look, ending in "### Modes"), Rule 3 (the
 * output) and examples. The cinematographer dami sends the chosen card verbatim as its system
 * prompt; `cards/<id>.ts` holds the copies and `cinematographer.test.ts` checks them against the
 * sources, and checks the `modes` below against each card's "### Modes" section.
 */
import { CHRISTOPHER_DOYLE_CARD } from "./cards/christopher_doyle";
import { DEAKINS_CARD } from "./cards/deakins";
import { DELBONNEL_CARD } from "./cards/delbonnel";
import { GORDON_WILLIS_CARD } from "./cards/gordon_willis";
import { LUBEZKI_CARD } from "./cards/lubezki";
import { STORARO_CARD } from "./cards/storaro";

export const CINEMATOGRAPHER_IDS = [
  "deakins",
  "christopher_doyle",
  "delbonnel",
  "gordon_willis",
  "lubezki",
  "storaro",
] as const;
export type CinematographerId = (typeof CINEMATOGRAPHER_IDS)[number];

/** Every mode letter any card uses (Storaro has four). */
export const CINEMATOGRAPHER_MODE_IDS = ["A", "B", "C", "D"] as const;
export type CinematographerModeId = (typeof CINEMATOGRAPHER_MODE_IDS)[number];

export type CinematographerMode = { id: CinematographerModeId; name: string };

export type Cinematographer = {
  id: CinematographerId;
  name: string;
  /** The owner's card version (from the source file name). */
  version: string;
  /** The source file in `source/`. */
  sourceFile: string;
  /** The card, verbatim: the dami's system prompt. */
  system: string;
  /** The card's "### Modes", in order. */
  modes: readonly CinematographerMode[];
  /** The mode the card names as its default (or its catch-all when it names none). */
  defaultModeId: CinematographerModeId;
};

export const CINEMATOGRAPHERS: readonly Cinematographer[] = [
  {
    id: "deakins",
    name: "Roger Deakins",
    version: "1.2",
    sourceFile: "deakins_v1.2.md",
    system: DEAKINS_CARD,
    modes: [
      { id: "A", name: "Naturalist" },
      { id: "B", name: "Graphic color" },
    ],
    defaultModeId: "A",
  },
  {
    id: "christopher_doyle",
    name: "Christopher Doyle",
    version: "1.1",
    sourceFile: "christopher_doyle_v1.1.md",
    system: CHRISTOPHER_DOYLE_CARD,
    modes: [
      { id: "A", name: "Restless city" },
      { id: "B", name: "Hushed chamber" },
      { id: "C", name: "Open land" },
    ],
    defaultModeId: "B",
  },
  {
    id: "delbonnel",
    name: "Bruno Delbonnel",
    version: "1.2",
    sourceFile: "delbonnel_v1.2.md",
    system: DELBONNEL_CARD,
    modes: [
      { id: "A", name: "Warm fable" },
      { id: "B", name: "Winter melancholy" },
      { id: "C", name: "Shafts and shadow" },
    ],
    defaultModeId: "B",
  },
  {
    id: "gordon_willis",
    name: "Gordon Willis",
    version: "1.3",
    sourceFile: "gordon_willis_v1.3.md",
    system: GORDON_WILLIS_CARD,
    modes: [
      { id: "A", name: "Amber dark" },
      { id: "B", name: "Cold architecture" },
      { id: "C", name: "Monochrome city" },
    ],
    defaultModeId: "A",
  },
  {
    id: "lubezki",
    name: "Emmanuel Lubezki",
    version: "1.2",
    sourceFile: "lubezki_v1.2.md",
    system: LUBEZKI_CARD,
    modes: [
      { id: "A", name: "Lyrical naturalism" },
      { id: "B", name: "Visceral wilderness" },
      { id: "C", name: "Documentary realism" },
    ],
    defaultModeId: "A",
  },
  {
    id: "storaro",
    name: "Vittorio Storaro",
    version: "1.2",
    sourceFile: "storaro_v1.2.md",
    system: STORARO_CARD,
    modes: [
      { id: "A", name: "Sunset beam" },
      { id: "B", name: "Color conflict" },
      { id: "C", name: "Golden epic" },
      { id: "D", name: "Cold monochrome" },
    ],
    defaultModeId: "A",
  },
];

export function isCinematographerId(id: string): id is CinematographerId {
  return (CINEMATOGRAPHER_IDS as readonly string[]).includes(id);
}

export function cinematographerCard(id: CinematographerId): Cinematographer {
  const card = CINEMATOGRAPHERS.find((c) => c.id === id);
  if (!card) throw new Error(`Unknown cinematographer "${id}"`);
  return card;
}

/** Whether `modeId` is one of the card's modes. */
export function isCardMode(id: CinematographerId, modeId: string): boolean {
  return cinematographerCard(id).modes.some((m) => m.id === modeId);
}

/**
 * The part of a card CINEMATOGRAPHER v1.0 reads as `<cinematographer_style_card>`: "## Rule 2: The
 * look" with its sections, through "### Modes", up to "## Rule 3". The card's title (which names
 * the DP), Rule 1 (restated in the precedence instruction), Rule 3 (one image prompt) and the
 * examples are left out.
 */
export function cinematographerStyleCard(id: CinematographerId): string {
  const card = cinematographerCard(id).system;
  const start = card.indexOf("## Rule 2");
  const end = card.indexOf("## Rule 3", start);
  if (start < 0 || end < 0) throw new Error(`Card "${id}" has no Rule 2 / Rule 3 sections`);
  return card.slice(start, end).trimEnd();
}
