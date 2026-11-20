/**
 * The Director Style Cards the film-director dami can direct with. Each card is a reviewed
 * Markdown file next to this one (`<id>.card.md`) whose text is copied into `<id>.card.ts`, so
 * both the Next server and the esbuild worker bundle carry it without reading the file system;
 * `film-director.test.ts` checks every copy against its .md. A card is made by a live Mode A run of
 * `film-director-card` and reviewed before it lands here.
 */
import { NOLAN_CARD } from "./nolan.card";

export const DIRECTOR_STYLE_IDS = ["nolan"] as const;
export type DirectorStyleId = (typeof DIRECTOR_STYLE_IDS)[number];

export type DirectorStyle = {
  id: DirectorStyleId;
  /** The director's name, as the card's section 0 names them. */
  name: string;
  /** The reviewed source file, next to this one. */
  cardFile: string;
  /** Bump when the card text changes (stored with the run through the dami's input). */
  version: string;
  /** True while the card is a hand-written stand-in for the Mode A output. */
  placeholder: boolean;
};

export const DIRECTOR_STYLES: readonly DirectorStyle[] = [
  {
    id: "nolan",
    name: "Christopher Nolan",
    cardFile: "nolan.card.md",
    version: "0.1.0",
    placeholder: true,
  },
];

const CARD_TEXT: Readonly<Record<DirectorStyleId, string>> = {
  nolan: NOLAN_CARD,
};

/** A leading `<!-- ... -->` line (the placeholder marker) is review metadata, not card text. */
const LEADING_COMMENT = /^<!--[\s\S]*?-->\s*/;

export function isDirectorStyleId(id: string): id is DirectorStyleId {
  return (DIRECTOR_STYLE_IDS as readonly string[]).includes(id);
}

export function directorStyle(id: DirectorStyleId): DirectorStyle {
  const style = DIRECTOR_STYLES.find((s) => s.id === id);
  if (!style) throw new Error(`Unknown director style "${id}"`);
  return style;
}

/** The card as the model reads it: the file's text without the leading review comment. */
export function directorStyleCard(id: DirectorStyleId): string {
  return CARD_TEXT[id].replace(LEADING_COMMENT, "");
}

/** The card file's text exactly as committed (for the source-match test). */
export function directorStyleCardSource(id: DirectorStyleId): string {
  return CARD_TEXT[id];
}
