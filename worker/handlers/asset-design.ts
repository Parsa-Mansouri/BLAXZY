/**
 * The designers from the worker: the input of the character, location or prop generator for one
 * look (create mode, or fix mode with the rejected look's answer and the review's fix requests),
 * and what their answer means for the look: an image to generate (prompt + spec), the user's own
 * photo as the Hero, a blocking question, or a refusal the user reads.
 */
import type { DesignContext, LookJobContext } from "../../src/server/assets";
import {
  ADVANCED_PREFIX,
  AI_DECIDES,
  CHARACTER_DETAIL_FIELDS,
  characterGenerator,
  designerFor,
  designerProject,
  isLocationFix,
  isPropFix,
  LOCATION_FIX_EFFORT,
  locationGenerator,
  LOOK_FRAMES,
  notAProp,
  noteOutsideRequests,
  PROP_FIX_EFFORT,
  propGenerator,
  runDami,
  type CharacterDetailField,
  type CharacterGeneratorInput,
  type CharacterGeneratorOutput,
  type DesignerFixRequest,
  type DesignerKey,
  type LocationGeneratorInput,
  type LocationGeneratorOutput,
  type PropAdvancedField,
  type PropGeneratorInput,
  type PropGeneratorOutput,
} from "../../src/server/damis";
import type {
  LookAspectRatio,
  LookReference,
  LookSpec,
  ProjectStyle,
  ReviewFixRequest,
} from "../../src/server/db/schema";

export type DesignOutcome =
  | { kind: "generate"; prompt: string; spec: LookSpec; runId: string }
  | { kind: "uploaded"; fileId: string; spec: LookSpec; runId: string }
  | { kind: "question"; spec: LookSpec; runId: string }
  | { kind: "refused"; message: string; runId: string };

export type DesignRunContext = { userId: string; projectId: string; signal: AbortSignal };

/** What a fix round answers: the rejected look and its review (null on a first design). */
type FixRound = {
  previousPrompt: string | null;
  previousOutput: Record<string, unknown>;
  requests: DesignerFixRequest[];
  notes: string[];
};

const frameLabel = (designer: DesignerKey, viewId: string | undefined) =>
  viewId ? LOOK_FRAMES[designer].find((f) => f.id === viewId)?.label : undefined;

/** The review's fix requests as the designers take them (the view folded into the text). */
function designerRequests(
  designer: DesignerKey,
  requests: readonly ReviewFixRequest[],
): DesignerFixRequest[] {
  return requests.map((r) => {
    const where = frameLabel(designer, r.viewId);
    return {
      type: r.type,
      code: r.code,
      instruction: where
        ? `${r.instruction} (This is about ${where.toLowerCase()}.)`
        : r.instruction,
      ...(r.customText ? { customText: r.customText } : {}),
    };
  });
}

function sameReferences(a: readonly LookReference[], b: readonly LookReference[]): boolean {
  return (
    a.length === b.length && a.every((r, i) => r.fileId === b[i]?.fileId && r.role === b[i]?.role)
  );
}

/** The fix round of a look, when it answers a rejected one that a designer wrote. */
export function fixRoundOf(ctx: LookJobContext, designer: DesignerKey): FixRound | null {
  const { look, parent, review } = ctx;
  if (!parent || parent.status !== "rejected" || !review || !parent.spec) return null;
  const notes: string[] = [];
  const extra = noteOutsideRequests(review.note, review.fixRequests);
  if (extra) notes.push(extra);
  // Older reviews have issue codes only: pass them on as words.
  if (review.fixRequests.length === 0 && review.issueCodes.length > 0 && !review.note) {
    notes.push(`Fix: ${review.issueCodes.join(", ").replaceAll("_", " ")}.`);
  }
  const clarifyChanged =
    JSON.stringify(look.clarifyAnswers ?? {}) !== JSON.stringify(parent.clarifyAnswers ?? {});
  if (clarifyChanged)
    notes.push("The user answered your clarifying questions: apply clarify_answers.");
  if (!sameReferences(look.references, parent.references)) {
    notes.push(
      "The reference photos changed: use only the ones attached now, in their order and roles.",
    );
  }
  return {
    previousPrompt: parent.prompt,
    previousOutput: parent.spec.output,
    requests: designerRequests(designer, review.fixRequests),
    notes,
  };
}

function project(style: ProjectStyle) {
  return designerProject(style);
}

const fileAt = (refs: readonly LookReference[], index: number) => refs[index - 1]?.fileId;

function baseSpec(
  generator: LookSpec["generator"],
  aspectRatio: LookAspectRatio,
  referenceFileIds: string[],
  output: Record<string, unknown>,
  common: {
    styleUsed: string;
    styleSource: string;
    summary: string;
    assumptions: string[];
    warnings: string[];
    appliedFixes: { code: string; change: string }[];
  },
): LookSpec {
  return {
    generator,
    aspectRatio,
    referenceFileIds,
    ...common,
    fields: [],
    questions: [],
    output,
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Character                                                                                   */
/* ------------------------------------------------------------------------------------------ */

function characterDetails(answers: Record<string, string> | null) {
  const details: Partial<Record<CharacterDetailField, string>> = {};
  for (const field of CHARACTER_DETAIL_FIELDS) {
    const value = answers?.[field]?.trim();
    if (value && value !== AI_DECIDES) details[field] = value;
  }
  return details;
}

export function characterInput(ctx: LookJobContext, fix: FixRound | null): CharacterGeneratorInput {
  const { look, asset } = ctx;
  const style = ctx.project.style as ProjectStyle;
  const d = asset.details ?? {};
  const notes = fix ? fix.notes : look.userPrompt ? [look.userPrompt] : [];
  return {
    project: project(style),
    character: {
      name: asset.name,
      ...(d.role ? { role: d.role } : {}),
      ...(asset.description ? { description: asset.description } : {}),
      ...(d.subkind ? { kind: d.subkind } : asset.kind === "creature" ? { kind: "creature" } : {}),
      details: characterDetails(look.guidedAnswers),
      facts: (d.facts ?? []).slice(0, 40).map((f) => `${f.field}: ${f.value}`.slice(0, 400)),
      ...(d.isMinor === "yes" ? { isMinor: true } : {}),
    },
    referenceImages: look.references.map((r) => ({
      fileId: r.fileId,
      role: r.role as "face" | "outfit" | "full_body" | "other",
      ...(r.note ? { note: r.note } : {}),
    })),
    ...(notes.length > 0 ? { userNotes: notes.join("\n\n").slice(0, 4000) } : {}),
    ...(fix?.previousPrompt
      ? { previousPrompt: fix.previousPrompt, fixRequests: fix.requests }
      : {}),
  };
}

function characterOutcome(
  output: CharacterGeneratorOutput,
  input: CharacterGeneratorInput,
  runId: string,
): DesignOutcome {
  const refs = input.referenceImages ?? [];
  if (!output.image_prompt.trim()) {
    return {
      kind: "refused",
      message:
        output.warnings[0] ?? "There is not enough to design this character. Describe them first.",
      runId,
    };
  }
  const { image_prompt: prompt, ...rest } = output;
  const files = output.reference_order
    .map((r) => refs[r.index - 1]?.fileId)
    .filter((f): f is string => f !== undefined);
  return {
    kind: "generate",
    prompt,
    runId,
    spec: baseSpec("character-generator", "16:9", files, rest, {
      styleUsed: output.style_used,
      styleSource: output.style_source,
      summary: output.environment_used,
      assumptions: output.assumptions,
      warnings: output.warnings,
      appliedFixes: output.applied_fixes,
    }),
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Location                                                                                    */
/* ------------------------------------------------------------------------------------------ */

export function locationInput(
  ctx: LookJobContext,
  design: DesignContext,
  fix: FixRound | null,
): LocationGeneratorInput {
  const { look, asset } = ctx;
  const style = ctx.project.style as ProjectStyle;
  const d = asset.details ?? {};
  const previousOutput = fix
    ? {
        ...fix.previousOutput,
        hero_wide: {
          ...((fix.previousOutput.hero_wide as Record<string, unknown> | undefined) ?? {}),
          image_prompt: fix.previousPrompt ?? "",
        },
      }
    : undefined;
  return {
    project: project(style),
    location: {
      name: asset.name,
      ...(d.interiorExterior ? { interiorExterior: d.interiorExterior } : {}),
      ...(d.timeOfDay && d.timeOfDay !== "unspecified" ? { timeOfDay: d.timeOfDay } : {}),
      scriptDescription: asset.description ?? "",
      sceneRefs: (d.sceneRefs ?? []).slice(0, 200),
    },
    ...(design.script.scenes.length > 0 || design.script.logline
      ? { scriptContext: design.script }
      : {}),
    ...(look.userPrompt ? { userPrompt: look.userPrompt } : {}),
    ...(look.guidedAnswers ? { guidedAnswers: look.guidedAnswers } : {}),
    referenceImages: look.references.map((r) => ({
      fileId: r.fileId,
      role: r.role as "hero" | "layout" | "mood" | "detail" | "other",
      ...(r.note ? { note: r.note } : {}),
    })),
    outputMode: "lock",
    excludeAssets: design.excludeAssets.filter((n) => n !== asset.name),
    ...(fix
      ? {
          previousOutput,
          fixRequests: fix.requests,
          ...(fix.notes.length > 0 ? { userNotes: fix.notes.join("\n\n").slice(0, 4000) } : {}),
        }
      : {}),
  };
}

function locationOutcome(
  output: LocationGeneratorOutput,
  input: LocationGeneratorInput,
  runId: string,
): DesignOutcome {
  const refs = input.referenceImages ?? [];
  const hero = output.hero_wide;
  const { image_prompt: prompt, ...heroRest } = hero;
  const stored: Record<string, unknown> = { ...output, hero_wide: heroRest };
  const files = hero.reference_order
    .map((r) => refs[r.index - 1]?.fileId)
    .filter((f): f is string => f !== undefined);
  const spec: LookSpec = {
    ...baseSpec("location-generator", "16:9", files, stored, {
      styleUsed: output.style_used,
      styleSource: output.style_source,
      summary: output.location_summary,
      assumptions: output.assumptions,
      warnings: output.warnings,
      appliedFixes: output.applied_fixes.map((code) => ({ code, change: "" })),
    }),
    heroMode: hero.mode,
    fields: output.spec_fields,
  };
  if (hero.mode === "use_uploaded") {
    const upload = refs.find((r) => r.role === "hero")?.fileId;
    if (upload) return { kind: "uploaded", fileId: upload, spec, runId };
  }
  if (!prompt.trim()) {
    return {
      kind: "refused",
      message: output.warnings[0] ?? "There is not enough to design this place. Describe it first.",
      runId,
    };
  }
  return { kind: "generate", prompt, spec, runId };
}

/* ------------------------------------------------------------------------------------------ */
/* Prop                                                                                        */
/* ------------------------------------------------------------------------------------------ */

function propAnswers(answers: Record<string, string> | null): PropGeneratorInput["guidedAnswers"] {
  if (!answers) return undefined;
  const out: NonNullable<PropGeneratorInput["guidedAnswers"]> = {};
  const advanced: Partial<Record<PropAdvancedField, string>> = {};
  for (const [key, value] of Object.entries(answers)) {
    if (!value.trim()) continue;
    if (key.startsWith(ADVANCED_PREFIX)) {
      advanced[key.slice(ADVANCED_PREFIX.length) as PropAdvancedField] = value;
    } else if (
      key === "what_is_it" ||
      key === "importance" ||
      key === "usage" ||
      key === "scale" ||
      key === "must_keep"
    ) {
      out[key] = value;
    }
  }
  if (Object.keys(advanced).length > 0) out.advanced = advanced;
  return out;
}

export function propInput(
  ctx: LookJobContext,
  design: DesignContext,
  fix: FixRound | null,
): PropGeneratorInput {
  const { look, asset } = ctx;
  const style = ctx.project.style as ProjectStyle;
  const d = asset.details ?? {};
  const answers = propAnswers(look.guidedAnswers);
  const previousOutput = fix
    ? {
        ...fix.previousOutput,
        hero_view: fix.previousOutput.hero_view
          ? {
              ...(fix.previousOutput.hero_view as Record<string, unknown>),
              image_prompt: fix.previousPrompt ?? "",
            }
          : null,
      }
    : undefined;
  return {
    asset: {
      name: asset.name,
      ...(d.categoryHint ? { categoryHint: d.categoryHint } : {}),
      scriptDescription: asset.description ?? "",
      sceneRefs: (d.sceneRefs ?? []).slice(0, 200),
    },
    project: project(style),
    ...(look.userPrompt ? { userPrompt: look.userPrompt } : {}),
    ...(answers ? { guidedAnswers: answers } : {}),
    referenceImages: look.references.map((r) => ({
      fileId: r.fileId,
      role: r.role as "identity" | "material" | "detail" | "mood" | "other",
      ...(r.note ? { note: r.note } : {}),
    })),
    ...(design.script.scenes.length > 0 || design.script.logline
      ? { scriptContext: design.script }
      : {}),
    linkedCharacters: design.linkedCharacters,
    linkedLocations: design.linkedLocations,
    ...(look.clarifyAnswers ? { clarifyAnswers: look.clarifyAnswers } : {}),
    ...(fix
      ? {
          previousOutput,
          fixRequests: fix.requests,
          ...(fix.notes.length > 0 ? { userNotes: fix.notes.join("\n\n").slice(0, 4000) } : {}),
        }
      : {}),
    sector: "wizard",
  };
}

function propOutcome(
  output: PropGeneratorOutput,
  input: PropGeneratorInput,
  runId: string,
): DesignOutcome {
  const refs = input.referenceImages ?? [];
  const heroes = new Map(
    (input.linkedLocations ?? []).flatMap((l) => (l.heroFileId ? [[l.name, l.heroFileId]] : [])),
  );
  const hero = output.hero_view;
  let heroRest: Record<string, unknown> | null = null;
  if (hero) {
    const { image_prompt: _prompt, ...rest } = hero;
    void _prompt;
    heroRest = rest;
  }
  const stored: Record<string, unknown> = { ...output, hero_view: heroRest };
  const files = (hero?.reference_order ?? [])
    .map((r) => {
      const user = /^user_reference:(\d+)$/.exec(r.source);
      if (user) return fileAt(refs as LookReference[], Number(user[1]));
      const location = /^location_hero:(.+)$/.exec(r.source);
      return location ? heroes.get(location[1] ?? "") : undefined;
    })
    .filter((f): f is string => f !== undefined);
  const spec: LookSpec = {
    ...baseSpec("prop-generator", hero?.aspect_ratio ?? "1:1", files, stored, {
      styleUsed: output.style_used,
      styleSource: output.style_source,
      summary: output.dna.object_type,
      assumptions: output.assumptions,
      warnings: output.warnings,
      appliedFixes: output.applied_fixes,
    }),
    fields: output.spec_fields,
    questions: output.clarifying_questions,
    changesIdentity: output.changes_identity,
  };
  if (!hero) {
    if (output.clarifying_questions.some((q) => q.blocking)) {
      return { kind: "question", spec, runId };
    }
    const tag = output.warnings.find((w) => w.startsWith("NOT_A_PROP:"));
    return {
      kind: "refused",
      message: notAProp(output)
        ? `${(tag ?? "").replace(/^NOT_A_PROP:\s*/, "")} Add it as a location instead.`.trim()
        : (output.warnings[0] ?? "There is not enough to design this object. Describe it first."),
      runId,
    };
  }
  return { kind: "generate", prompt: hero.image_prompt, spec, runId };
}

/* ------------------------------------------------------------------------------------------ */
/* Running                                                                                     */
/* ------------------------------------------------------------------------------------------ */

/** Runs the asset's designer for a look and says what its answer means. */
export async function runDesigner(
  ctx: LookJobContext,
  design: DesignContext,
  run: DesignRunContext,
  /** The project's Creative Bible block for the designer (`asset_generation`), when it has one. */
  creativeDna?: string,
): Promise<DesignOutcome> {
  const dna = creativeDna ? { creativeDna } : {};
  const designer = designerFor(ctx.asset.kind);
  if (!designer) throw new Error(`no designer for ${ctx.asset.kind}`);
  const fix = fixRoundOf(ctx, designer);
  switch (designer) {
    case "character": {
      const input = { ...characterInput(ctx, fix), ...dna };
      const result = await runDami(characterGenerator, input, run);
      return characterOutcome(result.output, input, result.runId);
    }
    case "location": {
      const input = { ...locationInput(ctx, design, fix), ...dna };
      const parsed = locationGenerator.input.parse(input);
      const result = await runDami(locationGenerator, input, {
        ...run,
        ...(isLocationFix(parsed) ? { effort: LOCATION_FIX_EFFORT } : {}),
      });
      return locationOutcome(result.output, input, result.runId);
    }
    case "prop": {
      const input = { ...propInput(ctx, design, fix), ...dna };
      const parsed = propGenerator.input.parse(input);
      const result = await runDami(propGenerator, input, {
        ...run,
        ...(isPropFix(parsed) ? { effort: PROP_FIX_EFFORT } : {}),
      });
      return propOutcome(result.output, input, result.runId);
    }
  }
}
