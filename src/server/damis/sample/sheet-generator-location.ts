/**
 * Sample-mode Location Sheet Generator: one view per coverage-plan view (the Hero excluded) in
 * the owner's generation order and reference pattern (the reverse references the Hero, corners
 * the Hero and the reverse, and so on), each with a spatial brief, must-show anchors and review
 * checks. Concept mode returns the four-panel sheet. Fix mode re-writes only `only_views` from the
 * previous answer: edit-eligible requests edit the previous version, design changes are refused
 * with a `DESIGN_CHANGE_REQUESTED:` warning.
 */
import { LOCATION_HERO_VIEWS, MAX_VIEW_REFERENCES } from "../sheet-generator-location/dami";
import {
  locationSheetInputSchema,
  locationSheetOutputSchema,
  type LocationSheetOutput,
  type LocationSheetParsedInput,
  type LocationSheetView,
} from "../sheet-generator-location/schema";
import { DESIGN_CHANGE_PREFIX } from "../sheet-generator-character/schema";
import { truncate } from "./util";

type PlannedView = { view_id: string; name: string; purpose: string };

const ORDINALS = ["first", "second", "third", "fourth"];

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function strings(value: unknown, key: string): string[] {
  return Array.isArray(value)
    ? value.flatMap((v) => {
        const r = record(v);
        return r && typeof r[key] === "string" ? [r[key]] : [];
      })
    : [];
}

function plannedViews(spec: Record<string, unknown>): PlannedView[] {
  const views = record(spec.coverage_plan)?.views;
  if (!Array.isArray(views)) return [];
  return views.flatMap((v: unknown) => {
    const r = record(v);
    if (!r || typeof r.view_id !== "string") return [];
    return [
      {
        view_id: r.view_id,
        name: typeof r.name === "string" ? r.name : r.view_id,
        purpose: typeof r.purpose === "string" ? r.purpose : "",
      },
    ];
  });
}

/** The views a view references, before the Hero (the owner's LOCK MODE pattern). */
function dependencies(id: string, ids: readonly string[]): string[] {
  const reverse = ids.find((v) => v.startsWith("reverse"));
  if (id.startsWith("reverse")) return [];
  if (id === "corner_b" && ids.includes("corner_a")) {
    return [reverse, "corner_a"].filter((v): v is string => v !== undefined);
  }
  return reverse ? [reverse] : [];
}

const CAMERA: Record<string, string> = {
  reverse_wide:
    "The camera stands at the north wall and looks south at the wall that was behind the Hero camera; the east wall is now on the left and the west wall on the right.",
  corner_a:
    "The camera stands in the south-west corner and looks north-east: the north wall on the left, the east wall on the right.",
  corner_b:
    "The camera stands in the south-east corner and looks north-west: the west wall on the left, the north wall on the right.",
  side_west:
    "The camera stands at the west wall and looks east at the east wall; north is on the left, south on the right.",
  side_east:
    "The camera stands at the east wall and looks west at the west wall; south is on the left, north on the right.",
  reverse_establishing: "The camera stands north of the site and looks south, back across it.",
  approach_left: "The camera stands south-west of the site and looks north-east toward the facade.",
  approach_right:
    "The camera stands south-east of the site and looks north-west toward the facade.",
  human_level: "The camera stands south of the facade at eye height, about 1.7 m, and looks north.",
  environmental_context:
    "The camera pulls far back from the south to show what surrounds the site.",
};

function writeView(
  view: PlannedView,
  ids: readonly string[],
  input: LocationSheetParsedInput,
): LocationSheetView {
  const hero = input.approvedImages[0]?.viewId ?? "hero_wide";
  const deps = dependencies(view.view_id, ids);
  const sources = [hero, ...deps].slice(0, MAX_VIEW_REFERENCES);
  const anchors = record(input.lockedSpec.dna)?.fixed_anchors;
  const anchorIds = strings(anchors, "id").slice(0, 4);
  const anchorNames = strings(anchors, "name").slice(0, 4);
  const style = typeof input.lockedSpec.style_used === "string" ? input.lockedSpec.style_used : "";
  const detail = view.view_id.startsWith("detail");
  const brief = detail
    ? `A true close-up of ${view.name.toLowerCase()}, sharp and in focus, with the same material and wear as the first reference image.`
    : (CAMERA[view.view_id] ??
      `The camera frames ${view.name.toLowerCase()} of the same space, translating left and right through the orientation system.`);
  const refsSentence = sources
    .map((s, i) => `the ${ORDINALS[i] ?? `${i + 1}th`} reference image (${s.replace(/_/g, " ")})`)
    .join(", ");
  const image_prompt = [
    `Spatial brief: ${brief}`,
    anchorNames.length > 0 && !detail
      ? `Fixed anchors keep their places from the layout: ${anchorNames.join(", ")}.`
      : "",
    `Same architecture, materials, palette, wear, time of day and light logic as ${refsSentence}.`,
    style ? `Rendered in the ${style}.` : "",
    "Same space as the reference images, no new doors or windows, empty of people, no text, 16:9, no borders.",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    view_id: view.view_id,
    name: view.name,
    image_prompt,
    aspect_ratio: "16:9",
    reference_order: sources.map((s, i) => ({ index: i + 1, source_view_id: s })),
    depends_on: deps,
    must_show: detail
      ? []
      : anchorIds.map((id) => ({
          anchor_id: id,
          expected_position: view.view_id.startsWith("reverse")
            ? "on the opposite side from where the Hero shows it"
            : "where the layout places it, as seen from this camera",
        })),
    must_not_show: ["people or figures", "readable text", "new doors or windows"],
    new_hypotheses: view.view_id.startsWith("reverse")
      ? [
          "The wall behind the Hero camera is proposed design: plain wall with the room's materials.",
        ]
      : [],
    review_focus: view.view_id.startsWith("reverse")
      ? ["Something on the Hero's left wall must be on the RIGHT here", "Not a mirror of the Hero"]
      : detail
        ? ["A true close-up, sharp and in focus", "Same material and wear as the Hero"]
        : ["Anchors sit where the layout puts them", "Same light and palette as the Hero"],
    edit_mode: "full",
  };
}

function isDesignChange(code: string, text: string): boolean {
  if (code === "LSX01") return true;
  return /\b(move|add|remove|another) (the |a |an )?(door|window|wall|opening|stair)/i.test(text);
}

function fixViews(input: LocationSheetParsedInput, fresh: LocationSheetView[]) {
  const previous = locationSheetOutputSchema.safeParse(input.previousOutput);
  const base = previous.success ? previous.data.views : fresh;
  const only = new Set(input.onlyViews ?? input.fixRequests.map((r) => r.viewId));
  const warnings: string[] = [];
  const applied: string[] = [];
  const views = base
    .filter((v) => only.has(v.view_id))
    .map((view): LocationSheetView => {
      const requests = input.fixRequests.filter((r) => r.viewId === view.view_id);
      const usable = requests.filter((r) => {
        const text = `${r.instruction} ${r.note ?? ""}`;
        if (isDesignChange(r.code, text)) {
          warnings.push(
            `${DESIGN_CHANGE_PREFIX} ${view.view_id}: ${truncate(r.note ?? r.instruction, 300)}`,
          );
          return false;
        }
        return true;
      });
      applied.push(...usable.map((r) => r.code));
      if (usable.length === 0) return view;
      const changes = usable.map((r) => (r.note ? `${r.instruction} (${r.note})` : r.instruction));
      const edit = requests.length > 0 && requests.every((r) => r.editEligible);
      if (edit) {
        const refs = [...view.reference_order.slice(0, MAX_VIEW_REFERENCES - 1)];
        refs.push({ index: refs.length + 1, source_view_id: `previous:${view.view_id}` });
        return {
          ...view,
          reference_order: refs,
          edit_mode: "edit_previous_view",
          image_prompt: `Edit the ${ORDINALS[refs.length - 1] ?? "last"} reference image (the previous ${view.name}): ${changes.join(" ")} Keep everything else identical: the space, the anchors, the light and the style.`,
        };
      }
      return {
        ...view,
        edit_mode: "full",
        image_prompt: `${view.image_prompt} Corrections: ${changes.join(" ")}`,
      };
    });
  return { views, warnings, applied: [...new Set(applied)] };
}

export function sampleSheetGeneratorLocation(raw: unknown): LocationSheetOutput {
  const input = locationSheetInputSchema.parse(raw);
  const spec = input.lockedSpec;
  const name = typeof spec.location_name === "string" ? spec.location_name : "the location";
  const assetId = typeof spec.asset_id === "string" ? spec.asset_id : name;
  const planned = plannedViews(spec).filter((v) => !LOCATION_HERO_VIEWS.includes(v.view_id));
  const assumptions = ["Every view keeps the Hero's time of day and light direction."];

  if (input.mode === "concept") {
    const hero = input.approvedImages[0]?.viewId ?? "hero_wide";
    return {
      asset_id: assetId,
      location_name: name,
      mode: "concept",
      concept_sheet: {
        image_prompt: `One 16:9 image with four panels and thin even gutters, no text: the left half reproduces the first reference image faithfully; the right half shows the reverse wide view of ${name} as a full-width top panel and two detail panels side by side below it, all in the same place, time of day and light.`,
        aspect_ratio: "16:9",
        reference_order: [{ index: 1, source_view_id: hero }],
        panel_plan: [
          { panel: "hero", content: "The approved Hero, reproduced faithfully." },
          { panel: "alternate", content: "The reverse wide view, built from the layout." },
          { panel: "detail_1", content: "The way in, up close." },
          { panel: "detail_2", content: "The main light source, up close." },
        ],
        edit_mode: "full",
      },
      views: [],
      generation_order: [],
      assumptions,
      warnings: [],
      applied_fixes: [],
    };
  }

  const ids = planned.map((v) => v.view_id);
  const fresh = planned.map((v) => writeView(v, ids, input));
  const fixing =
    input.previousOutput !== undefined && (input.onlyViews || input.fixRequests.length > 0);
  if (fixing) {
    const { views, warnings, applied } = fixViews(input, fresh);
    return {
      asset_id: assetId,
      location_name: name,
      mode: "lock",
      concept_sheet: null,
      views,
      generation_order: orderOf(views),
      assumptions,
      warnings,
      applied_fixes: applied,
    };
  }
  const views = input.onlyViews ? fresh.filter((v) => input.onlyViews?.includes(v.view_id)) : fresh;
  return {
    asset_id: assetId,
    location_name: name,
    mode: "lock",
    concept_sheet: null,
    views,
    generation_order: orderOf(views),
    assumptions,
    warnings: views.length === 0 ? ["The coverage plan has no views besides the Hero."] : [],
    applied_fixes: [],
  };
}

/** Views in an order where every view comes after the views of the answer it depends on. */
function orderOf(views: readonly LocationSheetView[]): string[] {
  const ids = new Set(views.map((v) => v.view_id));
  const done: string[] = [];
  const pending = [...views];
  while (pending.length > 0) {
    const i = pending.findIndex((v) => v.depends_on.every((d) => !ids.has(d) || done.includes(d)));
    const [next] = pending.splice(i === -1 ? 0 : i, 1);
    if (next) done.push(next.view_id);
  }
  return done;
}
