/*
  Demo scenes: what plays inside a <DemoHint>. One file per scene.

  The pattern every scene follows:
  - A plain function component: no hooks, no "use client", so it renders on the server. Props
    are data only (strings, a variant). Timing maths lives in a pure, tested helper
    (../demo-hint-text.ts), never in the component.
  - The root is `<span className="demo-scene demo-<scene>">`. Scenes sit inside buttons and
    links, so use only <span> and inline <svg>, never <div> or <p>.
  - Its classes are `demo-<scene>-<part>` and its keyframes `demo-<scene>-<move>`, in the
    "Demo hints" section of src/app/globals.css. Per-element timing goes in `--demo-*` custom
    properties set in `style`.
  - Animate transform (translate / rotate / scale) and opacity only, on the app curve or in
    steps, and never shorter than about 80ms (shorter ones are painted late). Every animation
    runs a fixed number of times (never `infinite`) and fills `both`
    (`forwards` for a second animation on the same element).
  - The LAST keyframe is the still frame: what the card rests on after a pass, what a
    `trigger="hover"` hint shows before it is hovered, and all that reduced motion ever shows.
    Make it the meaningful picture (the prompt typed, the thumbnail on the card).
  - Tokens only. Draw in `currentColor` (the hint sets it to --demo-ink, label-4 by default) so
    the scene reads as a watermark; the brand colour only where the real control shows it.
  - Lay out from `var(--demo-pad)` (the card's padding, 24px by default) and keep clear of the
    card's label: DemoHint fades the scene towards it with `mask`.

  Then export the scene here and from src/ui/index.ts, and add it to "Demo Hints" in /dev/ui.
*/
export { TypingScene } from "./TypingScene";
export type { TypingSceneProps } from "./TypingScene";
export { DropScene } from "./DropScene";
export type { DropSceneProps } from "./DropScene";
export { SilhouetteScene } from "./SilhouetteScene";
export type { SilhouetteSceneProps } from "./SilhouetteScene";
export { WaveformScene } from "./WaveformScene";
export type { WaveformSceneProps } from "./WaveformScene";
export { LengthBarScene, BlockSwapScene } from "./IssueScene";
export type { LengthBarSceneProps, BlockSwapSceneProps } from "./IssueScene";
export { IssueDemo, issueScene, ISSUE_SCENE_CODES } from "./issues";
export type { IssueDemoProps } from "./issues";
