import type { SelectedPassage } from "../../_lib/review-ranges";
import type { Finding } from "../version-types";
import type { DraftComment } from "../review-comments";

export interface PlacedFinding {
  finding: Finding;
  key: string;
  /** Offset of the passage the finding quotes. */
  start: number;
}

export interface CommentApi {
  comments: DraftComment[];
  full: boolean;
  add: (range: { start: number; end: number; quote: string }) => DraftComment;
  update: (id: string, note: string) => void;
  remove: (id: string) => void;
}

export type MarginNote =
  | { kind: "finding"; key: string; anchor: number; finding: Finding }
  | { kind: "comment"; key: string; anchor: number; comment: DraftComment };

/** Where the floating Comment control sits (relative to the sheet) and what it would do. */
export interface Picked {
  passage: SelectedPassage;
  top: number;
  left: number;
}
