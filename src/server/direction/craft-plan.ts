/**
 * The craft pipeline's pure glue around the Breakdown: what the cinematographer reads (its scenes
 * and shots), the v1.4 plan the writer gets (a Director plan output: header, Breakdown blocks,
 * totals and warnings), and the shot plan and visual layer of one `write_blocks` batch. No
 * database.
 *
 * The plan header's continuity bible: the film-director writes no descriptors (the character,
 * location and prop sheets own every appearance), but v1.4 needs a bible entry for every asset a
 * block uses and checks that its descriptor is pasted word for word into every prompt using it
 * (`checkDescriptors`). Each descriptor is therefore a label of the asset's name pointing at its
 * reference ("Mara, as in the character reference"): the check stays meaningful (every prompt
 * names every asset it uses the same way) and no appearance is invented.
 */
import {
  DIRECTOR_OWNER_VERSION,
  type AssetRegistry,
  type BlockShotPlan,
  type ContinuityBible,
  type CreativeBible,
  type DirectorPlanOutput,
  type FilmShot,
  type Look,
  type LookSceneInput,
  type PlannedShot,
  type SceneInput,
  type SceneVisual,
  type ShotPlan,
  type VisualLayer,
  sceneShotsFor,
} from "@/server/damis";
import { breakdown, type BreakdownResult, type BreakdownWarning } from "./breakdown";
import type { DirectionContext } from "./context";
import type { CraftSelection } from "./craft";

/** Scenes per `direction.scene` batch: parallel batches, few calls lost to a retry. */
export const SCENE_BATCH_SCENES = 4;

/** The run's scene ids in shot order (only scenes that have shots). */
export function sceneIdsOf(plan: Pick<ShotPlan, "shots">): string[] {
  return [...new Set(plan.shots.map((s) => s.scene_id))];
}

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

function sceneNumber(sceneId: string): number | null {
  const n = /^sc_(\d+)$/.exec(sceneId);
  return n ? Number(n[1]) : null;
}

function sceneFacts(plan: Pick<ShotPlan, "scene_geography">, registry: AssetRegistry, id: string) {
  const geo = plan.scene_geography.find((g) => g.scene_id === id);
  const location = registry.locations.find((l) => l.loc_id === geo?.location_id);
  const n = sceneNumber(id);
  const indexed = n !== null ? registry.scene_index[n - 1] : undefined;
  const timeOfDay = indexed?.time_of_day ?? location?.time_of_day;
  return {
    label: location?.name ?? geo?.location_id ?? id,
    interiorExterior: location?.interior_exterior,
    timeOfDay,
  };
}

/** The cinematographer's `look` scenes: a label, never a description, and what happens. */
export function lookScenesFor(
  plan: Pick<ShotPlan, "shots" | "beats" | "scene_geography">,
  registry: AssetRegistry,
): LookSceneInput[] {
  return sceneIdsOf(plan).map((id) => {
    const facts = sceneFacts(plan, registry, id);
    const summary = plan.beats
      .filter((b) => b.scene_id === id)
      .map((b) => b.summary.trim())
      .filter(Boolean)
      .join(" ");
    return {
      scene_id: id,
      location_label: facts.label,
      ...(facts.interiorExterior ? { interior_exterior: facts.interiorExterior } : {}),
      ...(facts.timeOfDay ? { time_of_day: facts.timeOfDay } : {}),
      summary: clip(summary, 800),
    };
  });
}

/** The cinematographer's `scene` input for one scene of the run. */
export function sceneInputFor(input: {
  plan: Pick<ShotPlan, "shots" | "scene_geography">;
  registry: AssetRegistry;
  look: Look;
  cinematographerId: CraftSelection["cinematographerId"];
  sceneId: string;
}): SceneInput {
  const facts = sceneFacts(input.plan, input.registry, input.sceneId);
  return {
    mode: "scene",
    cinematographer_id: input.cinematographerId,
    look: input.look,
    scene: {
      scene_id: input.sceneId,
      location_label: facts.label,
      ...(facts.timeOfDay ? { time_of_day: facts.timeOfDay } : {}),
    },
    shots: sceneShotsFor(input.plan, input.sceneId),
  };
}

/* -------------------------------------------------------------------------- */
/* The v1.4 plan                                                               */
/* -------------------------------------------------------------------------- */

/** The descriptor label of an asset (see the file comment). */
export function assetLabel(kind: "character" | "location" | "prop", name: string): string {
  return `${name}, as in the ${kind} reference`;
}

function continuityBibleOf(
  blocks: BreakdownResult["blocks"],
  registry: AssetRegistry,
  bible: CreativeBible,
): ContinuityBible {
  const used = (pick: (b: BreakdownResult["blocks"][number]) => string[]) => [
    ...new Set(blocks.flatMap(pick)),
  ];
  const style = bible.contracts.style_contract.trim().split(/(?<=[.!?])\s+/)[0] ?? "";
  return {
    characters: used((b) => b.assets.characters).map((id) => {
      const c = registry.characters.find((r) => r.char_id === id);
      const name = c?.name ?? id;
      return {
        asset_id: id,
        name,
        descriptor: assetLabel("character", name),
        // Audible facts only, and only for a character who speaks (v1.4 `checkVoiceNotes`).
        voice: c?.speaks ? (c.voice_delivery ?? []).join(", ") : "",
        costume_versions: [],
      };
    }),
    locations: used((b) => b.assets.locations).map((id) => ({
      asset_id: id,
      descriptor: assetLabel(
        "location",
        registry.locations.find((l) => l.loc_id === id)?.name ?? id,
      ),
      landmarks: [],
    })),
    props: used((b) => b.assets.props).map((id) => ({
      asset_id: id,
      descriptor: assetLabel("prop", registry.props.find((p) => p.prop_id === id)?.name ?? id),
    })),
    style_line: style,
  };
}

/** The look as one paragraph, for the header and the visual layer. */
export function lookSummary(look: Look): string {
  return [
    look.lens_and_camera,
    look.framing,
    look.multi_character_framing,
    look.daylight,
    look.night,
    look.interiors_sealed_light,
    look.color_contrast_texture,
  ]
    .map((t) => t.trim())
    .filter(Boolean)
    .join(" ");
}

const FILM_WARNING_TYPES = new Set([
  "input_integrity",
  "missing_asset",
  "runtime",
  "staging",
  "other",
]);

type PlanWarning = DirectorPlanOutput["warnings"][number];

export type CraftPlan = {
  /** The v1.4 plan output the write batches read (`direction.plan`). */
  plan: DirectorPlanOutput;
  /** The Breakdown's shots and windows per block (`direction.breakdown`). */
  breakdown: BreakdownResult["shotsByBlock"];
};

/**
 * The v1.4 plan of a craft run: the Breakdown's blocks under a header built from the shot plan,
 * the look and the bible. Warnings: the film-director's, the Breakdown's, the bible's open
 * questions and dialogue policy (v1.4's preflight wants them named), and the runtime.
 */
export function buildCraftPlan(input: {
  shotPlan: ShotPlan;
  look: Look;
  context: Pick<
    DirectionContext,
    "platform_config" | "block_mode" | "creative_bible" | "asset_registry"
  >;
  title: string;
}): CraftPlan {
  const { shotPlan, look, context } = input;
  const bible = context.creative_bible;
  const frame = bible.project_frame;
  const result = breakdown({
    plan: shotPlan,
    blockMode: context.block_mode,
    platform: context.platform_config,
    registry: context.asset_registry,
    language: frame.script_language,
  });
  const blocks = result.blocks;
  const total = blocks.reduce((s, b) => s + b.duration_s, 0);
  const target = frame.episode_duration_sec ?? frame.total_duration_sec ?? total;
  const deviation = target > 0 ? Math.round((Math.abs(total - target) / target) * 1000) / 10 : 0;

  const warnings: PlanWarning[] = [
    ...shotPlan.warnings.map((w) => ({
      type: (FILM_WARNING_TYPES.has(w.type) ? w.type : "other") as PlanWarning["type"],
      ref: w.ref,
      message: w.message,
    })),
    ...result.warnings.map((w: BreakdownWarning) => ({ ...w })),
  ];
  if (deviation > 10) {
    warnings.push({
      type: "runtime",
      ref: "totals",
      message: `The shot plan runs ${total} s, ${deviation}% from the ${target} s target.`,
    });
  }
  if (bible.validation_status === "needs_user_decision") {
    for (const q of bible.open_questions) {
      warnings.push({
        type: "open_question",
        ref: q.id,
        message: `Open question ${q.id}: the provisional default is used (${q.provisional_default}).`,
      });
    }
  }
  const hasDialogue = shotPlan.shots.some((s) => s.dialogue.length > 0);
  if (frame.dialogue_policy === "none" && hasDialogue) {
    warnings.push({
      type: "dialogue_policy",
      ref: "script",
      message: "The dialogue policy is none but the script has dialogue; it is kept.",
    });
  }

  const scenes = shotPlan.scene_geography;
  const mustSurvive = shotPlan.beats.filter((b) => b.must_survive).map((b) => b.summary.trim());
  const plan: DirectorPlanOutput = {
    dami: "director",
    dami_version: DIRECTOR_OWNER_VERSION,
    creative_bible_ref: {
      genre_id: bible.selection.genre_id,
      style_id: bible.selection.style_id,
      dami_version: bible.dami_version,
    },
    status: warnings.length > 0 ? "ok_with_warnings" : "ok",
    project: {
      title: input.title,
      format: frame.format === "series" ? "series" : "film",
      episode_number: null,
      aspect_ratio:
        frame.orientation === "landscape"
          ? "16:9"
          : frame.orientation === "square"
            ? "1:1"
            : "9:16",
      block_mode: context.block_mode,
    },
    dramatic_analysis: {
      logline: mustSurvive[0] ?? shotPlan.beats[0]?.summary ?? "",
      dramatic_question: "",
      protagonist_want: "",
      turning_points: mustSurvive,
      scenes: scenes.map((g, i) => ({
        scene_id: g.scene_id,
        heading: blocks.find((b) => b.scene_ids.includes(g.scene_id))?.scene_heading ?? g.scene_id,
        dramatic_function: i === 0 ? "setup" : i === scenes.length - 1 ? "release" : "escalation",
        pov_character: g.starting_positions[0]?.character_id ?? "",
        emotional_temperature: 3,
        relationship_start: "",
        relationship_end: "",
      })),
    },
    directors_notes: {
      look: [shotPlan.directors_notes.look_intent.trim(), look.color_contrast_texture.trim()]
        .filter(Boolean)
        .join(" "),
      camera_personality: shotPlan.directors_notes.camera,
      staging_personality: scenes
        .map((g) => g.screen_direction.trim())
        .filter(Boolean)
        .join(" "),
      rhythm_map: shotPlan.directors_notes.rhythm,
      sound_world: shotPlan.directors_notes.sound,
      framing_rules: [look.framing.trim(), look.multi_character_framing.trim()]
        .filter(Boolean)
        .join(" "),
      rules_used: [],
      aesthetic_overrides: [],
    },
    continuity_bible: continuityBibleOf(blocks, context.asset_registry, bible),
    blocks,
    totals: {
      block_count: blocks.length,
      count_15: blocks.filter((b) => b.duration_s === 15).length,
      count_30: blocks.filter((b) => b.duration_s === 30).length,
      total_runtime_s: total,
      target_runtime_s: target,
      deviation_pct: deviation,
    },
    warnings,
  };
  return { plan, breakdown: result.shotsByBlock };
}

/* -------------------------------------------------------------------------- */
/* One write batch                                                             */
/* -------------------------------------------------------------------------- */

function stagingLine(s: FilmShot["staging"][number]): string {
  if (!s.on_screen)
    return `${s.character_id}: off screen${s.relation.trim() ? `, ${s.relation.trim()}` : ""}`;
  return [
    `${s.character_id}: ${s.frame_position}, ${s.depth}`,
    `facing ${s.facing}`,
    s.head.trim() ? `head ${s.head}` : "",
    `eyeline ${s.eyeline}`,
    `sees ${s.sees.length > 0 ? s.sees.join(", ") : "no one"}`,
    s.posture,
    s.relation,
  ]
    .map((t) => t.trim())
    .filter(Boolean)
    .join("; ");
}

function propLine(p: FilmShot["props"][number]): string {
  const held = p.holder_id ? `held by ${p.holder_id}${p.hand ? ` (${p.hand} hand)` : ""}` : "";
  return `${p.prop_id}: ${[held, p.placement.trim()].filter(Boolean).join(", ")}`;
}

/**
 * The shot plan and visual layer of the blocks `from`..`to`. A dialogue line marked `on_screen`
 * whose speaker is not on screen anywhere in its block is passed as `off_screen` (v1.4 hears such a
 * speaker only).
 */
export function writerInputsFor(input: {
  shotPlan: Pick<ShotPlan, "shots">;
  breakdown: CraftPlan["breakdown"];
  plan: Pick<DirectorPlanOutput, "blocks">;
  look: Look;
  scenes: readonly SceneVisual[];
  from: number;
  to: number;
}): { shot_plan: BlockShotPlan[]; visual_layer: VisualLayer } {
  const byId = new Map(input.shotPlan.shots.map((s) => [s.shot_id, s]));
  const blocks = input.breakdown.filter((b) => b.block_id >= input.from && b.block_id <= input.to);
  const shotPlan: BlockShotPlan[] = blocks.map((b) => {
    const onScreen = new Set(
      input.plan.blocks.find((p) => p.block_id === b.block_id)?.assets.characters ?? [],
    );
    const shots: PlannedShot[] = b.shot_ids.map((id) => {
      const shot = byId.get(id);
      if (!shot) throw new Error(`The shot plan has no shot ${id}`);
      return {
        shot_id: shot.shot_id,
        scene_id: shot.scene_id,
        size: shot.size,
        camera: shot.camera,
        staging: shot.staging.map(stagingLine),
        props: shot.props.map(propLine),
        action: shot.action,
        dialogue: shot.dialogue.map((d) =>
          d.heard_as === "on_screen" && !onScreen.has(d.speaker_id)
            ? { ...d, heard_as: "off_screen" as const }
            : d,
        ),
        sound: shot.sound,
        cut_reason: shot.cut_reason,
        start_state: shot.start_state,
        end_state: shot.end_state,
        windows: b.windows
          .filter((w) => w.shot_id === id)
          .map((w) => ({ from_s: w.from_s, to_s: w.to_s })),
      };
    });
    return { block_id: b.block_id, shots };
  });
  const lit = new Map(input.scenes.flatMap((scene) => scene.shots.map((s) => [s.shot_id, s])));
  const visual: VisualLayer = {
    look: lookSummary(input.look),
    shots: blocks.flatMap((b) =>
      b.shot_ids.flatMap((id) => {
        const v = lit.get(id);
        return v ? [{ ...v }] : [];
      }),
    ),
  };
  return { shot_plan: shotPlan, visual_layer: visual };
}
