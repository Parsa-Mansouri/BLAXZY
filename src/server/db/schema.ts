/**
 * Drizzle schema for BLAXZY. This file is the data contract for every module.
 *
 * Rules (see CLAUDE.md and docs/PRO_READINESS.md):
 * - Domain data is versioned and append-only: add a new row, never overwrite or hard-delete.
 * - Every table has indexes for its access paths; every list query is paginated.
 * - Status-like columns are `text` typed with a TypeScript union (not Postgres enums), so new
 *   values need no migration. Services validate values with Zod before writing.
 * - Anything the Wizard decides on the user's behalf is stored as data, so Pro can expose it.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () =>
  ts("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/* -------------------------------------------------------------------------- */
/* Value unions                                                                */
/* -------------------------------------------------------------------------- */

export const USER_ROLES = ["user", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const PROJECT_MODES = ["wizard", "pro"] as const;
export type ProjectMode = (typeof PROJECT_MODES)[number];

/** Where a project's title came from: the placeholder, Claude's automatic name, or the user. */
export const TITLE_SOURCES = ["placeholder", "auto", "user"] as const;
export type TitleSource = (typeof TITLE_SOURCES)[number];
/** The title a project has until it is named. */
export const PLACEHOLDER_TITLE = "Untitled project";

/** Wizard stages, in order. Pro may use other stage keys; the column is free text. */
export const WIZARD_STAGES = ["style", "script", "pre_production", "production", "done"] as const;
export type WizardStage = (typeof WIZARD_STAGES)[number];

export const PROJECT_FORMATS = ["movie", "series"] as const;
export type ProjectFormat = (typeof PROJECT_FORMATS)[number];

export const ORIENTATIONS = ["landscape", "portrait"] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

/** enhanced: the user's quick idea, rewritten by the Enhancer dami (prose, not a screenplay). */
export const SCRIPT_SOURCES = ["uploaded", "generated", "revised", "edited", "enhanced"] as const;
export type ScriptSource = (typeof SCRIPT_SOURCES)[number];

/**
 * pending: a dami is still producing/checking it · in_review: waiting for the user ·
 * accepted / rejected: the user's decision · superseded: an older accepted version replaced
 * by a newer accepted one, or an approved outline replaced by the script written from it ·
 * failed: the dami run failed.
 */
export const SCRIPT_STATUSES = [
  "pending",
  "in_review",
  "accepted",
  "rejected",
  "superseded",
  "failed",
] as const;
export type ScriptStatus = (typeof SCRIPT_STATUSES)[number];

export const ASSET_KINDS = [
  "character",
  "location",
  "prop",
  "voice",
  "creature",
  "costume",
  "other",
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** detected/manual assets are `active`; one no longer in the script becomes `removed` (kept). */
export const ASSET_STATUSES = ["active", "removed"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

/**
 * required / optional come from the Asset Detector; skipped is the user's choice (ADP01): the
 * asset is not designed, and later damis describe it inline from its script description.
 */
export const ASSET_PRIORITIES = ["required", "optional", "skipped"] as const;
export type AssetPriority = (typeof ASSET_PRIORITIES)[number];

export const ASSET_ORIGINS = ["detected", "manual"] as const;
export type AssetOrigin = (typeof ASSET_ORIGINS)[number];

/** `aborted`: stopped before it finished (job expired or worker shutdown); not a dami failure. */
export const DAMI_RUN_STATUSES = ["queued", "running", "succeeded", "failed", "aborted"] as const;
export type DamiRunStatus = (typeof DAMI_RUN_STATUSES)[number];

export const REVIEW_SUBJECTS = [
  "script_version",
  "asset",
  "asset_detection",
  "asset_look",
  "asset_sheet",
  "asset_sheet_view",
  "prompt_block",
  "generation",
] as const;
export type ReviewSubject = (typeof REVIEW_SUBJECTS)[number];

export const REVIEW_DECISIONS = ["accepted", "rejected"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/** `abandoned`: a pending upload that was never confirmed and was swept (the row is kept). */
export const FILE_STATUSES = ["pending", "ready", "abandoned"] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

/* -------------------------------------------------------------------------- */
/* JSON shapes                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * What the user gave when no listed look or genre fitted ("Not what you have in mind?"): any mix
 * of film or show names, reference images (ids of `file` rows, purpose `style_reference`) and a
 * description. At least one of the three is present.
 */
export type StyleReference = {
  titles: string[];
  description?: string;
  fileIds: string[];
};

/** Output_01: the answers of the Style stage. Durations are in seconds. */
export type ProjectStyle = {
  visualStyle: string;
  genre: string;
  format: ProjectFormat;
  orientation: Orientation;
  /** Movie: the whole film. Series: the whole season. */
  totalDurationSeconds: number;
  /** Series only. */
  episodeDurationSeconds?: number;
  /** Anything else the Style stage collects (tone, audience, language, ...). */
  extras?: Record<string, string>;
  /**
   * References behind a look or genre the user described themselves. When present, the matching
   * `visualStyle` / `genre` string is the readable summary of it (see `@/lib/style-references`),
   * so everything that reads only the string keeps working. Older projects have none: their
   * typed "other" value is just the string.
   */
  references?: {
    visualStyle?: StyleReference;
    genre?: StyleReference;
  };
  /** The visual style as the first character design described it (its `style_used`). */
  styleDescriptor?: string;
  /** The one-line look the Enhancer wrote for the story. */
  lookLine?: string;
  /** When and where the story is set, as one line. */
  eraSetting?: string;
  /** Free art-direction notes that every designer should follow. */
  artDirectionNotes?: string;
  /** The intended audience rating (for example "PG-13"). */
  audienceRating?: string;
};

/**
 * One change a reviewer asked for, built from a review catalog option (see
 * `damis/shared/review-catalog.ts`): technical problems are fixes, preferences are taste.
 */
export type ReviewFixRequest = {
  type: "technical" | "preference";
  /** The catalog option's code. */
  code: string;
  /** The instruction for the dami, with the option's template already filled. */
  instruction: string;
  /** What the reviewer typed, when the option asks for text. */
  customText?: string;
  /** The assets (by name) the request is about. */
  targetNames?: string[];
  /** The view or frame of a sheet the request is about. */
  viewId?: string;
};

/**
 * A reference photo of a look, with the role the user picked for it (character: face, outfit,
 * full_body, other; location: hero, layout, mood, detail, other; prop: identity, material,
 * detail, mood, other) and what to keep from it.
 */
export type LookReference = { fileId: string; role: string; note?: string };

/** One field of a designer's specification card (locations and props). */
export type LookSpecField = {
  /** Identity, Spatial, Visual, Environment or Continuity (locations); absent for props. */
  group?: string;
  field: string;
  value: string;
  status: "confirmed" | "inferred" | "unknown";
  source: string;
  /** A wrong value would break identity, geometry, scale or function: reviewed before lock. */
  critical: boolean;
};

/** A question the prop designer asks; `blocking` ones stop the image until answered. */
export type LookClarifyingQuestion = {
  id: string;
  field: string;
  question: string;
  options: string[];
  default: string;
  blocking: boolean;
};

export const LOOK_GENERATORS = [
  "character-generator",
  "location-generator",
  "prop-generator",
] as const;
export type LookGenerator = (typeof LOOK_GENERATORS)[number];

/** Image ratios a look may take (characters and locations are 16:9; props follow their shape). */
export type LookAspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4";

/**
 * What a designer dami returned for a look, without the image prompt (stored in `prompt`): how
 * to generate the image, the specification the user reviews, and the dami's own answer (`output`,
 * in the owner's shape) that a fix round sends back as `previous_output`.
 */
export type LookSpec = {
  generator: LookGenerator;
  aspectRatio: LookAspectRatio;
  /** Files attached to the generation, in the order the prompt names them. */
  referenceFileIds: string[];
  /** Locations: `use_uploaded` (the user's photo is the Hero), `restyle_uploaded` or `generate`. */
  heroMode?: "generate" | "use_uploaded" | "restyle_uploaded";
  styleUsed: string;
  styleSource: string;
  /** Locations: the reusable one-line summary; characters: the environment shown. */
  summary: string;
  assumptions: string[];
  warnings: string[];
  appliedFixes: { code: string; change: string }[];
  /** Locations and props: the specification card. */
  fields: LookSpecField[];
  /** Props: the designer's questions (a blocking one sets the look to `needs_input`). */
  questions: LookClarifyingQuestion[];
  /** Props: a fix changed the object's identity (shape, materials, colours, states, scale). */
  changesIdentity?: boolean;
  /** The dami's whole answer minus the image prompt, as the dami wrote it. */
  output: Record<string, unknown>;
};

/** One of the six numbered detail frames of a character sheet. */
export type SheetDetailCell = { slot: number; subject: string; reason: string };

/** The data of a prop sheet's scale card (drawn by the backend, never by the image model). */
export type SheetScaleCard = {
  dimensionsCm: { height: number; width: number; depth: number } | null;
  dimensionsStatus: "confirmed" | "inferred" | "unknown";
  relativeReference: string;
  text: string;
};

/**
 * What a sheet maker returned for a sheet, without the image prompts. A character sheet is one
 * image (`prompt` on the sheet); a location pack or a prop sheet is a set of views
 * (`asset_sheet_view`) and the sheet's file is the contact sheet the backend assembles.
 */
export type SheetSpec = {
  maker: "sheet-generator-character" | "sheet-generator-location" | "sheet-generator-prop";
  /** Files attached to the sheet's generation, in the order the prompt names them (character). */
  referenceFileIds: string[];
  /** The reference roles in attachment order (`approved`, `previous_sheet`, `face` ...). */
  referenceOrder: { index: number; role: string }[];
  /** Character: `full`, or `edit_previous_sheet` when the previous sheet is edited. */
  editMode: "full" | "edit_previous_sheet";
  /** Character: the six numbered detail frames. */
  detailCells: SheetDetailCell[];
  styleUsed: string;
  assumptions: string[];
  warnings: string[];
  appliedFixes: { code: string; change: string; viewId?: string }[];
  /** Location and prop: the views in the order they are generated. */
  generationOrder: string[];
  /** Prop: simple, standard or production. */
  sheetLevel?: "simple" | "standard" | "production";
  /** Prop: the scale card. */
  scaleCard?: SheetScaleCard;
  /** The dami's whole answer minus the image prompts, as the dami wrote it. */
  output: Record<string, unknown>;
};

/** One reference image of a sheet view: where it comes from and its role in the prompt. */
export type SheetViewReference = {
  index: number;
  /** `approved_hero`, `approved_view:<view_id>`, `previous:<view_id>`, `user_reference:<n>`. */
  source: string;
  role: string;
};

/** A fact the Asset Detector read from the script, with its verbatim evidence. */
export type AssetFact = {
  field: string;
  value: string;
  status: "stated" | "implied" | "user";
  scene: string;
  evidence: string;
};

/** A look (characters) or state (locations, props) the script asks for, with its scenes. */
export type AssetVariant = {
  id: string;
  description: string;
  sceneRefs: string[];
  evidence: string;
};

/**
 * What the Asset Detector knows about an asset beyond its name and description (output_21).
 * Every reference to another asset is by its real name (the asset's id within its kind); the
 * detector's own ids never reach the database.
 */
export type AssetDetails = {
  /**
   * Characters: human, animal, creature, robot, background_group or voice_only (heard, never
   * seen; `needsVisual` is false, so no image is designed and the character is hidden in
   * Pre-production).
   */
  subkind?: string;
  role?: string;
  /** The detector's own priority, so an asset the user skipped can be included again. */
  detectedPriority?: "required" | "optional";
  aliases?: string[];
  nameLatin?: string;
  isMinor?: "yes" | "no" | "unknown";
  needsVisual?: boolean;
  /** The character this one is a different age or form of (name). */
  samePersonAs?: string | null;
  facts?: AssetFact[];
  looks?: AssetVariant[];
  states?: AssetVariant[];
  sceneRefs?: string[];
  firstScene?: string;
  uiSummary?: string;
  relationships?: { name: string; relation: string }[];
  signatureProps?: string[];
  speaks?: boolean;
  dialogueLineCount?: number;
  /** Characters (detector v2): what Production's voice box needs. Null language: never speaks. */
  dialogueLanguage?: string | null;
  voiceDelivery?: string[];
  voiceHints?: AssetFact[];
  /** Locations. */
  locationGroup?: string | null;
  interiorExterior?: "interior" | "exterior" | "int_ext";
  timeOfDay?: string;
  timesOfDay?: string[];
  fixedElements?: { element: string; scene: string; evidence: string }[];
  /** Props. */
  categoryHint?: string;
  subtype?: string | null;
  textOnObject?: { text: string; evidence: string }[];
  /** Character names who handle the prop. */
  users?: string[];
  /** Location names where the prop appears. */
  locationIds?: string[];
  /** Related assets as `kind:Name` refs. */
  relatedAssets?: string[];
  /**
   * Legacy `voice` rows only (detector v1; new detections never create them): the speaking
   * character's name, how and in what language it is heard.
   */
  owner?: string;
  delivery?: string[];
  language?: string;
  hints?: AssetFact[];
};

/** A comment anchored to a passage of the reviewed text. */
export type ReviewComment = {
  /** The quoted passage, so the comment survives small offset shifts. */
  quote: string;
  start: number;
  end: number;
  note: string;
};

/* -------------------------------------------------------------------------- */
/* Auth (better-auth core tables; property names are what better-auth expects) */
/* -------------------------------------------------------------------------- */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: text("role").$type<UserRole>().notNull().default("user"),
  disabled: boolean("disabled").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: ts("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/* -------------------------------------------------------------------------- */
/* Auth rate limiting (better-auth `rateLimit` model)                          */
/* -------------------------------------------------------------------------- */

/**
 * better-auth rate-limit counters (`rateLimit.storage: "database"`). Kept in Postgres so every
 * stateless web replica shares the same limits. Rows are pruned by better-auth itself.
 * `lastRequest` is a Unix timestamp in milliseconds.
 */
export const rateLimit = pgTable(
  "rate_limit",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull().unique(),
    count: integer("count").notNull(),
    lastRequest: bigint("last_request", { mode: "number" }).notNull(),
  },
  (t) => [index("rate_limit_last_request_idx").on(t.lastRequest)],
);

/**
 * Server-action rate-limit counters (`src/server/ratelimit`): one row per key (user and bucket)
 * and fixed window, incremented by one atomic upsert, so every web replica shares the count.
 * Operational counters, not domain data: old windows are deleted by the `ratelimit.prune` job.
 */
export const actionRateLimit = pgTable(
  "action_rate_limit",
  {
    key: text("key").notNull(),
    windowStart: ts("window_start").notNull(),
    count: integer("count").notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.windowStart] }),
    // Pruning deletes windows older than a cutoff.
    index("action_rate_limit_window_idx").on(t.windowStart),
  ],
);

/* -------------------------------------------------------------------------- */
/* Projects                                                                    */
/* -------------------------------------------------------------------------- */

export const project = pgTable(
  "project",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id),
    title: text("title").notNull(),
    /** `placeholder` until Claude names the project once or the user renames it; `user` is final. */
    titleSource: text("title_source").$type<TitleSource>().notNull().default("user"),
    mode: text("mode").$type<ProjectMode>().notNull().default("wizard"),
    /** Current stage key of the project's flow (a WizardStage for wizard projects). */
    stage: text("stage").notNull().default("style"),
    /** Per-stage progress of the flow state machine (shape owned by src/server/projects). */
    stageState: jsonb("stage_state")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Output_01. Null until the Style stage is completed. */
    style: jsonb("style").$type<ProjectStyle>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Soft delete: archived projects leave the dashboard but keep their data. */
    archivedAt: ts("archived_at"),
  },
  (t) => [index("project_owner_updated_idx").on(t.ownerId, t.updatedAt.desc())],
);

/** A movie has exactly one episode; a series has many. */
export const episode = pgTable(
  "episode",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id),
    number: integer("number").notNull(),
    title: text("title"),
    targetDurationSeconds: integer("target_duration_seconds"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("episode_project_number_unique").on(t.projectId, t.number)],
);

/** Append-only activity log: stage changes, acceptances, edits. */
export const projectEvent = pgTable(
  "project_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id),
    userId: text("user_id").references(() => user.id),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("project_event_project_created_idx").on(t.projectId, t.createdAt.desc()),
    // A project's events of one type (for example the last failed correction round).
    index("project_event_project_type_created_idx").on(t.projectId, t.type, t.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Files (bytes live in object storage; this is the record)                    */
/* -------------------------------------------------------------------------- */

export const file = pgTable(
  "file",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id),
    projectId: uuid("project_id").references(() => project.id),
    storageKey: text("storage_key").notNull().unique(),
    originalName: text("original_name"),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    /** pending until the direct upload is confirmed. */
    status: text("status").$type<FileStatus>().notNull().default("pending"),
    createdAt: createdAt(),
  },
  (t) => [
    index("file_project_idx").on(t.projectId),
    index("file_owner_idx").on(t.ownerId),
    // Cleanup scans (old pending or abandoned uploads).
    index("file_status_created_idx").on(t.status, t.createdAt),
    // One owner's recent pending uploads (the unfinished-upload limit).
    index("file_owner_status_created_idx").on(t.ownerId, t.status, t.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Dami runs (every Claude process execution; also the cost and latency record) */
/* -------------------------------------------------------------------------- */

export const damiRun = pgTable(
  "dami_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    damiKey: text("dami_key").notNull(),
    damiVersion: text("dami_version").notNull(),
    model: text("model").notNull(),
    status: text("status").$type<DamiRunStatus>().notNull().default("queued"),
    userId: text("user_id").references(() => user.id),
    projectId: uuid("project_id").references(() => project.id),
    input: jsonb("input").$type<unknown>().notNull(),
    output: jsonb("output").$type<unknown>(),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    createdAt: createdAt(),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
  },
  (t) => [
    index("dami_run_project_created_idx").on(t.projectId, t.createdAt.desc()),
    index("dami_run_user_created_idx").on(t.userId, t.createdAt.desc()),
    index("dami_run_key_version_idx").on(t.damiKey, t.damiVersion),
    index("dami_run_status_idx").on(t.status),
    // The stuck-run sweep: runs still `running` that started long ago.
    index("dami_run_status_started_idx").on(t.status, t.startedAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Script                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One immutable version of a script. `episodeId` is null for a project-level script
 * (the Wizard default); a per-episode script sets it.
 */
export const scriptVersion = pgTable(
  "script_version",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id),
    episodeId: uuid("episode_id").references(() => episode.id),
    versionNumber: integer("version_number").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => scriptVersion.id),
    source: text("source").$type<ScriptSource>().notNull(),
    status: text("status").$type<ScriptStatus>().notNull().default("pending"),
    /** The script text. Null while a dami is still writing it. */
    content: text("content"),
    /**
     * The Script Writer's structured screenplay (`StoredScreenplay`), when a dami wrote one;
     * `content` is then its rendered text. Null for uploaded, edited and enhanced versions.
     */
    screenplay: jsonb("screenplay").$type<unknown>(),
    /** The user's short description, when the script was generated from one. */
    brief: text("brief"),
    /** Notes from the script-checker or writer dami, shown to the user in review. */
    damiNotes: jsonb("dami_notes").$type<unknown>(),
    /** The uploaded source document, when uploaded. */
    fileId: uuid("file_id").references(() => file.id),
    /** The dami run that produced or checked this version. */
    damiRunId: uuid("dami_run_id").references(() => damiRun.id),
    createdBy: text("created_by").references(() => user.id),
    createdAt: createdAt(),
    decidedAt: ts("decided_at"),
  },
  (t) => [
    unique("script_version_number_unique")
      .on(t.projectId, t.episodeId, t.versionNumber)
      .nullsNotDistinct(),
    index("script_version_project_status_idx").on(t.projectId, t.status),
  ],
);

/* -------------------------------------------------------------------------- */
/* Creative Bible (DAMI-00 Creative DNA)                                       */
/* -------------------------------------------------------------------------- */

/**
 * pending: the Creative DNA dami is compiling it · ready: the bible is stored · failed: the run
 * failed · superseded: a newer row replaced it (the Style changed) or the Style no longer gets one.
 */
export const CREATIVE_BIBLE_STATUSES = ["pending", "ready", "failed", "superseded"] as const;
export type CreativeBibleStatus = (typeof CREATIVE_BIBLE_STATUSES)[number];

/**
 * One immutable version of a project's Creative Bible (output_10), compiled from the Style
 * stage's answers. A Style change adds a new row and marks the older ones `superseded`.
 */
export const creativeBible = pgTable(
  "creative_bible",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id),
    versionNumber: integer("version_number").notNull(),
    /** The registry modules it was compiled for (`genre.drama`, `style.noir`, ...). */
    genreId: text("genre_id").notNull(),
    styleId: text("style_id").notNull(),
    /** The Style answers it was compiled from. */
    styleSnapshot: jsonb("style_snapshot").$type<ProjectStyle>().notNull(),
    /** The Creative Bible (output_10, see `damis/creative-dna/schema.ts`). Null until ready. */
    bible: jsonb("bible").$type<unknown>(),
    status: text("status").$type<CreativeBibleStatus>().notNull().default("pending"),
    failure: text("failure"),
    damiRunId: uuid("dami_run_id").references(() => damiRun.id),
    createdAt: createdAt(),
    finishedAt: ts("finished_at"),
  },
  (t) => [
    unique("creative_bible_project_version_unique").on(t.projectId, t.versionNumber),
    index("creative_bible_project_created_idx").on(t.projectId, t.createdAt.desc()),
    index("creative_bible_project_status_idx").on(t.projectId, t.status),
  ],
);

/* -------------------------------------------------------------------------- */
/* Assets (Output_021). Looks and sheets are added in the pre-production work. */
/* -------------------------------------------------------------------------- */

export const asset = pgTable(
  "asset",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id),
    kind: text("kind").$type<AssetKind>().notNull(),
    /**
     * The asset's id within its project and kind: its real name, unique ignoring case ("Mara",
     * "Mara (2)"). Refs are `kind:Name` (see `damis/shared/asset-ref.ts`).
     */
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").$type<AssetStatus>().notNull().default("active"),
    origin: text("origin").$type<AssetOrigin>().notNull().default("detected"),
    displayOrder: integer("display_order").notNull().default(0),
    /** required / optional (the detector), skipped (the user). Older rows read as required. */
    priority: text("priority").$type<AssetPriority>().notNull().default("required"),
    /** The detector's structured knowledge of the asset (see `AssetDetails`). */
    details: jsonb("details").$type<AssetDetails>(),
    /** The script version in which the asset was first detected. */
    firstScriptVersionId: uuid("first_script_version_id").references(() => scriptVersion.id),
    /** The latest script version in which it was detected. */
    lastScriptVersionId: uuid("last_script_version_id").references(() => scriptVersion.id),
    damiRunId: uuid("dami_run_id").references(() => damiRun.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("asset_project_kind_name_unique").on(t.projectId, t.kind, sql`lower(${t.name})`),
    index("asset_project_kind_status_idx").on(t.projectId, t.kind, t.status),
    // A project's assets in display order, keyset-paginated by (display_order, id).
    index("asset_project_order_idx").on(t.projectId, t.displayOrder, t.id),
  ],
);

/**
 * One Asset Detector result as applied (append-only): the scene index and the diff in asset
 * names, and what the detector assumed or warned about. Modes: full (first detection),
 * incremental (an edited script, a re-scan) and fix (a correction round from a review).
 */
export const ASSET_DETECTION_MODES = ["full", "incremental", "fix"] as const;
export type AssetDetectionMode = (typeof ASSET_DETECTION_MODES)[number];

/** One scene of the detection's scene index, with assets by name. */
export type DetectionSceneIndexEntry = {
  sceneNumber: string;
  heading: string;
  anchor: string | null;
  location: string | null;
  locationState: string | null;
  timeOfDay: string;
  characters: string[];
  characterLooks: { character: string; look: string }[];
  /** Characters heard but not seen in the scene (detector v2). */
  heardOnly?: string[];
  /** Characters who speak in the scene, seen or not (detector v2). */
  speakers?: string[];
  /** Legacy (detector v1): the voices heard; rows written before v2 have this and no `heardOnly`. */
  voices?: string[];
  props: string[];
};

/** The diff as `kind:Name` refs. */
export type DetectionDiff = { added: string[]; updated: string[]; removed: string[] };

export const assetDetection = pgTable(
  "asset_detection",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id),
    scriptVersionId: uuid("script_version_id")
      .notNull()
      .references(() => scriptVersion.id),
    damiRunId: uuid("dami_run_id").references(() => damiRun.id),
    mode: text("mode").$type<AssetDetectionMode>().notNull(),
    sceneIndex: jsonb("scene_index")
      .$type<DetectionSceneIndexEntry[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    diff: jsonb("diff")
      .$type<DetectionDiff>()
      .notNull()
      .default(sql`'{"added":[],"updated":[],"removed":[]}'::jsonb`),
    assumptions: jsonb("assumptions")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    warnings: jsonb("warnings")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    index("asset_detection_project_created_idx").on(t.projectId, t.createdAt.desc()),
    index("asset_detection_script_version_idx").on(t.scriptVersionId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Prompt blocks (Output_022)                                                  */
/* -------------------------------------------------------------------------- */

/** none: not prepared · pending: the dami is running · ready: prepared · failed: see the failure. */
export const PRODUCTION_STATES = ["none", "pending", "ready", "failed"] as const;
export type ProductionState = (typeof PRODUCTION_STATES)[number];

/**
 * One version of one block. `lineageId` is the block's identity across versions: a block that
 * survives a script edit keeps its lineage and gets a new row with the next `versionNumber`.
 * The current set of blocks is the rows with `supersededAt` null.
 */
export const promptBlock = pgTable(
  "prompt_block",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lineageId: uuid("lineage_id").notNull().defaultRandom(),
    versionNumber: integer("version_number").notNull().default(1),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id),
    episodeId: uuid("episode_id").references(() => episode.id),
    scriptVersionId: uuid("script_version_id")
      .notNull()
      .references(() => scriptVersion.id),
    orderIndex: integer("order_index").notNull(),
    title: text("title"),
    /** The section of the script this block covers. */
    scriptExcerpt: text("script_excerpt").notNull(),
    prompt: text("prompt").notNull(),
    durationSeconds: integer("duration_seconds"),
    /** The assets that appear in this block, as `kind:Name` refs. */
    assetRefs: jsonb("asset_refs")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** True when the script changed under this block and it must be regenerated. */
    stale: boolean("stale").notNull().default(false),
    staleReason: text("stale_reason"),
    /**
     * Production preparation (text-blocks dami), filled once per block version: the prompt with
     * its asset mentions bound to reference tokens, and the assets in token order (`kind:Name`).
     * A user change to the prompt or the assets creates the next version of the block.
     */
    productionState: text("production_state").$type<ProductionState>().notNull().default("none"),
    productionPrompt: text("production_prompt"),
    productionAssetRefs: jsonb("production_asset_refs").$type<string[]>(),
    productionNotes: jsonb("production_notes").$type<string[]>(),
    productionDamiRunId: uuid("production_dami_run_id").references(() => damiRun.id),
    productionFailure: text("production_failure"),
    /** Set when the user approves the prepared block for generation. */
    approvedAt: ts("approved_at"),
    damiRunId: uuid("dami_run_id").references(() => damiRun.id),
    createdAt: createdAt(),
    supersededAt: ts("superseded_at"),
  },
  (t) => [
    uniqueIndex("prompt_block_lineage_version_unique").on(t.lineageId, t.versionNumber),
    index("prompt_block_project_order_idx").on(t.projectId, t.episodeId, t.orderIndex),
    index("prompt_block_script_version_idx").on(t.scriptVersionId),
    // The current blocks of a project in film order (keyset pagination by order, then id).
    index("prompt_block_project_current_order_idx")
      .on(t.projectId, t.orderIndex, t.id)
      .where(sql`${t.supersededAt} is null`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Reviews (every accept / reject, with its reason)                            */
/* -------------------------------------------------------------------------- */

export const review = pgTable(
  "review",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    subjectType: text("subject_type").$type<ReviewSubject>().notNull(),
    subjectId: uuid("subject_id").notNull(),
    decision: text("decision").$type<ReviewDecision>().notNull(),
    /** Codes of the predefined issues the user picked (empty when accepted). */
    issueCodes: jsonb("issue_codes")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** The changes asked for, from the review catalog (empty when accepted or for older reviews). */
    fixRequests: jsonb("fix_requests")
      .$type<ReviewFixRequest[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** The user's free-text reason. */
    note: text("note"),
    /** Comments anchored to passages (script review). */
    comments: jsonb("comments")
      .$type<ReviewComment[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** The dami run that produced the reviewed output; ties the reason to a dami version. */
    damiRunId: uuid("dami_run_id").references(() => damiRun.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("review_subject_idx").on(t.subjectType, t.subjectId),
    index("review_project_created_idx").on(t.projectId, t.createdAt.desc()),
  ],
);

/* -------------------------------------------------------------------------- */
/* Generation engine: provider jobs and credits (see docs/M2_M3_CONTRACTS.md)  */
/* -------------------------------------------------------------------------- */

export const GENERATION_KINDS = ["image", "video"] as const;
export type GenerationKind = (typeof GENERATION_KINDS)[number];

export const GENERATION_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

/** What a generation is for; decides the model through the server-side policy. */
export const GENERATION_PURPOSES = [
  "asset_look",
  "asset_sheet",
  "block_draft",
  "block_final",
] as const;
export type GenerationPurpose = (typeof GENERATION_PURPOSES)[number];

/**
 * One job sent to a generation provider. The model and parameters the platform chose are stored
 * explicitly (Pro will expose them). Credits are reserved when the row is created and settled or
 * refunded when it finishes.
 */
export const generation = pgTable(
  "generation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id),
    kind: text("kind").$type<GenerationKind>().notNull(),
    purpose: text("purpose").$type<GenerationPurpose>().notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    params: jsonb("params")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    prompt: text("prompt").notNull(),
    /** Files sent as references, in attachment order. */
    referenceFileIds: jsonb("reference_file_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    status: text("status").$type<GenerationStatus>().notNull().default("queued"),
    providerJobId: text("provider_job_id"),
    resultFileId: uuid("result_file_id").references(() => file.id),
    /** Credits reserved for this job (the quoted price). */
    priceCredits: integer("price_credits").notNull(),
    /** User-readable reason when failed. */
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    /**
     * When a run took the right to create the provider job (a lease): set before `create` is
     * called, outside any transaction, so a concurrent run waits instead of creating a second
     * provider job. Expires after a while, so a crashed run does not block the generation.
     */
    providerClaimedAt: ts("provider_claimed_at"),
    createdAt: createdAt(),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    /**
     * When the completion hooks last ran to the end for this finished generation. Null on a
     * finished generation means its look, sheet, view or take may not know yet: the sweep calls
     * the hooks again.
     */
    notifiedAt: ts("notified_at"),
  },
  (t) => [
    index("generation_project_created_idx").on(t.projectId, t.createdAt.desc()),
    index("generation_user_status_idx").on(t.userId, t.status),
    index("generation_status_idx").on(t.status),
    // The sweep's "finished but the hooks never completed" scan.
    index("generation_unnotified_idx")
      .on(t.finishedAt)
      .where(sql`${t.notifiedAt} is null and ${t.finishedAt} is not null`),
    check("generation_price_credits_nonnegative", sql`${t.priceCredits} >= 0`),
  ],
);

export const CREDIT_ENTRY_TYPES = ["grant", "reserve", "settle", "refund"] as const;
export type CreditEntryType = (typeof CREDIT_ENTRY_TYPES)[number];

/**
 * Append-only credit ledger. `amount` is signed: grant and refund are positive, reserve is
 * negative, settle is zero (it marks a reservation as spent). The balance is the sum.
 */
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    type: text("type").$type<CreditEntryType>().notNull(),
    amount: integer("amount").notNull(),
    generationId: uuid("generation_id").references(() => generation.id),
    note: text("note"),
    createdBy: text("created_by").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("credit_ledger_user_created_idx").on(t.userId, t.createdAt.desc()),
    // A generation is reserved, settled and refunded at most once each.
    uniqueIndex("credit_ledger_generation_type_unique").on(t.generationId, t.type),
    // ... and a reservation is closed once: settled or refunded, never both.
    uniqueIndex("credit_ledger_generation_closed_unique")
      .on(t.generationId)
      .where(sql`${t.type} in ('settle', 'refund')`),
  ],
);

/** Current balance per user, updated in the same transaction as every ledger entry (row-locked). */
export const creditBalance = pgTable(
  "credit_balance",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id),
    balance: integer("balance").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [check("credit_balance_nonnegative", sql`${t.balance} >= 0`)],
);

/* -------------------------------------------------------------------------- */
/* Pre-production: looks and sheets of an asset                                */
/* -------------------------------------------------------------------------- */

export const LOOK_SOURCES = ["uploaded", "generated"] as const;
export type LookSource = (typeof LOOK_SOURCES)[number];

/**
 * pending: a dami or the provider is still working · in_review: waiting for the user ·
 * accepted / rejected: the user decided · superseded: an older accepted one was replaced ·
 * failed: could not be produced (see `failure`). Shared by looks, sheets and takes.
 */
export const LOOK_STATUSES = [
  "pending",
  "in_review",
  "accepted",
  "rejected",
  "superseded",
  "failed",
] as const;
export type LookStatus = (typeof LOOK_STATUSES)[number];

/**
 * The statuses of a look: `LOOK_STATUSES` plus needs_input, when the designer asked a question it
 * cannot design without (the answer starts a new version and this one is superseded).
 */
export const ASSET_LOOK_STATUSES = [...LOOK_STATUSES, "needs_input"] as const;
export type AssetLookStatus = (typeof ASSET_LOOK_STATUSES)[number];

/** One candidate image (or voice recording) of an asset. Immutable once decided. */
export const assetLook = pgTable(
  "asset_look",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => asset.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id),
    versionNumber: integer("version_number").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => assetLook.id),
    source: text("source").$type<LookSource>().notNull(),
    status: text("status").$type<AssetLookStatus>().notNull().default("pending"),
    fileId: uuid("file_id").references(() => file.id),
    /** The prompt the user wrote, when they wrote one. */
    userPrompt: text("user_prompt"),
    /** Answers to the guided questions, keyed by question id. */
    guidedAnswers: jsonb("guided_answers").$type<Record<string, string>>(),
    /** The prompt actually sent to the provider (written by a dami). */
    prompt: text("prompt"),
    /** What the designer dami returned besides the prompt (see `LookSpec`). */
    spec: jsonb("spec").$type<LookSpec>(),
    /** The user's reference photos with their roles, in the order given. */
    references: jsonb("references")
      .$type<LookReference[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Answers to the designer's clarifying questions, keyed by question id. */
    clarifyAnswers: jsonb("clarify_answers").$type<Record<string, string>>(),
    generationId: uuid("generation_id").references(() => generation.id),
    damiRunId: uuid("dami_run_id").references(() => damiRun.id),
    failure: text("failure"),
    createdBy: text("created_by").references(() => user.id),
    createdAt: createdAt(),
    decidedAt: ts("decided_at"),
  },
  (t) => [
    uniqueIndex("asset_look_asset_version_unique").on(t.assetId, t.versionNumber),
    index("asset_look_project_status_idx").on(t.projectId, t.status),
  ],
);

/** The sheet built from an accepted look (character sheet, prop sheet, location sheet). */
export const assetSheet = pgTable(
  "asset_sheet",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => asset.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id),
    lookId: uuid("look_id")
      .notNull()
      .references(() => assetLook.id),
    versionNumber: integer("version_number").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => assetSheet.id),
    status: text("status").$type<LookStatus>().notNull().default("pending"),
    fileId: uuid("file_id").references(() => file.id),
    prompt: text("prompt"),
    /** What the sheet maker returned besides the prompt (see `SheetSpec`). */
    spec: jsonb("spec").$type<SheetSpec>(),
    generationId: uuid("generation_id").references(() => generation.id),
    damiRunId: uuid("dami_run_id").references(() => damiRun.id),
    failure: text("failure"),
    createdAt: createdAt(),
    decidedAt: ts("decided_at"),
  },
  (t) => [
    uniqueIndex("asset_sheet_asset_version_unique").on(t.assetId, t.versionNumber),
    index("asset_sheet_project_status_idx").on(t.projectId, t.status),
  ],
);

/**
 * planned: written, waiting for its dependencies (or its prompt, in a fix round) · then the look
 * statuses: pending (generating), in_review, accepted, rejected, superseded, failed.
 */
export const SHEET_VIEW_STATUSES = ["planned", ...LOOK_STATUSES] as const;
export type SheetViewStatus = (typeof SHEET_VIEW_STATUSES)[number];

/**
 * One view of a location pack or a prop sheet (reverse wide, corner A, front, detail 1 ...), each
 * a separate image generated in dependency order with approved views as references and reviewed on
 * its own. Append-only: a fix or a re-roll is a new version of the same `viewId`.
 */
export const assetSheetView = pgTable(
  "asset_sheet_view",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sheetId: uuid("sheet_id")
      .notNull()
      .references(() => assetSheet.id),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => asset.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id),
    /** The dami's view id (`reverse_wide`, `detail_1`, `state_open` ...). */
    viewId: text("view_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => assetSheetView.id),
    label: text("label").notNull(),
    /** Its place in the generation order (also the display order). */
    position: integer("position").notNull(),
    status: text("status").$type<SheetViewStatus>().notNull().default("planned"),
    /** What the view is for (props). */
    purpose: text("purpose"),
    /** Null while a fix round re-writes it. */
    prompt: text("prompt"),
    aspectRatio: text("aspect_ratio").$type<LookAspectRatio>().notNull().default("16:9"),
    referenceOrder: jsonb("reference_order")
      .$type<SheetViewReference[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    dependsOn: jsonb("depends_on")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** The reviewer's checklist: what must be visible (and where). */
    mustShow: jsonb("must_show")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    mustNotShow: jsonb("must_not_show")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    reviewFocus: jsonb("review_focus")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Parts this view shows that the spec does not define: proposed, approved by the reviewer. */
    newHypotheses: jsonb("new_hypotheses")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    editMode: text("edit_mode").$type<"full" | "edit_previous_view">().notNull().default("full"),
    /** The dami's warnings about this view (a `DESIGN_CHANGE_REQUESTED:` it refused). */
    warnings: jsonb("warnings")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    generationId: uuid("generation_id").references(() => generation.id),
    fileId: uuid("file_id").references(() => file.id),
    damiRunId: uuid("dami_run_id").references(() => damiRun.id),
    failure: text("failure"),
    createdAt: createdAt(),
    decidedAt: ts("decided_at"),
  },
  (t) => [
    uniqueIndex("asset_sheet_view_version_unique").on(t.sheetId, t.viewId, t.versionNumber),
    index("asset_sheet_view_sheet_idx").on(t.sheetId),
    index("asset_sheet_view_project_status_idx").on(t.projectId, t.status),
  ],
);

/* -------------------------------------------------------------------------- */
/* Production: takes of a block and export bundles (see docs/M4_CONTRACTS.md)  */
/* -------------------------------------------------------------------------- */

export const TAKE_STAGES = ["draft", "final"] as const;
export type TakeStage = (typeof TAKE_STAGES)[number];

/**
 * One generated clip of a block. A draft is the cheap low-resolution render; a final finishes an
 * accepted draft at full quality (`draftTakeId`). Statuses are those of looks and sheets.
 */
export const blockTake = pgTable(
  "block_take",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id),
    /** The block version this take was generated from. */
    blockId: uuid("block_id")
      .notNull()
      .references(() => promptBlock.id),
    /** The block's identity across versions; takes are numbered per lineage. */
    lineageId: uuid("lineage_id").notNull(),
    takeNumber: integer("take_number").notNull(),
    stage: text("stage").$type<TakeStage>().notNull(),
    status: text("status").$type<LookStatus>().notNull().default("pending"),
    parentId: uuid("parent_id").references((): AnyPgColumn => blockTake.id),
    /** For a final: the accepted draft it finishes. */
    draftTakeId: uuid("draft_take_id").references((): AnyPgColumn => blockTake.id),
    /** The prompt actually sent, with reference tokens. */
    prompt: text("prompt"),
    /** Files attached as references, in token order. */
    referenceFileIds: jsonb("reference_file_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    generationId: uuid("generation_id").references(() => generation.id),
    fileId: uuid("file_id").references(() => file.id),
    posterFileId: uuid("poster_file_id").references(() => file.id),
    damiRunId: uuid("dami_run_id").references(() => damiRun.id),
    failure: text("failure"),
    createdAt: createdAt(),
    decidedAt: ts("decided_at"),
  },
  (t) => [
    uniqueIndex("block_take_lineage_number_unique").on(t.lineageId, t.takeNumber),
    index("block_take_project_status_idx").on(t.projectId, t.status),
    index("block_take_block_idx").on(t.blockId),
    // A block's takes, newest first (per project).
    index("block_take_project_lineage_number_idx").on(
      t.projectId,
      t.lineageId,
      t.takeNumber.desc(),
    ),
  ],
);

export const EXPORT_STATUSES = ["pending", "ready", "failed"] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

/** A ZIP of a project's accepted final clips, built by a worker. */
export const exportBundle = pgTable(
  "export_bundle",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    status: text("status").$type<ExportStatus>().notNull().default("pending"),
    fileId: uuid("file_id").references(() => file.id),
    clipCount: integer("clip_count").notNull().default(0),
    /** Identifies the set of clips, so an unchanged film reuses its last bundle. */
    contentKey: text("content_key").notNull(),
    failure: text("failure"),
    createdAt: createdAt(),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("export_bundle_project_created_idx").on(t.projectId, t.createdAt.desc())],
);
