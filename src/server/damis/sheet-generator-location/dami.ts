import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import {
  duplicateIds,
  editPreviousViewProblems,
  generationOrderProblems,
  isSheetFixRound,
  sheetFixProblems,
  viewDependencyProblems,
} from "../shared/designer";
import { buildLocationSheetPrompt } from "./prompt";
import {
  locationSheetInputSchema,
  locationSheetOutputSchema,
  type LocationSheetOutput,
  type LocationSheetParsedInput,
} from "./schema";

/** A view uses at most this many reference images (the owner tunes prompts for four). */
export const MAX_VIEW_REFERENCES = 4;

/** The Hero's view id: interiors `hero_wide`, exteriors `establishing_wide`. */
export const LOCATION_HERO_VIEWS: readonly string[] = ["hero_wide", "establishing_wide"];

/** The Reverse view the lock rule asks for (interior `reverse_wide`, exterior `reverse_establishing`). */
export function isReverseView(viewId: string): boolean {
  return viewId.startsWith("reverse");
}

function coverageViewIds(spec: Record<string, unknown>): string[] {
  const plan = spec.coverage_plan;
  if (!plan || typeof plan !== "object" || !("views" in plan) || !Array.isArray(plan.views)) {
    return [];
  }
  return plan.views.flatMap((v: unknown) =>
    v && typeof v === "object" && "view_id" in v && typeof v.view_id === "string"
      ? [v.view_id]
      : [],
  );
}

/** True when the run is a fix round (rule 9 of the owner's prompt). */
export function isLocationSheetFix(input: LocationSheetParsedInput): boolean {
  return isSheetFixRound(input);
}

/**
 * The owner's tests (section 6) as checks: the mode's shape (views or the four-panel concept
 * sheet), every planned view present once, `generation_order` after the dependencies, at most
 * four references, edit mode only where every request was edit-eligible (with the previous
 * version referenced), and every fix applied or explained.
 */
export function checkLocationSheet(
  output: LocationSheetOutput,
  input: LocationSheetParsedInput,
): string[] {
  const problems: string[] = [];
  if (output.mode !== input.mode) problems.push(`mode must be "${input.mode}"`);
  if (input.mode === "concept") {
    if (!output.concept_sheet) problems.push("concept mode needs concept_sheet");
    else {
      const panels = output.concept_sheet.panel_plan.map((p) => p.panel).sort();
      if (panels.join(",") !== "alternate,detail_1,detail_2,hero") {
        problems.push(
          "panel_plan must have exactly four entries: hero, alternate, detail_1, detail_2",
        );
      }
    }
    if (output.views.length > 0) problems.push("views must be empty in concept mode");
    return [
      ...problems,
      ...sheetFixProblems(
        output.applied_fixes,
        output.warnings,
        isLocationSheetFix(input) ? input.fixRequests : [],
      ),
    ];
  }
  if (output.concept_sheet !== null) problems.push("concept_sheet must be null in lock mode");
  const ids = output.views.map((v) => v.view_id);
  const repeated = duplicateIds(ids);
  if (repeated.length > 0) {
    problems.push(
      `every view_id must appear once in views: ${repeated.join(", ")} appear more than once`,
    );
  }
  if (ids.length === 0 && output.warnings.length === 0) {
    problems.push("views is empty: write the views, or explain in warnings why not");
  }
  for (const id of ids) {
    if (LOCATION_HERO_VIEWS.includes(id)) {
      problems.push(`views must not include ${id}: the Hero is already approved`);
    }
  }
  if (input.onlyViews) {
    const only = new Set(input.onlyViews);
    for (const id of ids) {
      if (!only.has(id)) problems.push(`only_views asks for ${[...only].join(", ")}; drop ${id}`);
    }
    for (const id of only) {
      if (!ids.includes(id)) problems.push(`only_views asks for ${id}: write it`);
    }
  } else if (ids.length > 0) {
    for (const id of coverageViewIds(input.lockedSpec)) {
      if (!LOCATION_HERO_VIEWS.includes(id) && !ids.includes(id)) {
        problems.push(`coverage_plan has the view ${id}: write it`);
      }
    }
  }
  // Generation order: every view once, after the views of this answer it depends on.
  const { problems: orderProblems, position } = generationOrderProblems(
    ids,
    output.generation_order,
    { allowEmpty: true },
  );
  problems.push(...orderProblems);
  // A re-written view may depend on a view of the pack that is not approved (yet).
  const approved = new Set([
    ...input.approvedImages.map((a) => a.viewId),
    ...(input.onlyViews ? coverageViewIds(input.lockedSpec) : []),
  ]);
  for (const view of output.views) {
    problems.push(
      ...viewDependencyProblems(
        view.view_id,
        view.depends_on,
        position,
        (d) => approved.has(d) || LOCATION_HERO_VIEWS.includes(d),
      ),
    );
    if (view.reference_order.length > MAX_VIEW_REFERENCES) {
      problems.push(`${view.view_id} uses more than ${MAX_VIEW_REFERENCES} reference images`);
    }
    if (!view.image_prompt.trim()) problems.push(`${view.view_id} has no image_prompt`);
    if (view.edit_mode === "edit_previous_view") {
      problems.push(
        ...editPreviousViewProblems(
          view.view_id,
          input.fixRequests.filter((r) => r.viewId === view.view_id),
          view.reference_order.some((r) => r.source_view_id === `previous:${view.view_id}`),
        ),
      );
    }
  }
  problems.push(
    ...sheetFixProblems(
      output.applied_fixes,
      output.warnings,
      isLocationSheetFix(input) ? input.fixRequests : [],
    ),
  );
  return problems;
}

export const sheetGeneratorLocation = defineDami({
  key: "sheet-generator-location",
  version: "1.0.0",
  description:
    "Writes the prompts for the remaining views of a location's pack (lock: one image per view, in a dependency order) or the four-panel concept sheet, from the locked spec and the approved Hero; never redesigns, and fix mode re-writes only the views asked for.",
  input: locationSheetInputSchema,
  output: locationSheetOutputSchema,
  // The owner's recommended model.
  model: CLAUDE_MODELS.sonnet,
  // The owner asks for temperature 0.3; the SDK has no temperature (docs/damis/README.md): low.
  effort: "low",
  // The owner sizes max_tokens at 5000 (lock) or 2000 (concept); doubled for headroom.
  maxOutputTokens: 10_000,
  build: buildLocationSheetPrompt,
  check: checkLocationSheet,
});
