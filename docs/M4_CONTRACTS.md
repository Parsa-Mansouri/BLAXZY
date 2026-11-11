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

1. Entering Production prepares every current block (`text-blocks` dami): the block's prompt is
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
- `fetchResult` may return a poster: `{ bytes, mimeType, poster?: { bytes, mimeType } }`. The
  generation job stores the video with purpose `generated_video` and the poster with
  `video_poster`; `generation` gets no new column: the poster file id is returned to the
  completion hook (`{ id, purpose, status, resultFileId, posterFileId, error }`).
- Sample provider video: a real MP4 (H.264, yuv420p, faststart, silent AAC track when `sound`)
  rendered with ffmpeg: dark ground, the label large, a "Sample" mark, a moving element so
  playback is visible, a frame counter or timecode, exact duration and aspect ratio; draft
  854x480 (or 480x854), final 1920x1080 (or 1080x1920). A final rendered with
  `draftProviderJobId` uses the draft's seed, so it is visibly the same clip in higher quality.
  Deterministic, state-free across processes like the image sample. Prices (made up): draft 20,
  final 60 credits.
- ffmpeg: `ffmpeg-static` (or equivalent) for local runs; the worker Docker image installs
  ffmpeg. Path from `FFMPEG_PATH` when set.
- `generation.sweep`: a scheduled job (every 5 minutes) that marks generations stuck in `queued`
  or `running` longer than `GENERATION_STUCK_AFTER_MINUTES` (default 120) as `failed` with a
  user-readable error, refunds them, and calls the completion hook. Idempotent.

## New damis: `@/server/damis`

| Dami | Input | Output |
|---|---|---|
| `text-blocks` | `{ style, block: { title, scriptExcerpt, prompt, durationSeconds, assetRefs }, assets: { ref: "kind:slug", kind, name, description }[], previous?: { title, promptTail } }` | `{ prompt, assetRefs: string[], notes: string[] }` |
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
};

ensurePrepared(projectId, userId): Promise<void>
  // enqueue production.prepare for current blocks whose productionState is none
  // (called when the stage is opened); no-op when everything is prepared or pending
getProductionOverview(projectId, userId): Promise<{
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
  // refuses when the quote changed (ProductionInputError "The price changed…") or credits are short
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
  // reuses a ready bundle with the same contentKey; otherwise a pending one + export.build job
getExport(exportId, userId): Promise<ExportView | null>
  // ExportView = { id; status; clipCount; failure; downloadUrl: string | null }
```

Download names: `<project-slug>_E01_B012_<title-slug>.mp4` (episode number, 1-based block order,
zero-padded). The ZIP holds the clips under those names plus `shots.csv` (order, episode, title,
duration seconds, file name, script excerpt), is written by streaming (no whole film in memory),
and is stored with purpose `export_zip`.

Jobs (handlers in `worker/handlers/`):

| Job | Payload, dedupe | Does |
|---|---|---|
| `production.prepare` | `{ blockId }`, block id | runDami(text-blocks) with the project's ready assets and the previous block's tail → production fields, state ready |
| `block.revise` | `{ blockId }`, block id | runDami(block-reviser) on the parent version + its review → production fields |
| `take.generate` | `{ takeId }`, take id | requestGeneration (draft or final; references = the sheets of `productionAssetRefs`, in order) |
| `take.fix` | `{ takeId }`, take id | runDami(take-fixer) on the parent take's prompt + review → prompt → requestGeneration |
| `export.build` | `{ exportId }`, export id | build and store the ZIP |

The generation completion hook moves a take to `in_review` (with `fileId` and `posterFileId`) or
`failed`. Insufficient credits become a failed take with the credits message, as for looks.
Reviews go to `review` with `subjectType` `prompt_block` or `generation` (subject id = the block
version id / the take id) and the `damiRunId` that produced the prompt.

Entering Production requires stage `production`; a script edit that marks blocks stale sends
them back through preparation (stale blocks cannot be approved or generated).
