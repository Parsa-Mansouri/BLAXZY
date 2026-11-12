# assets

Assets (Output_021) come from the owner's Asset Detector v1. `detection.ts` is the dami boundary:
`detectorView` gives stored assets the run's temporary ids (`char_1`, `loc_1` ...) as `known_assets`
and `previous_output`; `planDetection` maps the answer back to real names. `detection-store.ts`
applies it (`applyDetection`: names never change, new names are unique, approved assets are never
silently removed, skipped stays skipped, legacy creature/costume/other rows are untouched) and
records it in the append-only `asset_detection` table. The category screens' review loop
(`getDetectionPanel`, `submitDetectionReview`) runs the owner's catalog: ADP01 skips at once,
ADR01 re-scans and the dami fixes run as `asset.detect.fix`.

## Pre-production (Output_030)

Contract in `docs/M2_M3_CONTRACTS.md`. Owns `asset`, `asset_look` and `asset_sheet`.

- `stage.ts`: `deriveAssetState(kind, latestLook, latestSheet)`, the one definition of an asset's
  stage (`needs_image` / `needs_recording` → `generating` → `look_review` → `building_sheet` →
  `sheet_review` → `ready`, `needs_answer` when the prop designer asked a blocking question, or
  `failed` with the part that failed) and of `busy`.
- `preproduction.ts`: the services the screens call. One look or sheet in flight per asset (the
  asset row is locked); guided answers are checked against the asset's remaining questions
  (`designerQuestions`); reference photos must be ready, owned images with a role the asset's
  designer reads (at most four). Voices are accepted on upload and get no sheet; image uploads are
  references, never the look itself. Look reviews turn catalog picks into `fix_requests`; a
  location's or prop's critical inferred spec fields must be confirmed before Accept. A prop that
  stands in a location still being designed waits (no job) until that location's look is accepted,
  fails or is removed (`wakeWaitingLooks`), or the user starts it anyway. Removed assets cannot be
  worked on. Reviews go to `review` with the dami run that wrote the prompt. Jobs are enqueued
  after commit.
- `designs.ts`, `design-context.ts`: the designers' questions, reference checks, waiting props,
  and (worker only) the script slice, excluded assets and linked characters and locations a
  designer reads.
- `jobs.ts` (worker only): what the `asset.look.generate|fix` and `asset.sheet.generate|fix`
  handlers need, and `applyGenerationResult`, the generation completion hook registered in
  `worker/index.ts`. A look job runs the asset's designer only when no prompt is stored and stores
  its prompt and spec (or a question, or the user's photo as the Hero), then requests the
  generation with the designer's ratio and photos (sheets attach the accepted look's file); a
  retry clears the failed generation and requests a new one. The hook only changes a `pending`
  row holding that generation, so it is safe to call any number of times.
- Merging rewrites the current blocks' `assetRefs` through `rewriteAssetRefs` in `@/server/blocks`
  (new block versions, old ones superseded).

Development: `pnpm worker` and `pnpm dev:preprod-flow [email]`.
