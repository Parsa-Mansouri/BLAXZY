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

Contract in `docs/M2_M3_CONTRACTS.md`. Owns `asset`, `asset_look`, `asset_sheet` and
`asset_sheet_view`.

- `stage.ts`: `deriveAssetState(kind, latestLook, latestSheet)`, the one definition of an asset's
  stage (`needs_image` / `needs_recording` → `generating` → `look_review` → `building_sheet` →
  `sheet_review` → `ready`, `needs_answer` when the prop designer asked a blocking question, or
  `failed` with the part that failed) and of `busy`.
- `preproduction.ts`: the services the screens call. One look or sheet in flight per asset (the
  project row, then the asset row, is locked); guided answers are checked against the asset's
  remaining questions (`designerQuestions`); reference photos must be ready, owned images with a
  role the asset's designer reads (at most four). Voices are accepted on upload and get no sheet;
  image uploads are references, never the look itself. Look reviews turn catalog picks into
  `fix_requests`; a location's or prop's critical inferred spec fields must be confirmed before
  Accept. A prop that stands in a location still being designed waits (no job) until that
  location's look is accepted or fails, or the location is removed, merged away, skipped or
  dropped by the detector (`wakeWaitingLooks`, on that change's transaction), or the user starts it
  anyway (`canStartWithoutWaiting`). Removed assets cannot be worked on; a removal by the user is
  recorded (`details.removedBy`) and never undone by a detection. Reviews go to `review` with the
  dami run that wrote the prompt. Every job is sent on the transaction that writes its row (see
  the jobs README); a send that fails rolls the change back. Retries keep the failed attempt's
  generation and failure in their event.
- Lock order (every writer here and in `detection-store.ts`): the project row
  (`FOR NO KEY UPDATE`), then asset rows, then a sheet before its views. The worker's pack advance
  takes a sheet (shared) then a view; the generation hook single rows.
- `designs.ts`, `design-context.ts`: the designers' questions, reference checks, waiting props,
  and (worker only) the script slice, excluded assets and linked characters and locations a
  designer reads.
- `jobs.ts` (worker only): what the `asset.look.generate|fix` and `asset.sheet.generate|fix`
  (character sheets) handlers need, and `applyGenerationResult`, the generation completion hook registered in
  `worker/index.ts`. A look job runs the asset's designer only when no prompt is stored and stores
  its prompt and spec (or a question, or the user's photo as the Hero), then requests the
  generation with the designer's ratio and photos (a character sheet attaches the files of its
  reference order: the approved board, and the previous sheet in edit mode); a
  retry clears the failed generation and requests a new one. The hook only changes a `pending`
  row holding that generation, so it is safe to call any number of times.
- `packs.ts`: location packs and prop sheets. A pack is one `asset_sheet` (its `spec` is the
  plan) and append-only `asset_sheet_view` rows. The worker side stores the plan
  (`asset.sheet.plan`), re-writes a rejected view, requests every planned view whose dependencies
  are approved (`asset.sheet.views.advance`, after planning, a settled image and an approval) and
  assembles the locked pack's contact sheet (`asset.sheet.assemble`, sharp). `packLockGate` is
  the owner's lock rule; `dnaCardOf` the DNA card the screens show. View reviews, retries and the
  lock are in `preproduction.ts` (`submitSheetViewReview`, `retrySheetView`, `lockSheet`).
- `references.ts`: Production's references. A character is attached with its accepted sheet; a
  location or prop with its approved Hero, and a locked pack's approved views are listed in
  `ReferenceAsset.views`.
- Merging rewrites the current blocks' `assetRefs` through `rewriteAssetRefs` in `@/server/blocks`
  (new block versions, old ones superseded).

Development: `pnpm worker` and `pnpm dev:preprod-flow [email]`.
