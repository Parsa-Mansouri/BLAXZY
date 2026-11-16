/**
 * The Prop Sheet Generator's request, assembled as the owner's file says:
 * `SYSTEM = CORE + OBJECT_ORIENTATION + VIEW_LIBRARY + STUDIO_STANDARD + OBJECT_TEXT_RULE`. The
 * user message is the approved images (the Hero first), then the user's original photos, then the
 * owner's JSON template filled in.
 */
import type { DamiPrompt } from "../framework/define";
import {
  PROP_OBJECT_ORIENTATION,
  PROP_OBJECT_TEXT_RULE,
  PROP_STUDIO_STANDARD,
  PROP_VIEW_LIBRARY,
} from "../prop-shared/modules";
import { withCreativeDna } from "../shared/creative-dna-input";
import { designerMessage } from "../shared/designer";
import { PROP_SHEET_CORE } from "./prompt-text";
import type { PropSheetParsedInput } from "./schema";

export { PROP_SHEET_CORE };

export function propSheetInputJson(input: PropSheetParsedInput): Record<string, unknown> {
  const approved = input.approvedImages.length;
  return {
    locked_spec: input.lockedSpec,
    approved_images: input.approvedImages.map((a, i) => ({ index: i + 1, view_id: a.viewId })),
    user_reference_images: input.userReferenceImages.map((r, i) => ({
      index: approved + i + 1,
      role: r.role,
      ...(r.note ? { note: r.note } : {}),
    })),
    linked_characters: input.linkedCharacters.map((c) => ({
      character_id: c.name,
      age_group: c.ageGroup,
      build: c.build,
      handedness: c.handedness,
    })),
    project: {
      style: input.project.style,
      style_descriptor: input.project.styleDescriptor ?? null,
      genre: input.project.genre,
      era_setting: input.project.eraSetting ?? "",
      ui_language: input.project.uiLanguage,
    },
    sheet_level_override: input.sheetLevelOverride ?? null,
    previous_output: input.previousOutput ?? null,
    fix_requests: input.fixRequests.map((r) => ({
      code: r.code,
      instruction: r.instruction,
      ...(r.note ? { note: r.note } : {}),
      view_id: r.viewId,
      edit_eligible: r.editEligible,
    })),
    user_notes: input.userNotes ?? null,
  };
}

export function buildPropSheetPrompt(input: PropSheetParsedInput): DamiPrompt {
  const system = [
    PROP_SHEET_CORE,
    PROP_OBJECT_ORIENTATION,
    PROP_VIEW_LIBRARY,
    PROP_STUDIO_STANDARD,
    PROP_OBJECT_TEXT_RULE,
  ].join("\n\n");
  return {
    system: withCreativeDna([{ text: system, cache: true }], input.creativeDna),
    messages: designerMessage(
      [
        ...input.approvedImages.map((a) => a.fileId),
        ...input.userReferenceImages.map((r) => r.fileId),
      ],
      JSON.stringify(propSheetInputJson(input), null, 2),
    ),
  };
}
