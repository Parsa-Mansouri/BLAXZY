/**
 * The owner's review catalogs, loaded from each dami's `review-catalog.json` and normalized to one
 * `ReviewCatalog` shape. The JSON files come in four shapes (the asset detector's; the Farsi-label
 * character and character-sheet catalogs; and the flat `items` catalogs of locations, props and
 * their sheets); each has a Zod schema here. Farsi-only catalogs take their English labels from a
 * `labels.en.ts` next to the JSON.
 *
 * `visibleOptions` filters a catalog for a screen; `buildFixRequests` turns a user's picks into
 * the `fix_requests` a dami receives (and that `review.fix_requests` stores).
 */
import { z } from "zod";
import assetDetectorJson from "../asset-detector/review-catalog.json";
import { CHARACTER_REVIEW_LABELS_EN } from "../character-generator/labels.en";
import characterJson from "../character-generator/review-catalog.json";
import locationJson from "../location-generator/review-catalog.json";
import propJson from "../prop-generator/review-catalog.json";
import { CHARACTER_SHEET_EDIT_CODES } from "../sheet-generator-character/edit-eligible";
import { CHARACTER_SHEET_REVIEW_LABELS_EN } from "../sheet-generator-character/labels.en";
import characterSheetJson from "../sheet-generator-character/review-catalog.json";
import locationSheetJson from "../sheet-generator-location/review-catalog.json";
import propSheetJson from "../sheet-generator-prop/review-catalog.json";
import type {
  CatalogLabelsEn,
  FixRequest,
  FollowupChoice,
  FollowupStep,
  ReviewCatalog,
  ReviewCatalogKey,
  ReviewCondition,
  ReviewFollowup,
  ReviewGroup,
  ReviewOption,
} from "./review-catalog-types";

export * from "./review-catalog-types";

/** Thrown for a catalog that does not parse, or picks that do not fit the catalog. */
export class ReviewCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewCatalogError";
  }
}

/** The follow-up value that lets the dami choose (uses `instructionTemplateAuto`). */
export const AUTO_VALUE = "__auto__";

const text = z.string().trim().min(1);
const rules = z.record(z.string(), z.unknown());

/* ------------------------------------------------------------------------------------------ */
/* Shape 1: the asset detector                                                                 */
/* ------------------------------------------------------------------------------------------ */

const detectorReasonSchema = z.object({
  code: text,
  type: z.enum(["technical", "preference"]),
  label: text,
  label_fa: z.string().optional(),
  handler: z.enum(["dami", "backend"]),
  target_count: z.number().int().min(0),
  needs_custom_text: z.boolean(),
  instruction: text,
  wizard_visible: z.boolean(),
  pro_visible: z.boolean(),
  ui_note: z.string().optional(),
});

const detectorCatalogSchema = z.object({
  schema_version: text,
  dami: text,
  meta: z.object({
    where: z.string().optional(),
    flow: z.string(),
    max_rounds_before_suggestion: z.number().int().min(1),
    suggestion_after_max_rounds: text,
  }),
  rules,
  technical: z.array(detectorReasonSchema),
  preference: z.array(detectorReasonSchema),
  actions: z.array(
    z.object({
      code: text,
      label: text,
      label_fa: z.string().optional(),
      handler: z.enum(["dami", "backend"]),
      mode: text,
      wizard_visible: z.boolean(),
      pro_visible: z.boolean(),
      instruction: text,
    }),
  ),
  backend_operations: z.array(
    z.object({
      code: text,
      label: text,
      label_fa: z.string().optional(),
      pro_only: z.boolean(),
      effect: text,
    }),
  ),
});

/** "Chips instead of text: character, location, prop." (ADT04): the chip value is the custom text. */
const DETECTOR_CATEGORY_CHIPS: FollowupChoice[] = ["character", "location", "prop"].map((v) => ({
  label: v.charAt(0).toUpperCase() + v.slice(1),
  value: v,
}));

function normalizeDetector(raw: unknown): Omit<ReviewCatalog, "key"> {
  const c = parseShape(detectorCatalogSchema, raw, "asset-detector");
  const reason = (r: z.output<typeof detectorReasonSchema>): ReviewOption => ({
    code: r.code,
    kind: r.type,
    label: r.label,
    ...(r.label_fa ? { labelFa: r.label_fa } : {}),
    instruction: r.instruction,
    ...(/chips instead of text/i.test(r.ui_note ?? "")
      ? {
          followup: {
            type: "chips",
            options: DETECTOR_CATEGORY_CHIPS,
            allowCustom: false,
          },
        }
      : {}),
    needsText: r.needs_custom_text && !/text box optional/i.test(r.ui_note ?? ""),
    proOnly: !r.wizard_visible,
    callsClaude: r.handler === "dami",
    editEligible: false,
    targetCount: r.target_count,
    ...(r.handler === "backend" ? { action: "backend" } : {}),
    ...(r.ui_note ? { note: r.ui_note } : {}),
  });
  return {
    dami: c.dami,
    version: c.schema_version,
    flow: c.meta.flow,
    maxAttemptsBeforeSuggestion: c.meta.max_rounds_before_suggestion,
    attemptMessage: { en: c.meta.suggestion_after_max_rounds },
    groups: [],
    rules: c.rules,
    options: [
      ...c.technical.map(reason),
      ...c.preference.map(reason),
      ...c.actions.map((a): ReviewOption => ({
        code: a.code,
        kind: "regenerate",
        label: a.label,
        ...(a.label_fa ? { labelFa: a.label_fa } : {}),
        instruction: a.instruction,
        needsText: false,
        proOnly: !a.wizard_visible,
        callsClaude: a.handler === "dami",
        editEligible: false,
        action: `rescan_${a.mode}`,
      })),
      ...c.backend_operations.map((b): ReviewOption => ({
        code: b.code,
        kind: "backend",
        label: b.label,
        ...(b.label_fa ? { labelFa: b.label_fa } : {}),
        needsText: false,
        proOnly: b.pro_only,
        callsClaude: false,
        editEligible: false,
        action: b.effect,
      })),
    ],
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Shape 2: Farsi-label catalogs (character generator v2, character sheet v3)                  */
/* ------------------------------------------------------------------------------------------ */

const faChoiceSchema = z.object({ label_fa: text, value: text });

const faStepSchema = z.object({
  type: text,
  label_fa: z.string().optional(),
  allow_custom: z.boolean().optional(),
  options: z.array(faChoiceSchema).optional(),
  dynamic_options_source: z.string().optional(),
  display: z.string().optional(),
});

const faFollowupSchema = z.object({
  type: text,
  allow_custom: z.boolean().optional(),
  options: z.array(faChoiceSchema).optional(),
  dynamic_options_source: z.string().optional(),
  steps: z.array(faStepSchema).optional(),
});

const faCatalogSchema = z.object({
  schema_version: text,
  dami: text,
  meta: z.object({
    flow: z.array(z.string()),
    max_attempts_before_suggestion: z.number().int().min(1),
    attempt_limit_message_fa: text,
  }),
  special_actions: z.array(
    z.object({
      code: text,
      label_fa: text,
      calls_dami: z.boolean(),
      action: text,
      suggest_first_for: z.array(text).optional(),
      note: z.string().optional(),
    }),
  ),
  groups: z.array(z.object({ id: text, label_fa: text })).optional(),
  technical: z.array(
    z.object({
      code: text,
      group: z.string().optional(),
      label_fa: text,
      instruction: text,
      available_when: z.string().optional(),
      hide_when: z.string().optional(),
      suggest_first: z.string().optional(),
      note: z.string().optional(),
    }),
  ),
  preference: z.array(
    z.object({
      code: text,
      group: z.string().optional(),
      label_fa: text,
      conflicts_with_reference: z.string().optional(),
      available_in: z.array(z.enum(["wizard", "pro"])).optional(),
      followup: faFollowupSchema,
      instruction_template: text,
      instruction_template_auto: z.string().optional(),
      note: z.string().optional(),
    }),
  ),
  design_change_routing: z.object({ description: text, message_fa: text }).optional(),
  rules,
});

/** "face_reference" → shown when `context.face_reference` is true. */
function parseAvailableWhen(when: string): ReviewCondition {
  return { key: when.trim(), value: true };
}

/** "render_cell_numbers is false" → hidden when `context.render_cell_numbers` is false. */
function parseHideWhen(when: string): ReviewCondition {
  const match = /^\s*([a-z0-9_]+)\s+is\s+(true|false)\s*$/i.exec(when);
  if (!match) throw new ReviewCatalogError(`Unsupported hide_when condition "${when}"`);
  return { key: match[1] ?? "", value: (match[2] ?? "").toLowerCase() === "true" };
}

/** T11 and T12 are shown only when the matching reference role exists (catalog rule). */
const REFERENCE_CONDITIONS: Record<string, string> = { T11: "outfit_reference" };

function englishLabel(labels: CatalogLabelsEn, code: string, catalog: string): string {
  const label = labels.options[code];
  if (!label) throw new ReviewCatalogError(`${catalog}: no English label for ${code}`);
  return label;
}

function faChoices(
  options: readonly z.output<typeof faChoiceSchema>[],
  labels: Record<string, string> | undefined,
  where: string,
): FollowupChoice[] {
  return options.map((o) => {
    const label = labels?.[o.value];
    if (!label) throw new ReviewCatalogError(`${where}: no English label for chip "${o.value}"`);
    return { label, labelFa: o.label_fa, value: o.value };
  });
}

function normalizeFaFollowup(
  f: z.output<typeof faFollowupSchema>,
  code: string,
  labels: CatalogLabelsEn,
  catalog: string,
): ReviewFollowup {
  const where = `${catalog} ${code}`;
  const chips = labels.followupOptions?.[code];
  const steps: FollowupStep[] | undefined = f.steps?.map((s, i) => {
    const stepLabel = labels.followupSteps?.[code]?.[i];
    return {
      type: s.type,
      ...(stepLabel ? { label: stepLabel } : {}),
      ...(s.label_fa ? { labelFa: s.label_fa } : {}),
      allowCustom: s.allow_custom ?? false,
      options: faChoices(s.options ?? [], chips, where),
      ...(s.dynamic_options_source ? { dynamicOptionsSource: s.dynamic_options_source } : {}),
      ...(s.display ? { display: s.display } : {}),
    };
  });
  return {
    type: f.type,
    options: faChoices(f.options ?? [], chips, where),
    allowCustom: f.allow_custom ?? steps?.some((s) => s.allowCustom) ?? false,
    ...(f.dynamic_options_source ? { dynamicOptionsSource: f.dynamic_options_source } : {}),
    ...(steps ? { steps } : {}),
  };
}

function normalizeFaCatalog(
  raw: unknown,
  key: ReviewCatalogKey,
  labels: CatalogLabelsEn,
  /** Codes whose fix may edit the previous image (the catalog states this in prose rules). */
  editEligible: readonly string[] = [],
): Omit<ReviewCatalog, "key"> {
  const c = parseShape(faCatalogSchema, raw, key);
  const suggestFirst = new Map<string, string>();
  for (const a of c.special_actions) {
    for (const code of a.suggest_first_for ?? []) suggestFirst.set(code, a.code);
  }
  const groups: ReviewGroup[] = (c.groups ?? []).map((g) => {
    const label = labels.groups?.[g.id];
    if (!label) throw new ReviewCatalogError(`${key}: no English label for group ${g.id}`);
    return { id: g.id, label, labelFa: g.label_fa };
  });
  const attemptEn = labels.messages?.attemptLimit;
  if (!attemptEn) throw new ReviewCatalogError(`${key}: no English attempt-limit message`);
  const extraRules: Record<string, unknown> = {};
  if (c.design_change_routing) {
    extraRules.design_change_routing = {
      ...c.design_change_routing,
      message_en: labels.messages?.designChange,
    };
  }
  if (labels.messages?.referenceConflict) {
    extraRules.reference_conflict_en = {
      message: labels.messages.referenceConflict,
      choices: labels.referenceConflictChoices ?? [],
    };
  }
  return {
    dami: c.dami,
    version: c.schema_version,
    flow: c.meta.flow.join(" → "),
    maxAttemptsBeforeSuggestion: c.meta.max_attempts_before_suggestion,
    attemptMessage: { en: attemptEn, fa: c.meta.attempt_limit_message_fa },
    groups,
    rules: { ...c.rules, ...extraRules },
    options: [
      ...c.special_actions.map((a): ReviewOption => ({
        code: a.code,
        kind: a.calls_dami ? "technical" : /route|back to/i.test(a.action) ? "route" : "regenerate",
        label: englishLabel(labels, a.code, key),
        labelFa: a.label_fa,
        needsText: false,
        proOnly: false,
        callsClaude: a.calls_dami,
        editEligible: false,
        action: a.action,
        ...(a.note ? { note: a.note } : {}),
      })),
      ...c.technical.map((t): ReviewOption => {
        const condition = t.available_when ?? REFERENCE_CONDITIONS[t.code];
        return {
          code: t.code,
          kind: "technical",
          ...(t.group ? { group: t.group } : {}),
          label: englishLabel(labels, t.code, key),
          labelFa: t.label_fa,
          instruction: t.instruction,
          needsText: false,
          proOnly: false,
          callsClaude: true,
          editEligible: editEligible.includes(t.code),
          ...(condition ? { availableWhen: parseAvailableWhen(condition) } : {}),
          ...(t.hide_when ? { hideWhen: parseHideWhen(t.hide_when) } : {}),
          ...(t.suggest_first || suggestFirst.has(t.code)
            ? { suggestFirst: t.suggest_first ?? suggestFirst.get(t.code) }
            : {}),
          ...(t.note ? { note: t.note } : {}),
        };
      }),
      ...c.preference.map((p): ReviewOption => {
        const followup = normalizeFaFollowup(p.followup, p.code, labels, key);
        return {
          code: p.code,
          kind: "preference",
          ...(p.group ? { group: p.group } : {}),
          label: englishLabel(labels, p.code, key),
          labelFa: p.label_fa,
          instructionTemplate: p.instruction_template,
          ...(p.instruction_template_auto
            ? { instructionTemplateAuto: p.instruction_template_auto }
            : {}),
          followup,
          needsText: followup.type === "text",
          proOnly: p.available_in !== undefined && !p.available_in.includes("wizard"),
          callsClaude: true,
          editEligible: editEligible.includes(p.code),
          ...(p.conflicts_with_reference
            ? { conflictsWithReference: p.conflicts_with_reference }
            : {}),
          ...(p.note ? { note: p.note } : {}),
        };
      }),
    ],
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Shape 3: flat item catalogs (location, prop and their sheets)                               */
/* ------------------------------------------------------------------------------------------ */

const itemsCatalogSchema = z.object({
  catalog: text,
  version: z.number().int().min(1),
  dami: text,
  applies_to: z.string().optional(),
  flow: z.string().optional(),
  items: z.array(
    z.object({
      code: text,
      type: z.enum(["technical", "preference", "regenerate", "route"]),
      group: z.string().nullish(),
      label: text,
      label_fa: z.string().optional(),
      instruction: z.string().nullable(),
      needs_user_text: z.boolean(),
      pro_only: z.boolean(),
      calls_claude: z.boolean(),
      edit_eligible: z.boolean().optional(),
      action: z.string().optional(),
    }),
  ),
});

/** `reference_fidelity` → "Reference fidelity". */
function groupLabel(id: string): string {
  const words = id.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function normalizeItems(raw: unknown, key: ReviewCatalogKey): Omit<ReviewCatalog, "key"> {
  const c = parseShape(itemsCatalogSchema, raw, key);
  const groupIds = [...new Set(c.items.flatMap((i) => (i.group ? [i.group] : [])))];
  return {
    dami: c.dami,
    version: String(c.version),
    ...(c.applies_to ? { appliesTo: c.applies_to } : {}),
    ...(c.flow ? { flow: c.flow } : {}),
    groups: groupIds.map((id) => ({ id, label: groupLabel(id) })),
    rules: {},
    options: c.items.map((i): ReviewOption => ({
      code: i.code,
      kind: i.type,
      ...(i.group ? { group: i.group } : {}),
      label: i.label,
      ...(i.label_fa ? { labelFa: i.label_fa } : {}),
      ...(i.instruction ? { instruction: i.instruction } : {}),
      needsText: i.needs_user_text,
      proOnly: i.pro_only,
      callsClaude: i.calls_claude,
      editEligible: i.edit_eligible ?? false,
      ...(i.action ? { action: i.action } : {}),
    })),
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Loading                                                                                     */
/* ------------------------------------------------------------------------------------------ */

function parseShape<S extends z.ZodType>(schema: S, raw: unknown, key: string): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ReviewCatalogError(
      `${key}/review-catalog.json does not match its schema: ${issue?.path.join(".") ?? ""} ${issue?.message ?? ""}`,
    );
  }
  return parsed.data;
}

const LOADERS: Record<ReviewCatalogKey, () => Omit<ReviewCatalog, "key">> = {
  "asset-detector": () => normalizeDetector(assetDetectorJson),
  "character-generator": () =>
    normalizeFaCatalog(characterJson, "character-generator", CHARACTER_REVIEW_LABELS_EN),
  "location-generator": () => normalizeItems(locationJson, "location-generator"),
  "prop-generator": () => normalizeItems(propJson, "prop-generator"),
  "sheet-generator-character": () =>
    normalizeFaCatalog(
      characterSheetJson,
      "sheet-generator-character",
      CHARACTER_SHEET_REVIEW_LABELS_EN,
      CHARACTER_SHEET_EDIT_CODES,
    ),
  "sheet-generator-location": () => normalizeItems(locationSheetJson, "sheet-generator-location"),
  "sheet-generator-prop": () => normalizeItems(propSheetJson, "sheet-generator-prop"),
};

const cache = new Map<ReviewCatalogKey, ReviewCatalog>();

/** The normalized catalog of a dami (parsed once per process; immutable data). */
export function getReviewCatalog(key: ReviewCatalogKey): ReviewCatalog {
  let catalog = cache.get(key);
  if (!catalog) {
    const loaded: ReviewCatalog = { key, ...LOADERS[key]() };
    const seen = new Set<string>();
    for (const option of loaded.options) {
      if (seen.has(option.code)) {
        throw new ReviewCatalogError(`${key}: the code ${option.code} is used twice`);
      }
      seen.add(option.code);
    }
    catalog = loaded;
    cache.set(key, catalog);
  }
  return catalog;
}

export function findReviewOption(catalog: ReviewCatalog, code: string): ReviewOption | undefined {
  return catalog.options.find((o) => o.code === code);
}

/* ------------------------------------------------------------------------------------------ */
/* Screens and fix requests                                                                    */
/* ------------------------------------------------------------------------------------------ */

export type ReviewSector = "wizard" | "pro";

/**
 * The options a screen shows: Pro-only ones are hidden in the Wizard; an option with
 * `availableWhen` needs that context flag, one with `hideWhen` is hidden when the flag matches.
 * Context flags are things like `face_reference` (a face reference photo exists) or
 * `render_cell_numbers`.
 */
export function visibleOptions(
  catalog: ReviewCatalog,
  input: { sector: ReviewSector; context?: Readonly<Record<string, boolean>> },
): ReviewOption[] {
  const context = input.context ?? {};
  return catalog.options.filter((o) => {
    if (o.proOnly && input.sector !== "pro") return false;
    if (o.availableWhen && context[o.availableWhen.key] !== o.availableWhen.value) return false;
    if (o.hideWhen && context[o.hideWhen.key] === o.hideWhen.value) return false;
    return true;
  });
}

/** One option the user picked, with what they chose or typed for it. */
export type FixSelection = {
  code: string;
  /** The chip's value (or `AUTO_VALUE` to let the dami choose). */
  value?: string;
  /** What the user typed. Fills `{value}` when no chip is chosen. */
  customText?: string;
  /** The assets (by name) the pick is about. */
  targetNames?: string[];
  /** The sheet view or frame the pick is about. */
  viewId?: string;
  /** The detail frame chosen in a `select_detail_cell` step. */
  slot?: { slot: string | number; subject: string };
};

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(value|slot|slot_subject)\}/g, (all, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new ReviewCatalogError(`The instruction needs {${name}}, which was not given`);
    }
    return value;
  });
}

/**
 * The fix requests for a user's picks, in the order picked: templates are filled with the chosen
 * chip value or the user's text (`{value}`) and the chosen detail frame (`{slot}`,
 * `{slot_subject}`). Only dami fixes (technical or preference options that call Claude) become
 * requests; re-rolls, routes and backend edits are left to the caller. Throws
 * `ReviewCatalogError` for an unknown code or a pick missing what its option needs.
 */
export function buildFixRequests(
  catalog: ReviewCatalog,
  selections: readonly FixSelection[],
): FixRequest[] {
  const requests: FixRequest[] = [];
  for (const selection of selections) {
    const option = findReviewOption(catalog, selection.code);
    if (!option) {
      throw new ReviewCatalogError(`${catalog.key} has no review option ${selection.code}`);
    }
    if ((option.kind !== "technical" && option.kind !== "preference") || !option.callsClaude) {
      continue;
    }
    const customText = selection.customText?.trim() || undefined;
    const chosen = selection.value?.trim() || undefined;
    let instruction: string;
    if (option.instructionTemplate) {
      const auto = chosen === AUTO_VALUE && option.instructionTemplateAuto;
      const value = chosen && chosen !== AUTO_VALUE ? chosen : customText;
      const values: Record<string, string> = {};
      if (value !== undefined) values.value = value;
      if (selection.slot) {
        values.slot = String(selection.slot.slot);
        values.slot_subject = selection.slot.subject;
      }
      instruction = fill(
        auto ? (option.instructionTemplateAuto ?? "") : option.instructionTemplate,
        values,
      );
    } else if (option.instruction) {
      instruction = option.instruction;
    } else {
      throw new ReviewCatalogError(`${option.code} has no instruction`);
    }
    // A chip that stands in for text (the detector's category chips) is sent as the custom text.
    const text = customText ?? (option.instructionTemplate ? undefined : chosen);
    if (option.needsText && !text && !option.instructionTemplate) {
      throw new ReviewCatalogError(`${option.code} needs the user's text`);
    }
    requests.push({
      type: option.kind,
      code: option.code,
      instruction,
      ...(text ? { customText: text } : {}),
      ...(selection.targetNames?.length ? { targetNames: [...selection.targetNames] } : {}),
      ...(selection.viewId ? { viewId: selection.viewId } : {}),
    });
  }
  return requests;
}

/** The codes of fix requests, for `review.issue_codes`. */
export function fixRequestCodes(requests: readonly FixRequest[]): string[] {
  return [...new Set(requests.map((r) => r.code))];
}

/**
 * The owner's free-text option of each catalog ("Other": the user's own words). A change request
 * written in free text is sent to the dami as this option with the note as its custom text.
 */
const FREE_TEXT_CODES: Readonly<Record<ReviewCatalogKey, string>> = {
  "asset-detector": "ADP99",
  "character-generator": "P99",
  "location-generator": "LP99",
  "prop-generator": "AP99",
  "sheet-generator-character": "SP99",
  "sheet-generator-location": "LSP99",
  "sheet-generator-prop": "ASP99",
};

/** The code of a catalog's free-text option. */
export function freeTextCode(key: ReviewCatalogKey): string {
  return FREE_TEXT_CODES[key];
}

/**
 * The one fix request of a free-text change request: the catalog's free-text option carrying the
 * user's note (`customText`). Throws a `ReviewCatalogError` for an empty note.
 */
export function freeTextFixRequest(key: ReviewCatalogKey, note: string): FixRequest {
  const customText = note.trim();
  if (!customText) throw new ReviewCatalogError(`${key}: a free-text request needs the note`);
  const [request] = buildFixRequests(getReviewCatalog(key), [
    { code: FREE_TEXT_CODES[key], customText },
  ]);
  if (!request) throw new ReviewCatalogError(`${key} has no free-text option`);
  return request;
}

/**
 * The review's note when its words are not already in a fix request (a free-text request carries
 * the note as its custom text, so sending it again as `user_notes` would only repeat it).
 */
export function noteOutsideRequests(
  note: string | null | undefined,
  requests: readonly { customText?: string }[],
): string | undefined {
  const text = note?.trim();
  if (!text) return undefined;
  return requests.some((r) => r.customText === text) ? undefined : text;
}
