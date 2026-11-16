# M4 contracts: Production stage

The interfaces every work package of this step builds against. Conventions are those of
`docs/M1_CONTRACTS.md` and `docs/M2_M3_CONTRACTS.md`. Tables and columns are in
`src/server/db/schema.ts` (migration `0003`): `block_take`, `export_bundle`, and on
`prompt_block`: `productionState`, `productionPrompt`, `productionAssetRefs`, `productionNotes`,
`productionDamiRunId`, `productionFailure`, `approvedAt`.

**Money rule for everyone working on this step:** `.env` holds a real Anthropic API key that must
never be used. `DAMI_MODE=sample` stays set; nobody sets it to `live`, runs `pnpm dami:run`, or
calls the Claude API.

## Flow

1. Entering Production prepares every current block (code, no dami: the Director already wrote the prompt): the block's prompt is
   rewritten with each asset mention bound to a reference token, and the block's assets are listed
   in token order.
2. The user reviews the prepared blocks: approve, correct the assets, or request changes.
3. The user confirms the total price; one **draft** take is generated per approved block.
4. The user reviews each draft: accept (a **final** take is generated from that exact draft) or
   request changes (a fixed draft is generated).
5. The user reviews each final: accept, or request changes (back to a new draft).
6. Every block has an accepted final → the project is `done`. Clips can be downloaded one by
   one, or all together as a ZIP.

Derived state of a block (one pure, unit-tested function):

```ts
type BlockProductionStage =
  | "preparing" | "prepare_failed" | "block_review" | "approved"
  | "draft_generating" | "draft_review" | "final_generating" | "final_review"
  | "done" | "failed";            // failed = the latest take failed (retry available)
```

## Engine additions: `@/server/providers`, `@/server/generation`

- `requestGeneration` accepts `block_draft` and `block_final`. New optional input
  `draftGenerationId` (for `block_final`: the generation of the accepted draft; passed to the
  provider as `request.draftProviderJobId` so a real provider can finish the same video).
- `GenerationRequest.params` for video: `aspectRatio` ("16:9" | "9:16"), `durationSeconds`,
  `resolution` ("480p" draft, "1080p" final), `sound: boolean`.
- `fetchResult(id, { signal })` returns the file in memory (`{ bytes, mimeType }`) or as a stream of
  known length (`{ stream, sizeBytes, mimeType }`, uploaded as a stream, never held in memory), and
  may return a poster (`poster?: { bytes, mimeType }`) and a `dispose()` the caller runs afterwards.
  The generation job stores the video with purpose `generated_video` and the poster with
  `video_poster`; `generation` gets no new column: the poster file id is kept in `params` and
  returned to the completion hook (`{ id, purpose, status, resultFileId, posterFileId, error }`),
  also when the hook is called again.
- Sample provider video: a real MP4 (H.264, yuv420p, faststart, silent AAC track when `sound`)
  rendered with ffmpeg: dark ground, the label large, a "Sample" mark, a moving element so
  playback is visible, a frame counter or timecode, exact duration and aspect ratio; draft
  854x480 (or 480x854), final 1920x1080 (or 1080x1920). A final rendered with
  `draftProviderJobId` uses the draft's seed, so it is visibly the same clip in higher quality.
  Deterministic, state-free across processes like the image sample. Prices (made up): draft 20,
  final 60 credits.
- ffmpeg: `ffmpeg-static` (or equivalent) for local runs; the worker Docker image installs
  ffmpeg. Path from `FFMPEG_PATH` when set.
- `generation.sweep`: a scheduled job (every 5 minutes) that marks generations stuck in `running`
  longer than `GENERATION_STUCK_AFTER_MINUTES` (default 120) as `failed` with a user-readable
  error, refunds them, and calls the completion hook. A generation that is `queued` and never
  started is failed only after 12 hours (it may be waiting behind the per-user limit, which is not
  a failure). Queued generations older than 30 minutes get their `generation.run` job sent again
  (deduplicated). A finished generation whose completion hooks never ran to the end (`notified_at`
  is null 2 minutes after it finished) gets the hooks called again. Idempotent.
- `generation.run` holds a lease on the row (`provider_claimed_at`, 2 minutes) while it calls the
  provider's `create`, and passes the generation id as the provider's `idempotencyKey`; a
  `queued` generation starts only when it is among the user's oldest queued ones that fit the
  free slots (queued rows older than 6 hours no longer hold younger ones back).

## New damis: `@/server/damis`

| Dami | Input | Output |
|---|---|---|
| `block-reviser` | `{ style, block: { title, scriptExcerpt, prompt, assetRefs }, assets, review: { issueCodes[], note? } }` | `{ prompt, assetRefs, changeSummary[] }` |
| `take-fixer` | `{ style, block, previousPrompt, assetRefs, stage: "draft" | "final", review }` | `{ prompt, changeSummary[] }` |

`prompt` uses `<<<image_N>>>` tokens, N being the 1-based position in the returned `assetRefs`;
every listed ref is called at least once and every token has a ref (checked in code). Only assets
passed in may be referenced. Voices are never image references. Exports for the UI:
`BLOCK_ISSUE_LIST`, `TAKE_ISSUE_LIST` (shape of `SCRIPT_ISSUE_LIST`), with their code unions and
Zod enums. Sample generators for all three.

## Production: `@/server/production`

```ts
type TakeView = { id; takeNumber; stage: "draft" | "final"; status; fileId; posterFileId;
                  failure; isSample; priceCredits: number | null; createdAt; decidedAt };
type ProductionBlock = {
  id; lineageId; orderIndex; title; durationSeconds; scriptExcerpt;
  stage: BlockProductionStage;
  prompt: string | null;                     // the prepared prompt
  assets: { ref: string; assetId: string; name: string; kind: AssetKind; thumbnailFileId: string | null }[];
  notes: string[];
  posterFileId: string | null;               // of the newest take with a file
  scriptChanged: boolean;                    // a script edit sent it back (until approved again)
};

ensurePrepared(projectId, userId): Promise<{ reopened: boolean }>
  // claim the current blocks whose productionState is none and send ONE production.dispatch
  // { projectId, kind: "prepare" } on the claiming transaction (the worker fans it out into one
  // production.prepare / block.revise per block; claimed blocks always have their job coming)
  // (called whenever any Production page is entered, whatever the stage); no-op when everything
  // is prepared or pending. A done project whose current blocks are not all done (and none stale)
  // is reopened (`reopenProduction`): it heals films stranded by an earlier script edit
reopenProductionAfterScriptEdit(projectId): Promise<boolean>   // worker, after re-sectioning
getProductionOverview(projectId, userId): Promise<{
  projectStage: "production" | "done";
  phase: "preparing" | "block_review" | "generating" | "finished";
  counts: Record<BlockProductionStage, number>;
  blockCount: number;
  canStartDrafts: boolean; canComplete: boolean;
} | null>
listProductionBlocks(projectId, userId, opts?: { limit?; cursor?; stage?: BlockProductionStage[] }):
  Promise<{ items: ProductionBlock[]; nextCursor } | null>
getBlockDetail(lineageId, userId): Promise<(ProductionBlock & { takes: TakeView[]; busy: boolean }) | null>

setBlockAssets(input: { lineageId; userId; assetIds: string[] }): Promise<ProductionBlock | null>
  // only before generation; ready, non-voice assets of the project; creates the next block
  // version and re-prepares it (the prompt's tokens must match the new list)
submitBlockReview(input: { lineageId; userId; decision; issueCodes?; note? }): Promise<BlockProductionStage | null>
  // accepted → approvedAt; rejected → next version, block.revise job
approveAllBlocks(input: { projectId; userId }): Promise<number>     // approves every block in block_review

quoteProduction(projectId, userId): Promise<{
  drafts: { count: number; credits: number };     // approved blocks without a take
  finalsEach: number;                             // price of one final, for information
  balance: number;
} | null>
startDrafts(input: { projectId; userId; expectedCredits: number }): Promise<{ started: number }>
  // refuses when the quote changed (throws PriceChangedError, a ProductionInputError with the
  // message "The price changed. Check the new total, then confirm again."; check
  // `instanceof PriceChangedError` or `code === "price_changed"`, then show the new quote) or
  // credits are short. Creates the draft takes and sends ONE production.dispatch
  // { projectId, kind: "takes" } on the same transaction
submitTakeReview(input: { takeId; userId; decision; issueCodes?; note? }): Promise<BlockProductionStage | null>
  // draft accepted → final take (pending), take.generate; draft rejected → new draft, take.fix
  // final accepted → done; final rejected → new draft, take.fix
retryTake(input: { takeId; userId }): Promise<BlockProductionStage | null>
retryPreparation(input: { lineageId; userId }): Promise<BlockProductionStage | null>
completeProduction(input: { projectId; userId }): Promise<boolean>   // all blocks done → stage done

listFinishedClips(projectId, userId, opts?: { limit?; cursor? }): Promise<{
  items: { lineageId; orderIndex; title; durationSeconds; fileId; posterFileId; downloadName: string }[];
  nextCursor;
} | null>
getClipDownloadUrl(input: { lineageId; userId }): Promise<string | null>   // presigned, attachment name
requestExport(input: { projectId; userId }): Promise<ExportView | null>
  // reuses the newest ready or pending bundle of the same clips (same contentKey); otherwise a
  // pending one + export.build job, sent on the same transaction. A film whose clips together
  // exceed 20 GB (the export_zip limit) fails the bundle with a message telling the user to
  // download the clips one by one; a film that changed while the ZIP was built fails it with
  // "ask for the ZIP again"
getExport(exportId, userId): Promise<ExportView | null>
  // ExportView = { id; status; clipCount; failure; downloadUrl: string | null }
```

Download names: a movie `<project-slug>_B012_<title-slug>.mp4`, a series
`<project-slug>_E01_B012_<title-slug>.mp4` (episode number, 1-based block order, zero-padded;
slugs cut at a word). The ZIP holds the clips under those names plus `shots.csv` (order, episode
for a series only, title, duration seconds, file name, script excerpt; UTF-8 with a BOM for
Excel), is written by streaming (no whole film in memory; ZIP64 where a size, an offset or the entry count
needs it) and uploaded in parts, and is stored with purpose `export_zip`, whose limit is 20 GB.

Jobs (handlers in `worker/handlers/`):

| Job | Payload, dedupe | Does |
|---|---|---|
| `production.dispatch` | `{ projectId, kind: "prepare" \| "takes" }`, `<projectId>:<kind>` (with a follow-up: one may wait beside a running one) | fan-out: `prepare` queues `block.revise` (block answers its predecessor's rejected review) or `production.prepare` for every pending, non-stale block; `takes` queues `take.generate` (prompt stored) or `take.fix` for every pending take without a generation. Idempotent (each per-row job is keyed by its row); sent on the transaction that created the rows |
| `production.prepare` | `{ blockId }`, block id | binds the block's `[kind:Name]` tags to `<<<image_N>>>` tokens for the project's ready assets (code, `production/binding.ts`) → production fields, state ready |
| `block.revise` | `{ blockId }`, block id | runDami(block-reviser) on the parent version + its review → production fields |
| `take.generate` | `{ takeId }`, take id | requestGeneration (draft or final; references = each `productionAssetRefs` asset's file, in order: a character's accepted sheet, a location's or prop's approved Hero; `ReferenceAsset.views` lists a locked pack's approved views for later use) |
| `take.fix` | `{ takeId }`, take id | runDami(take-fixer) on the parent take's prompt + review → prompt → requestGeneration |
| `export.build` | `{ exportId }`, export id | build and store the ZIP (stream the clips from and the ZIP to object storage; refuse above 20 GB) |

Every job above is sent on the transaction that writes its row (see `docs/M1_CONTRACTS.md`): the
row and its job commit together, and a failed send rolls the request back instead of leaving a
failed take or block behind. Every handler checks the row is still waiting for it.

The generation completion hook moves a take to `in_review` (with `fileId` and `posterFileId`) or
`failed`. Insufficient credits become a failed take with the credits message, as for looks.
Reviews go to `review` with `subjectType` `prompt_block` or `generation` (subject id = the block
version id / the take id) and the `damiRunId` that produced the prompt.

Entering Production requires stage `production` or `done`; a script edit that marks blocks stale
sends them back through preparation (stale blocks cannot be approved or generated). When
re-sectioning leaves any current block not done, a finished project returns to `production`
(`reopenProduction` in `@/server/projects`, logged `stage.reopened`); `completeProduction`
finishes it again. The pages route through one pure function (`productionDestination` /
`productionRedirect` in `src/app/(app)/projects/[id]/_lib/production-routes.ts`), loop-free by
construction: a redirect always lands on a page that can be shown.
