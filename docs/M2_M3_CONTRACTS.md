# M2 + M3 contracts: generation engine and Pre-production

The interfaces every work package of this step builds against. Change them only with the lead's
agreement. Conventions are those of `docs/M1_CONTRACTS.md`: server-only functions, Zod-validated
input, the acting `userId`, `null` for a project or record that is missing, archived or not the
user's, a module `*InputError` with a user-safe message for bad input.

Tables are in `src/server/db/schema.ts` (migration `0002`): `generation`, `credit_ledger`,
`credit_balance`, `asset_look`, `asset_sheet`.

## Providers: `@/server/providers`

```ts
type GenerationRequest = {
  kind: "image" | "video";
  purpose: GenerationPurpose;          // asset_look | asset_sheet | block_draft | block_final
  model: string;
  prompt: string;
  params: Record<string, unknown>;     // aspectRatio, resolution, durationSeconds, ...
  references: { bytes: Uint8Array; mimeType: string; name: string }[];
  /** Shown on sample output only. */
  label?: string;
};
type ProviderJobStatus =
  | { state: "running" }
  | { state: "succeeded" }
  | { state: "failed"; reason: string; retryable: boolean };

interface GenerationProvider {
  readonly id: string;                                   // "sample" | "higgsfield"
  price(request: Omit<GenerationRequest, "references">): Promise<number>;   // credits, creates nothing
  create(request: GenerationRequest): Promise<{ providerJobId: string }>;
  getStatus(providerJobId: string): Promise<ProviderJobStatus>;
  fetchResult(providerJobId: string): Promise<{ bytes: Uint8Array; mimeType: string }>;
}
getProvider(): GenerationProvider      // from GENERATION_PROVIDER=sample|higgsfield (default sample)
pickModel(purpose: GenerationPurpose, style: ProjectStyle):
  { kind; model: string; params: Record<string, unknown> }   // the platform's choice, never the user's
```

`SampleProvider`: deterministic placeholder PNG rendered with `sharp` (label, purpose, a visible
"Sample" mark, the request's aspect ratio; sheets look like a sheet: several panels), finishes
after `GENERATION_SAMPLE_DELAY_MS` (default 2500; 0 in tests). Prices (made up): look 4, sheet 6,
video draft 20, video final 60 credits. A prompt containing `[[fail]]` fails with a
non-retryable reason and `[[flaky]]` fails once with a retryable one (for tests and demos).
Sample job state must survive across processes (web enqueues, any worker runs): keep it in the
provider job id or the `generation` row, never in memory.

## Credits: `@/server/billing`

```ts
getBalance(userId): Promise<number>
grantCredits(input: { userId; amount: number; note?: string; createdBy?: string }): Promise<number>   // new balance
reserve(input: { userId; generationId; amount }, tx?: DbTransaction): Promise<void>
  // throws InsufficientCreditsError (user-safe message, carries balance and needed)
settle(input: { generationId }, tx?): Promise<void>     // marks the reservation spent
refund(input: { generationId }, tx?): Promise<void>     // returns the reserved amount
listLedger(userId, opts?: { limit?; cursor? }): Promise<{ items; nextCursor }>
```

Every entry and the `credit_balance` update happen in one transaction with the balance row
locked (`FOR UPDATE`), so concurrent reserves cannot overspend. `settle` and `refund` are
idempotent and mutually exclusive per generation (unique index on generation + type; a settled
generation cannot be refunded and the reverse).

## Generations: `@/server/generation`

```ts
quoteGeneration(input: { purpose; style: ProjectStyle }): Promise<{ priceCredits: number }>
requestGeneration(input: {
  userId; projectId; purpose: GenerationPurpose; prompt: string;
  referenceFileIds?: string[]; label?: string; style: ProjectStyle;
  aspectRatio?: AspectRatio;   // instead of the policy's ratio (props, pack views)
  variant?: string;            // a re-roll's nonce: same request, new seed
}, tx?: DbTransaction): Promise<{ generationId: string; priceCredits: number }>
  // pickModel → price → insert row (queued) → reserve, in one transaction; enqueue
  // generation.run after commit (callers passing tx enqueue themselves via enqueueGeneration).
enqueueGeneration(generationId): Promise<void>
getGeneration(generationId, userId): Promise<GenerationView | null>
```

Job `generation.run` `{ generationId }`, dedupe key generation id: skip if already finished;
`create` at the provider once (store `providerJobId` before polling so a retry resumes instead of
creating again); poll with backoff until done or the job's time budget ends; on success store the
bytes with `putFileBytes` (purpose `generated_image` / `sheet_image`), set `resultFileId`,
`settle`; on a non-retryable failure or the last attempt set `failed` with a user-readable
`error` and `refund`. After finishing either way, call the registered completion hook:

```ts
onGenerationFinished(handler: (g: { id; purpose; status; resultFileId; error }) => Promise<void>): void
```

(registered by the worker; pre-production uses it to move its look, sheet or sheet view forward). Limits:
`GENERATION_MAX_PER_USER` (default 3 running per user; extra jobs are rescheduled, not failed) and
the job type's worker concurrency as the global cap.

## New damis: `@/server/damis`

| Dami | Input | Output |
|---|---|---|
| `character-generator` (v5) | `{ project, styleOverride?, environment?, character: { name, role?, description?, kind?, details, facts }, referenceImages: [{fileId, role: face\|outfit\|full_body\|other, note?}], userNotes?, previousPrompt?, fixRequests[] }` | the owner's board output (`image_prompt`, `aspect_ratio: "16:9"`, `style_used`, `reference_order`, `applied_fixes`, `assumptions`, `warnings`) |
| `location-generator` (v1) | `{ project, location, scriptContext?, userPrompt?, guidedAnswers?, referenceImages (hero\|layout\|mood\|detail\|other), outputMode: "lock", excludeAssets, previousOutput?, fixRequests[], userNotes? }` | the owner's `submit_location_spec` (spec fields, DNA, layout, coverage plan, `hero_wide`) |
| `prop-generator` (v1) | `{ asset, project, userPrompt?, guidedAnswers? (+ advanced), referenceImages (identity\|material\|detail\|mood\|other), scriptContext?, linkedCharacters, linkedLocations, clarifyAnswers?, previousOutput?, fixRequests[], userNotes? }` | the owner's `submit_asset_spec` (spec fields, clarifying questions, DNA, sheet plan, `hero_view` or null) |
| `sheet-generator-character` (v4) | `{ project, character: { name, role?, details }, referenceImages: [{fileId, role: approved (always 1)\|previous_sheet\|face\|outfit\|full_body\|other}], boardPrompt?, boardAssumptions, renderCellNumbers, userNotes?, previousPrompt?, previousDetailCells?, fixRequests[] }` | the owner's sheet output (`image_prompt`, `edit_mode: full\|edit_previous_sheet`, `reference_order`, six `detail_cells`, `applied_fixes`, `assumptions`, `warnings`) |
| `sheet-generator-location` (v1) | `{ project, lockedSpec (the accepted location-generator answer), mode: "lock", approvedImages: [{fileId, viewId}] (Hero first), onlyViews?, excludeAssets, previousOutput?, fixRequests: [{code, instruction, note?, viewId, editEligible}], userNotes? }` | the owner's `submit_location_views` (`views` with prompt, `reference_order`, `depends_on`, `must_show`, `must_not_show`, `new_hypotheses`, `review_focus`, `edit_mode`; `generation_order`; or the four-panel `concept_sheet`) |
| `sheet-generator-prop` (v1) | `{ lockedSpec (the accepted prop-generator answer), approvedImages (hero_34 first), userReferenceImages, linkedCharacters, project, sheetLevelOverride?, previousOutput?, fixRequests[] (as above), userNotes? }` | the owner's `submit_asset_views` (`sheet_level`, `views` with label, state, ratio and checks, `generation_order`, `scale_card`) |

The three designers replaced the draft `asset-prompt-writer` and `asset-fixer` (Phase 4); the
three sheet makers replaced the draft `sheet-generator` and `sheet-fixer` (Phase 5). Data
exported for the UI: `designerQuestions(kind, context)` (each generator's `questions.ts`, with its
skip logic; `GuidedQuestion` gains `advanced?` and `prefill?`; every question also takes the
user's own words or `ai_decides`), `REFERENCE_ROLES`, `REFERENCE_CONFLICTS`, `LOOK_FRAMES` and the
designers' review catalogs (`getReviewCatalog(DESIGNER_CATALOGS[designer])`). Look reviews send
catalog `selections` (stored as `review.fix_requests`, codes in `issue_codes`), spec-card edits,
answers to the designer's questions and a changed photo list; a `regenerate` option alone re-rolls
with the same prompt and a new variant (no dami call). Sheets and pack views are reviewed
with the sheet makers' catalogs (`sheet-generator-character`, `-location`, `-prop`) the same way. Marks a reviewer drops on the picture are folded into the
note as plain text. Each dami has a sample generator in `src/server/damis/sample/`.

## Pre-production: `@/server/assets` (additions)

State of an asset, derived: `needs_image` → `generating` (→ `needs_answer`) → `look_review` →
`building_sheet` → `sheet_review` → `ready` (plus `failed` with what failed). Voices:
`needs_recording` → `ready` (upload only, accepted on upload, no sheet).

A character's sheet is one image (`asset_sheet.prompt`, `spec` with the six detail frames). A
location's or prop's sheet is a pack: `asset_sheet.spec` holds the plan (generation order, prop
level and scale card) and each view is an append-only `asset_sheet_view` row (unique
`(sheetId, viewId, versionNumber)`, indexed by sheet) with statuses `planned` → `pending` →
`in_review` → `accepted` / `rejected` (a new version follows) / `superseded` / `failed`. A pack
sheet is `pending` while planned, `in_review` while its views are made and reviewed, and
`accepted` once locked; its `fileId` is then the contact sheet (people only, never sent to a
model).

```ts
type AssetStage = "needs_image" | "generating" | "look_review" | "building_sheet"
                | "sheet_review" | "ready" | "failed";
type AssetCard = { asset: Asset; stage: AssetStage; thumbnailFileId: string | null };
type LookView  = { id; versionNumber; source; status; fileId; userPrompt; guidedAnswers; failure;
                   isSample: boolean; createdAt; decidedAt };
type SheetView = { id; versionNumber; lookId; status; fileId; spec: SheetSpecView | null; parentId;
                   failure; isSample; createdAt; decidedAt };
  // SheetSpecView: maker, editMode, detailCells, warnings, designChanges, appliedFixes,
  //   generationOrder, sheetLevel?, scaleCard?
type PackView  = { id; viewId; versionNumber; label; position; status; purpose; fileId; aspectRatio;
                   mustShow; mustNotShow; reviewFocus; newHypotheses; editMode; warnings;
                   waitingFor: string[]; parentId; failure; isSample; createdAt; decidedAt };

getPreProductionOverview(projectId, userId): Promise<{
  kinds: { kind: AssetKind; total: number; ready: number }[];   // only kinds that have assets
  total: number; ready: number; canComplete: boolean;
} | null>
listAssetCards(projectId, userId, opts: { kind: AssetKind; limit?; cursor? }):
  Promise<{ items: AssetCard[]; nextCursor } | null>
getAssetDetail(assetId, userId): Promise<{
  asset: Asset; stage: AssetStage;
  looks: LookView[];            // newest first, capped at 20
  sheets: SheetView[];          // newest first, capped at 20
  busy: boolean; questions; waitingFor; rejectedInARow;
  packViews: PackView[];        // locations and props: the latest sheet's views (latest versions)
  lockGate: { canLock: boolean; missing: string[] } | null;
  dnaCard: { summary; anchors; identity; constraints; mutable } | null;
} | null>

startLookFromUpload(input: { assetId; userId; fileId }): Promise<LookView | null>
  // image assets: look in_review at once. Voice assets: audio file, accepted at once.
startLookFromPrompt(input: { assetId; userId; prompt: string }): Promise<LookView | null>
startLookFromGuided(input: { assetId; userId; answers: Record<string,string> }): Promise<LookView | null>
  // both: look pending, enqueue asset.look.generate
submitLookReview(input: { lookId; userId; decision; selections?; note?; references?; specEdits?;
                           clarifyAnswers?; confirmedFields? }): Promise<AssetStage | null>
  // accepted (critical inferred spec fields confirmed) → previous accepted look superseded, create
  //   sheet (pending), enqueue asset.sheet.generate (character) or asset.sheet.plan (location, prop)
  // rejected (needs a reason) → uploaded look: back to needs_image;
  //   generated look: new look (pending, parentId), enqueue asset.look.fix
submitSheetReview(input: { sheetId; userId; decision; selections?; note? }): Promise<AssetStage | null>
  // character sheets. Rejected: SR01 alone re-rolls (same prompt, new seed); SX01 (or a pack's
  //   LSX01/ASX01) sends the asset back to its designer (the accepted look is rejected with the
  //   request, a designer fix round starts, the sheet rebuilds once the new look is accepted);
  //   anything else → new sheet (pending, parentId), enqueue asset.sheet.fix
submitSheetViewReview(input: { viewRowId; userId; decision; selections?; note?;
                               hypothesesApproved? }): Promise<AssetStage | null>
  // accepted (proposed parts approved with it) → enqueue asset.sheet.views.advance;
  // rejected → LSR01/ASR01 re-roll, LSX01/ASX01 back to the designer, else a new planned
  //   version without a prompt and asset.sheet.plan { sheetId, viewRowId } (only_views)
retrySheetView(input: { viewRowId; userId }): Promise<AssetStage | null>
lockSheet(input: { sheetId; userId }): Promise<AssetStage | null>
  // location: Hero and Reverse approved; prop: simple → the Hero alone, standard → its non-detail
  // and state views, production → every view; no view generating. Unapproved views are
  // superseded; enqueue asset.sheet.assemble.
retryLook(input: { lookId; userId }), retrySheet(input: { sheetId; userId }): Promise<AssetStage | null>
replaceLook(input: { assetId; userId }): Promise<AssetStage | null>
  // start over on a ready asset: its accepted look and sheet become superseded

addAsset(input: { projectId; userId; kind; name; description? }): Promise<Asset | null>   // origin manual
updateAsset(input: { assetId; userId; name?; description? }): Promise<Asset | null>
removeAsset(input: { assetId; userId }): Promise<boolean>          // status removed, never deleted
mergeAssets(input: { keepId; mergeId; userId }): Promise<Asset | null>
  // same project and kind; merged one becomes removed; blocks' assetRefs and tags are rewritten to the kept name

completePreProduction(input: { projectId; userId }): Promise<boolean>
  // all active assets ready → advance pre_production → production
```

Jobs (handlers in `worker/handlers/`), each `{ lookId }` or `{ sheetId }` (plus `viewRowId`), dedupe key that id:

| Job | Does |
|---|---|
| `asset.look.generate` | the asset's designer in create mode → store prompt and spec → `requestGeneration` (asset_look, the designer's ratio and photos); or `needs_input` (a blocking question), or the user's photo as the Hero (`use_uploaded`, no generation) |
| `asset.look.fix` | the designer in fix mode on the parent look's answer + its review's fix requests (or, for a re-roll, the stored prompt with a new variant) → `requestGeneration` |
| `asset.sheet.generate` | character: runDami(sheet-generator-character) with the approved board as image 1 → store prompt and spec → `requestGeneration` (asset_sheet, the files of its reference order). A pack sheet is handed to `asset.sheet.plan`. |
| `asset.sheet.fix` | character: the sheet maker in fix mode (previous prompt, frames, fix requests; the previous sheet attached when every code is edit-eligible), or a re-roll with the stored prompt and a new variant → `requestGeneration` |
| `asset.sheet.plan` | location/prop: runDami(sheet-generator-location / -prop) → store the plan and the views (planned) → advance. With `viewRowId`: re-write that one view from its review (location `only_views`) |
| `asset.sheet.views.advance` | `{ sheetId }`, one run per sheet plus one follow-up: request every planned view whose `dependsOn` are approved (asset_sheet purpose, the view's ratio, up to 4 files: Hero, approved views, the previous version in edit mode, the user's photos) |
| `asset.sheet.assemble` | a locked pack's contact sheet with sharp (Hero, labelled views, DNA and scale card) → `asset_sheet.fileId` |

The generation completion hook moves the look, sheet or sheet view to `in_review` (with `fileId`)
or `failed` (with `failure`); a settled view advances its pack. An `InsufficientCreditsError` becomes a `failed` look or sheet whose `failure`
says how many credits are needed; `retryLook` / `retrySheet` run it again.

Reviews are written to `review` with `subjectType` `asset_look` / `asset_sheet` /
`asset_sheet_view` and the
`damiRunId` that produced the prompt.
