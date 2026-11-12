/**
 * Sample-mode Prop Sheet Generator: one view per planned view of the locked spec's `sheet_plan`
 * (labels from the VIEW LIBRARY, the Hero always reference 1, a back view leaning on the approved
 * right view), the scale card's data from `dna.scale`, and the owner's ordering. Fix mode keeps
 * every view of the previous answer and changes only the views the requests name: edit-eligible
 * requests edit the previous image, design changes are refused with `DESIGN_CHANGE_REQUESTED:`.
 */
import {
  MAX_PROP_VIEW_REFERENCES,
  minimumPropLevel,
  nonDefaultStates,
} from "../sheet-generator-prop/dami";
import {
  propSheetInputSchema,
  propSheetOutputSchema,
  type PropSheetOutput,
  type PropSheetParsedInput,
  type PropSheetView,
} from "../sheet-generator-prop/schema";
import { DESIGN_CHANGE_PREFIX } from "../sheet-generator-character/schema";
import { truncate } from "./util";

const ORDINALS = ["first", "second", "third", "fourth"];
const ORTHO = ["front", "right", "back", "left", "top", "bottom"];

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

type Planned = { view_id: string; purpose: string };

function planned(spec: Record<string, unknown>): Planned[] {
  const views = record(spec.sheet_plan)?.views;
  if (!Array.isArray(views)) return [];
  return views.flatMap((v: unknown) => {
    const r = record(v);
    return r && typeof r.view_id === "string" && r.view_id !== "hero_34"
      ? [{ view_id: r.view_id, purpose: text(r.purpose) }]
      : [];
  });
}

function stateName(spec: Record<string, unknown>, id: string): string {
  const states = record(spec.dna)?.states;
  if (Array.isArray(states)) {
    for (const s of states) {
      const r = record(s);
      if (r?.state_id === id) return text(r.name, id);
    }
  }
  return id.replace(/_/g, " ");
}

function defaultState(spec: Record<string, unknown>): string {
  const states = record(spec.dna)?.states;
  if (Array.isArray(states)) {
    for (const s of states) {
      const r = record(s);
      if (r?.is_default === true && typeof r.state_id === "string") return r.state_id;
    }
  }
  return "default";
}

/** The VIEW LIBRARY's label of a view id. */
function propViewLabel(viewId: string, spec: Record<string, unknown> = {}): string {
  if (viewId === "hero_34") return "Hero 3/4";
  if (viewId === "back_34") return "Back 3/4";
  if (viewId === "scale_ref") return "Scale";
  if (viewId === "interaction") return "Interaction";
  const n = /^(detail|material)_(\d+)$/.exec(viewId);
  if (n) return `${n[1] === "detail" ? "Detail" : "Material"} ${n[2]}`;
  if (viewId.startsWith("state_")) return `State: ${stateName(spec, viewId.slice(6))}`;
  return viewId.charAt(0).toUpperCase() + viewId.slice(1);
}

function writeView(p: Planned, ids: readonly string[], input: PropSheetParsedInput): PropSheetView {
  const spec = input.lockedSpec;
  const id = p.view_id;
  const label = propViewLabel(id, spec);
  const deps =
    id === "back" && ids.includes("right")
      ? ["right"]
      : id === "left" && ids.includes("front")
        ? ["front"]
        : [];
  const reference_order = [
    { index: 1, source: "approved_hero", role: "the exact object" },
    ...deps.map((d, i) => ({
      index: i + 2,
      source: `approved_view:${d}`,
      role: "the closest approved angle",
    })),
  ].slice(0, MAX_PROP_VIEW_REFERENCES);
  const detail = /^(detail|material)_/.test(id);
  const state = id.startsWith("state_") ? id.slice(6) : defaultState(spec);
  const hero = record(spec.hero_view);
  const heroRatio = text(hero?.aspect_ratio, "1:1") as PropSheetView["aspect_ratio"];
  const name = text(spec.asset_name, "the object");
  const focus: PropSheetView["review_focus"] = ["shape", "material"];
  if (ORTHO.includes(id) || id === "back_34") focus.push("directional");
  if (id.startsWith("state_") || id === "interaction") focus.push("functional");
  if (id === "scale_ref" || id === "interaction") focus.push("scale");
  const camera = ORTHO.includes(id)
    ? `Camera perpendicular to the ${id} face at its center height, long lens, flat perspective, the object filling about 75 percent of the frame.`
    : detail
      ? "A true sharp macro close-up of one signature detail with a little surrounding form for context."
      : id.startsWith("state_")
        ? `The hero_34 angle with the object ${stateName(spec, state)}; only the moving part changes.`
        : id === "scale_ref"
          ? "The object beside a plain neutral-grey mannequin hand, side by side, same light and distance, true relative size."
          : id === "interaction"
            ? "Neutral-grey mannequin hands with five correctly formed fingers hold the object the way it is used."
            : "Back-left three-quarter, same height and distance as the Hero.";
  return {
    view_id: id,
    label,
    purpose: p.purpose || label,
    state_id: state,
    image_prompt: [
      `The first reference image is the exact object, ${name}. Keep its shape, proportions, parts, materials, colors and details identical; only the camera angle changes.`,
      deps.length > 0
        ? `The second reference image shows the approved ${deps[0]} view for orientation.`
        : "",
      camera,
      "Seamless neutral mid-grey studio background, soft even neutral light, no labels, numbers or arrows.",
    ]
      .filter(Boolean)
      .join(" "),
    aspect_ratio: detail ? "1:1" : heroRatio,
    reference_order,
    depends_on: deps,
    must_show: ORTHO.includes(id) ? [`The ${id} face straight on, nothing mirrored`] : [label],
    must_not_show: ["labels or numbers", "a mirrored front on the back"],
    new_hypotheses:
      id === "back" || id === "back_34" || id === "bottom"
        ? [
            {
              area: `the ${id.replace("_34", "")} side`,
              proposal: "Plain, in the same material and wear as the front.",
            },
          ]
        : [],
    review_focus: focus,
    edit_mode: "full",
  };
}

function isDesignChange(code: string, value: string): boolean {
  if (code === "ASX01") return true;
  return /\b(longer|shorter|bigger|smaller|thicker|thinner|change the (shape|material|color|colour))\b/i.test(
    value,
  );
}

export function sampleSheetGeneratorProp(raw: unknown): PropSheetOutput {
  const input = propSheetInputSchema.parse(raw);
  const spec = input.lockedSpec;
  const name = text(spec.asset_name, "the prop");
  const plan = record(spec.sheet_plan);
  const planLevel = text(plan?.level, "standard") as PropSheetOutput["sheet_level"];
  const minimum = minimumPropLevel(spec);
  const warnings: string[] = [];
  let level = input.sheetLevelOverride ?? planLevel;
  if (minimum === "production" && level !== "production") {
    if (input.sheetLevelOverride) {
      warnings.push(
        "The requested level was raised to production for this functional or hero asset.",
      );
    }
    level = "production";
  }
  const scale = record(record(spec.dna)?.scale);
  const confirmed = text(scale?.dimensions_status) === "confirmed";
  const dims = record(scale?.dimensions_cm);
  const relative = text(scale?.relative_reference, "about the size of a hand");
  const scale_card: PropSheetOutput["scale_card"] = {
    dimensions_cm:
      dims &&
      typeof dims.height === "number" &&
      typeof dims.width === "number" &&
      typeof dims.depth === "number"
        ? { height: dims.height, width: dims.width, depth: dims.depth }
        : null,
    dimensions_status: confirmed ? "confirmed" : scale ? "inferred" : "unknown",
    relative_reference: relative,
    text:
      confirmed && dims
        ? `${String(dims.height)} × ${String(dims.width)} × ${String(dims.depth)} cm`
        : truncate(relative, 120),
  };
  const plannedViews = planned(spec);
  if (level === "production") {
    for (const state of nonDefaultStates(spec)) {
      if (!plannedViews.some((p) => p.view_id === `state_${state}`)) {
        plannedViews.push({ view_id: `state_${state}`, purpose: "A non-default state." });
      }
    }
  }
  const ids = plannedViews.map((p) => p.view_id);
  const fresh = plannedViews.map((p) => writeView(p, ids, input));
  const previous = propSheetOutputSchema.safeParse(input.previousOutput);
  const fixing =
    previous.success && (input.fixRequests.length > 0 || input.userNotes !== undefined);
  const applied: PropSheetOutput["applied_fixes"] = [];
  const views = fixing
    ? previous.data.views.map((view): PropSheetView => {
        const requests = input.fixRequests.filter((r) => r.viewId === view.view_id);
        if (requests.length === 0) return view;
        const usable = requests.filter((r) => {
          if (isDesignChange(r.code, `${r.instruction} ${r.note ?? ""}`)) {
            warnings.push(
              `${DESIGN_CHANGE_PREFIX} ${view.view_id}: ${truncate(r.note ?? r.instruction, 300)}`,
            );
            return false;
          }
          return true;
        });
        if (usable.length === 0) return view;
        for (const r of usable) {
          applied.push({
            code: r.code,
            view_id: view.view_id,
            change: truncate(r.instruction, 160),
          });
        }
        const changes = usable.map((r) =>
          r.note ? `${r.instruction} (${r.note})` : r.instruction,
        );
        if (requests.every((r) => r.editEligible)) {
          const refs = view.reference_order.slice(0, MAX_PROP_VIEW_REFERENCES - 1);
          refs.push({
            index: refs.length + 1,
            source: `previous:${view.view_id}`,
            role: "the image to edit",
          });
          return {
            ...view,
            reference_order: refs,
            edit_mode: "edit_previous_view",
            image_prompt: `Edit the ${ORDINALS[refs.length - 1] ?? "last"} reference image: ${changes.join(" ")} Keep everything else identical. The first reference image remains the exact object.`,
          };
        }
        return {
          ...view,
          edit_mode: "full",
          image_prompt: `${view.image_prompt} Corrections: ${changes.join(" ")}`,
        };
      })
    : fresh;
  const maxViews = level === "simple" ? 1 : level === "standard" ? 6 : 13;
  const kept = views.slice(0, maxViews);
  return {
    asset_id: text(spec.asset_id, name),
    asset_name: name,
    sheet_level: fixing && previous.success ? previous.data.sheet_level : level,
    views: kept,
    generation_order: kept.map((v) => v.view_id),
    scale_card: fixing && previous.success ? previous.data.scale_card : scale_card,
    applied_fixes: applied,
    assumptions: [
      "Hidden sides follow the front's material and wear.",
      ...(confirmed ? [] : ["The scale card uses relative wording: the size is not confirmed."]),
    ],
    warnings,
  };
}
