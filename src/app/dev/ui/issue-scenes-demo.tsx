import { BlockSwapScene, DemoHint, IssueDemo, cn, issueScene } from "@/ui";

/**
 * Every issue code of the fix pickers, by catalogue (src/server/damis/<fixer>/issues.ts). Codes
 * without a scene are listed too, so the gaps are visible.
 */
const CATALOGUES: readonly { name: string; codes: readonly string[] }[] = [
  {
    name: "Look (asset image)",
    codes: [
      "face_incomplete",
      "anatomy_wrong",
      "wrong_age",
      "wrong_clothing",
      "wrong_era",
      "wrong_details",
      "wrong_colours",
      "text_or_watermark",
      "style_mismatch",
      "background_not_clean",
      "wrong_framing",
      "extra_subjects",
      "lighting_poor",
    ],
  },
  {
    name: "Sheet",
    codes: [
      "face_incomplete",
      "anatomy_wrong",
      "wrong_age",
      "wrong_clothing",
      "wrong_era",
      "text_or_labels",
      "style_mismatch",
      "background_not_clean",
      "inconsistent_views",
      "proportions_off",
      "missing_view",
      "wrong_framing",
      "differs_from_look",
      "layout_cluttered",
    ],
  },
  {
    name: "Shot block",
    codes: [
      "wrong_assets",
      "missing_asset",
      "wrong_camera",
      "action_unclear",
      "dialogue_wrong",
      "too_much_happening",
      "continuity_break",
      "tone_off",
      "wrong_setting",
      "invented_content",
    ],
  },
  {
    name: "Take",
    codes: [
      "face_distorted",
      "character_mismatch",
      "anatomy_wrong",
      "wrong_action",
      "motion_glitch",
      "wrong_location",
      "object_wrong",
      "text_or_watermark",
      "wrong_camera_move",
      "audio_off",
      "too_static",
      "cut_off_early",
      "style_mismatch",
      "flicker",
    ],
  },
  { name: "Script (length only)", codes: ["too_long", "too_short"] },
];

/** The issue scenes as they sit in a chip, plus the block swap. Hover or focus a chip to play. */
export function IssueScenesDemo() {
  return (
    <div className="flex flex-col gap-6">
      <span className="text-secondary text-label-2">
        Issue scenes: each rests on the problem and shows the fix on hover or focus. Codes without a
        clear picture stay words only.
      </span>
      {CATALOGUES.map((catalogue) => (
        <div key={catalogue.name} className="flex flex-col gap-3">
          <span className="caps-label text-label-2">{catalogue.name}</span>
          <div className="flex flex-wrap gap-2">
            {catalogue.codes.map((code) => {
              const has = issueScene(code) !== null;
              return (
                <button
                  key={code}
                  type="button"
                  className={cn(
                    "inline-flex min-h-(--btn-sm) items-center gap-1.5 rounded-capsule border border-outline px-3.5 text-secondary font-medium focus-ring hover:bg-fill-4 hover:text-label",
                    has ? "demo-host pl-2.5 text-label-2" : "text-label-3",
                  )}
                >
                  <IssueDemo code={code} />
                  {code}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex flex-col gap-3">
        <span className="caps-label text-label-2">Block swap (beside “What should change?”)</span>
        <div className="demo-host flex max-w-120 items-center justify-between gap-6">
          <p className="text-heading-sm">What should change?</p>
          <span className="demo-blockswap-slot">
            <DemoHint mask="none">
              <BlockSwapScene />
            </DemoHint>
          </span>
        </div>
      </div>
    </div>
  );
}
