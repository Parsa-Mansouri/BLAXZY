import type { ReactNode } from "react";
import { DemoHint } from "../DemoHint";
import { cn } from "../cn";
import {
  AnatomyIssueScene,
  AttachedIssueScene,
  BackgroundIssueScene,
  CameraMoveIssueScene,
  ClothingIssueScene,
  ClutterIssueScene,
  ColoursIssueScene,
  ContinuityIssueScene,
  CutOffIssueScene,
  ExtraSubjectIssueScene,
  FaceIssueScene,
  FlickerIssueScene,
  FramingIssueScene,
  GlitchIssueScene,
  LengthBarScene,
  LightingIssueScene,
  LocationIssueScene,
  MatchIssueScene,
  SettingIssueScene,
  ShotSizeIssueScene,
  StaticIssueScene,
  StyleIssueScene,
  TextIssueScene,
  ViewsIssueScene,
} from "./IssueScene";

/*
  Which issue code shows which scene. Keyed by the plain code strings of the catalogues in
  src/server/damis/<fixer>/issues.ts (the kit cannot import them). A code shared by several
  catalogues means the same thing in each, so it has one scene.

  Codes left out on purpose, because no pictogram says them faster than their label:
  wrong_age, wrong_era, wrong_details, action_unclear, dialogue_wrong, tone_off,
  invented_content, wrong_action, object_wrong, audio_off, and every script code except
  too_long / too_short. Do not add a scene that needs its label to be understood.
*/
const SCENES: Readonly<Record<string, () => ReactNode>> = {
  // Pictures (look, sheet, take)
  face_incomplete: () => <FaceIssueScene />,
  face_distorted: () => <FaceIssueScene />,
  anatomy_wrong: () => <AnatomyIssueScene />,
  wrong_clothing: () => <ClothingIssueScene />,
  wrong_colours: () => <ColoursIssueScene />,
  text_or_watermark: () => <TextIssueScene />,
  text_or_labels: () => <TextIssueScene />,
  style_mismatch: () => <StyleIssueScene />,
  background_not_clean: () => <BackgroundIssueScene />,
  wrong_framing: () => <FramingIssueScene />,
  extra_subjects: () => <ExtraSubjectIssueScene />,
  lighting_poor: () => <LightingIssueScene />,
  // Sheets
  inconsistent_views: () => <ViewsIssueScene variant="differs" />,
  proportions_off: () => <ViewsIssueScene variant="scale" />,
  missing_view: () => <ViewsIssueScene variant="missing" />,
  differs_from_look: () => <MatchIssueScene />,
  layout_cluttered: () => <ClutterIssueScene />,
  // Shot blocks
  wrong_assets: () => <AttachedIssueScene variant="wrong" />,
  missing_asset: () => <AttachedIssueScene variant="missing" />,
  wrong_camera: () => <ShotSizeIssueScene />,
  too_much_happening: () => <LengthBarScene over />,
  continuity_break: () => <ContinuityIssueScene />,
  wrong_setting: () => <SettingIssueScene />,
  // Takes
  character_mismatch: () => <MatchIssueScene />,
  motion_glitch: () => <GlitchIssueScene />,
  wrong_location: () => <LocationIssueScene />,
  wrong_camera_move: () => <CameraMoveIssueScene />,
  too_static: () => <StaticIssueScene />,
  cut_off_early: () => <CutOffIssueScene />,
  flicker: () => <FlickerIssueScene />,
  // Script
  too_long: () => <LengthBarScene over />,
  too_short: () => <LengthBarScene over={false} />,
};

/** Every issue code that has a scene. */
export const ISSUE_SCENE_CODES: readonly string[] = Object.keys(SCENES);

/** The scene for an issue code, or null when the issue has none (most non-visual ones). */
export function issueScene(code: string): ReactNode | null {
  return Object.hasOwn(SCENES, code) ? (SCENES[code]?.() ?? null) : null;
}

export interface IssueDemoProps {
  /** An issue code from one of the fix catalogues. */
  code: string;
  className?: string;
}

/**
 * The small picture of an issue inside its chip or row: a fixed 24px box holding a hover-only
 * demo hint. Renders nothing for a code without a scene. Give the chip the `demo-host` class
 * (it is the hover/focus target) when `issueScene(code)` is not null:
 *
 *   <button className={cn(chip, issueScene(code) && "demo-host")}>
 *     <IssueDemo code={code} /> {label}
 *   </button>
 */
export function IssueDemo({ code, className }: IssueDemoProps) {
  const scene = issueScene(code);
  if (scene === null) return null;
  return (
    <span className={cn("demo-issue-slot", className)}>
      <DemoHint trigger="hover" mask="none">
        {scene}
      </DemoHint>
    </span>
  );
}
