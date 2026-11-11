# assets

Assets (Output_021) detected from the accepted script, applied as a diff by `(kind, slug)`.
Manual assets are never changed by detection; assets no longer in the script become `removed`.

## Pre-production (Output_030)

Contract in `docs/M2_M3_CONTRACTS.md`. Owns `asset`, `asset_look` and `asset_sheet`.

- `stage.ts`: `deriveAssetState(kind, latestLook, latestSheet)`, the one definition of an asset's
  stage (`needs_image` / `needs_recording` → `generating` → `look_review` → `building_sheet` →
  `sheet_review` → `ready`, or `failed` with the part that failed) and of `busy`.
- `preproduction.ts`: the services the screens call. One look or sheet in flight per asset (the
  asset row is locked); guided answers are checked against `ASSET_QUESTIONS[kind]`; uploads must
  be ready, owned and an image (an audio file for voices). Voices are accepted on upload and get
  no sheet. Removed assets cannot be worked on. Reviews go to `review` with the dami run that wrote
  the prompt. Jobs are enqueued after commit.
- `jobs.ts` (worker only): what the `asset.look.generate|fix` and `asset.sheet.generate|fix`
  handlers need, and `applyGenerationResult`, the generation completion hook registered in
  `worker/index.ts`. A job writes the prompt with a dami only when none is stored, then requests
  the generation (sheets attach the accepted look's file); a retry clears the failed generation
  and requests a new one. The hook only changes a `pending` row holding that generation, so it is
  safe to call any number of times.
- Merging rewrites the current blocks' `assetRefs` through `rewriteAssetRefs` in `@/server/blocks`
  (new block versions, old ones superseded).

Development: `pnpm worker` and `pnpm dev:preprod-flow [email]`.
