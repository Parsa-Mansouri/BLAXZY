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
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
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

/** Wizard stages, in order. Pro may use other stage keys; the column is free text. */
export const WIZARD_STAGES = ["style", "script", "pre_production", "production", "done"] as const;
export type WizardStage = (typeof WIZARD_STAGES)[number];

export const PROJECT_FORMATS = ["movie", "series"] as const;
export type ProjectFormat = (typeof PROJECT_FORMATS)[number];

export const ORIENTATIONS = ["landscape", "portrait"] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

export const SCRIPT_SOURCES = ["uploaded", "generated", "revised", "edited"] as const;
export type ScriptSource = (typeof SCRIPT_SOURCES)[number];

/**
 * pending: a dami is still producing/checking it · in_review: waiting for the user ·
 * accepted / rejected: the user's decision · superseded: an older accepted version replaced
 * by a newer accepted one · failed: the dami run failed.
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

export const ASSET_ORIGINS = ["detected", "manual"] as const;
export type AssetOrigin = (typeof ASSET_ORIGINS)[number];

export const DAMI_RUN_STATUSES = ["queued", "running", "succeeded", "failed"] as const;
export type DamiRunStatus = (typeof DAMI_RUN_STATUSES)[number];

export const REVIEW_SUBJECTS = [
  "script_version",
  "asset",
  "asset_look",
  "asset_sheet",
  "prompt_block",
  "generation",
] as const;
export type ReviewSubject = (typeof REVIEW_SUBJECTS)[number];

export const REVIEW_DECISIONS = ["accepted", "rejected"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const FILE_STATUSES = ["pending", "ready"] as const;
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
  (t) => [index("project_event_project_created_idx").on(t.projectId, t.createdAt.desc())],
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
  (t) => [index("file_project_idx").on(t.projectId), index("file_owner_idx").on(t.ownerId)],
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
    name: text("name").notNull(),
    /** Stable, lower-case key within the project and kind; used to match across script versions. */
    slug: text("slug").notNull(),
    description: text("description"),
    status: text("status").$type<AssetStatus>().notNull().default("active"),
    origin: text("origin").$type<AssetOrigin>().notNull().default("detected"),
    displayOrder: integer("display_order").notNull().default(0),
    /** The script version in which the asset was first detected. */
    firstScriptVersionId: uuid("first_script_version_id").references(() => scriptVersion.id),
    /** The latest script version in which it was detected. */
    lastScriptVersionId: uuid("last_script_version_id").references(() => scriptVersion.id),
    damiRunId: uuid("dami_run_id").references(() => damiRun.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("asset_project_kind_slug_unique").on(t.projectId, t.kind, t.slug),
    index("asset_project_kind_status_idx").on(t.projectId, t.kind, t.status),
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
    /** Slugs of the assets that appear in this block, as `kind:slug`. */
    assetRefs: jsonb("asset_refs")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** True when the script changed under this block and it must be regenerated. */
    stale: boolean("stale").notNull().default(false),
    staleReason: text("stale_reason"),
    /**
     * Production preparation (text-blocks dami), filled once per block version: the prompt with
     * its asset mentions bound to reference tokens, and the assets in token order (`kind:slug`).
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
    createdAt: createdAt(),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
  },
  (t) => [
    index("generation_project_created_idx").on(t.projectId, t.createdAt.desc()),
    index("generation_user_status_idx").on(t.userId, t.status),
    index("generation_status_idx").on(t.status),
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
  ],
);

/** Current balance per user, updated in the same transaction as every ledger entry (row-locked). */
export const creditBalance = pgTable("credit_balance", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id),
  balance: integer("balance").notNull().default(0),
  updatedAt: updatedAt(),
});

/* -------------------------------------------------------------------------- */
/* Pre-production: looks and sheets of an asset                                */
/* -------------------------------------------------------------------------- */

export const LOOK_SOURCES = ["uploaded", "generated"] as const;
export type LookSource = (typeof LOOK_SOURCES)[number];

/**
 * pending: a dami or the provider is still working · in_review: waiting for the user ·
 * accepted / rejected: the user decided · superseded: an older accepted one was replaced ·
 * failed: could not be produced (see `failure`).
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
    status: text("status").$type<LookStatus>().notNull().default("pending"),
    fileId: uuid("file_id").references(() => file.id),
    /** The prompt the user wrote, when they wrote one. */
    userPrompt: text("user_prompt"),
    /** Answers to the guided questions, keyed by question id. */
    guidedAnswers: jsonb("guided_answers").$type<Record<string, string>>(),
    /** The prompt actually sent to the provider (written by a dami). */
    prompt: text("prompt"),
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
