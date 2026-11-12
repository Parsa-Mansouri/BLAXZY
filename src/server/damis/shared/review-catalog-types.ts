/**
 * The normalized shape of the owner's review catalogs (the "complaint menus" a user picks
 * rejection reasons from). Each `review-catalog.json` has its own shape; `review-catalog.ts`
 * parses each one and maps it to these types.
 */
import type { ReviewFixRequest } from "@/server/db/schema";

/** technical/preference: a fix the dami applies · regenerate: a re-roll or re-run · route: go to another step · backend: an edit with no dami call. */
export const REVIEW_OPTION_KINDS = [
  "technical",
  "preference",
  "regenerate",
  "route",
  "backend",
] as const;
export type ReviewOptionKind = (typeof REVIEW_OPTION_KINDS)[number];

export type FollowupChoice = { label: string; labelFa?: string; value: string };

/** One step of a multi-step follow-up (pick a detail frame, then what it should show). */
export type FollowupStep = {
  type: string;
  label?: string;
  labelFa?: string;
  allowCustom: boolean;
  options: FollowupChoice[];
  /** Where the UI gets the choices at run time (for example `previous_output.detail_cells`). */
  dynamicOptionsSource?: string;
  /** How a dynamic choice is shown, for example `{slot} — {slot_subject}`. */
  display?: string;
};

export type ReviewFollowup = {
  /** `chips_or_text`, `text`, `chips` or `steps`. */
  type: string;
  options: FollowupChoice[];
  allowCustom: boolean;
  dynamicOptionsSource?: string;
  steps?: FollowupStep[];
};

/** A condition on the review context: the option shows (availableWhen) or hides (hideWhen) when `context[key] === value`. */
export type ReviewCondition = { key: string; value: boolean };

export type ReviewOption = {
  code: string;
  kind: ReviewOptionKind;
  group?: string;
  /** English label (the UI's language). */
  label: string;
  labelFa?: string;
  /** The fix instruction sent to the dami as is. */
  instruction?: string;
  /** An instruction with `{value}`, `{slot}` and `{slot_subject}` placeholders. */
  instructionTemplate?: string;
  /** The template used when the user lets the dami choose (follow-up value `__auto__`). */
  instructionTemplateAuto?: string;
  followup?: ReviewFollowup;
  /** The option is not usable without the user's own text. */
  needsText: boolean;
  /** Hidden in the Wizard sector. */
  proOnly: boolean;
  /** Choosing it runs a dami (Claude). False for re-rolls, routes and backend edits. */
  callsClaude: boolean;
  /** The fix may be made by editing the previous image instead of drawing anew. */
  editEligible: boolean;
  availableWhen?: ReviewCondition;
  hideWhen?: ReviewCondition;
  /** The reference role ("face", "outfit") this change contradicts: ask before running. */
  conflictsWithReference?: string;
  /** Another option to suggest before this one (for example a re-roll for random glitches). */
  suggestFirst?: string;
  /** How many assets the user must pick (0: none, 1: one, 2: two or more). */
  targetCount?: number;
  /** What the backend does (re-roll, route, rescan, skip ...), for non-dami options. */
  action?: string;
  /** Notes from the owner for the UI or the backend. */
  note?: string;
};

export type ReviewGroup = { id: string; label: string; labelFa?: string };

export type ReviewCatalog = {
  /** The dami folder the catalog belongs to. */
  key: ReviewCatalogKey;
  /** The owner's dami name, as in the catalog. */
  dami: string;
  version: string;
  /** What is reviewed (hero, sheet view ...), when the catalog says. */
  appliesTo?: string;
  flow?: string;
  maxAttemptsBeforeSuggestion?: number;
  /** Shown after `maxAttemptsBeforeSuggestion` rejected rounds. */
  attemptMessage?: { en: string; fa?: string };
  groups: ReviewGroup[];
  options: ReviewOption[];
  /** The owner's catalog-level rules, as written (strings or small objects). */
  rules: Record<string, unknown>;
};

export const REVIEW_CATALOG_KEYS = [
  "asset-detector",
  "character-generator",
  "location-generator",
  "prop-generator",
  "sheet-generator-character",
  "sheet-generator-location",
  "sheet-generator-prop",
] as const;
export type ReviewCatalogKey = (typeof REVIEW_CATALOG_KEYS)[number];

/** English labels for a catalog written with Farsi labels only (see each `labels.en.ts`). */
export type CatalogLabelsEn = {
  options: Record<string, string>;
  groups?: Record<string, string>;
  /** Per option code: chip value → label. */
  followupOptions?: Record<string, Record<string, string>>;
  /** Per option code: one label per follow-up step. */
  followupSteps?: Record<string, string[]>;
  messages?: { attemptLimit?: string; referenceConflict?: string; designChange?: string };
  referenceConflictChoices?: string[];
};

export type FixRequest = ReviewFixRequest;
