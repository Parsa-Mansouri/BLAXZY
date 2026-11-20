# damis

Claude-powered processes. Import only from `@/server/damis` (`index.ts`). This module is the only
code that calls the Claude API and the only writer of `dami_run`.

## Layout

- `framework/` `defineDami`, `runDami` (validation, structured output, streaming, retries,
  concurrency limit, corrective retry, `dami_run` bookkeeping), errors, models, pricing.
- `modules/` genre and visual-style prompt modules (one file each), format/orientation text, and
  `composeModules` (fixed order: genre, style, format, orientation; generic fallbacks).
- `shared/` craft rules shared by damis, the `ProjectStyle` schema, duration planning, line tools,
  `asset-ref.ts` (the one module for asset names, `kind:Name` refs and `[kind:Name]` tags) and
  `review-catalog.ts` (the owner's review catalogs, normalized, and `buildFixRequests`).
- One folder per dami: `schema.ts`, `prompt.ts`, `dami.ts`, `fixtures/` (`input.json` for
  `pnpm dami:run`, `model-output.json` for tests), and a test.

## Script stage

- `script-writer/` is the owner's Script Writer v0.2. `script-writer` (generate, revise,
  write_segment, answering `submit_screenplay`) and `script-writer-outline` (outline, answering
  `submit_outline`) share one prompt: the core plus one genre and one style module, copied
  verbatim into `modules.ts`. `project.ts` builds the `<project>` block (no format or orientation
  text); `reasons.ts` holds the 19 revise reason codes.
- `shared/duration.ts` is the owner's runtime budget and `estimate()`; the worker runs the
  auto-correction loop. `shared/screenplay.ts` renders the structured screenplay as the canonical
  text stored in `script_version.content` and flattens it for the Asset Detector.
- `enhancer/` rewrites a quick idea (genre and style blocks verbatim from the owner's file).

## Designers (pre-production)

- `character-generator/` (v5, the whole owner file is the system prompt), `location-generator/`
  (v1, core + `location-shared/` orientation and one genre and one style lens) and
  `prop-generator/` (v1, core + the four `prop-shared/` modules). Prompt text is generated
  verbatim into `prompt-text.ts` / `modules.ts`; each test checks it against `source/`.
- Each has `questions.ts` (guided questions and their skip logic) and reads reference photos by
  file id, attached in index order before the input JSON. `designers.ts` maps asset kinds to a
  designer (legacy creature → character; costume and other → prop), its catalog, photo roles and
  the preference codes that contradict a photo. `shared/designer.ts` holds the project block and
  fix-request shape they share.
- Fix rounds of locations and props run at `low` effort (the owner's temperature 0.3).
- The draft `asset-prompt-writer` and `asset-fixer` were retired.

## Sheet makers (pre-production)

- `sheet-generator-character/` (v4, the whole owner file is the system prompt): one 16:9 sheet
  prompt from the approved board (reference 1); six numbered detail frames, `edit_mode` and the
  catalog codes whose fix may edit the previous sheet (`edit-eligible.ts`, from the catalog's
  prose rule; applied when the catalog is normalized).
- `sheet-generator-location/` (v1, core + `location-shared/` orientation and lenses) and
  `sheet-generator-prop/` (v1, core + the four `prop-shared/` modules): the prompts for the
  remaining views of a pack, with dependencies, references (at most four) and reviewer checks.
  Their checks are the owner's tests and validators (generation order after dependencies, edit
  mode only for edit-eligible requests, the prop's minimum level and state views).
- None of them redesigns: a request they will not apply comes back as a
  `DESIGN_CHANGE_REQUESTED:` warning (`designChangeRequests`), and `sheetFixProblems` accepts
  a requested code that is either applied or explained in `warnings`.
- The draft `sheet-generator` and `sheet-fixer` (and `SHEET_ISSUES`) were retired.

## Creative DNA (DAMI-00)

- `creative-dna/` compiles a project's genre and visual-style modules, format, orientation and
  duration into its Creative Bible (the owner's output_10): per-consumer rules, anti-cliche guards,
  QC items and the review options of the reject flow. The system prompt is the owner's file from
  `<role>` on (`prompt-text.ts`, checked against `source/`); `source/` also holds the registry
  (`registry.ts`: the shared core and the 13 modules, server-side only), the output schema and the
  regression cases.
- It runs once per Style: `saveStyle` calls `refreshCreativeBible` (`src/server/projects/
creative-bible.ts`) in its transaction, which adds a `creative_bible` row and queues
  `project.creative-dna` when the style is saved for the first time, when the genre, visual style,
  format, orientation, durations or language changed, or when the last bible failed. A typed
  "Other" genre or style has no module: the old bible is superseded and none is requested.
- Stored in `creative_bible` (append-only versions; older rows become `superseded`;
  `pending | ready | failed | superseded`). `getReadyBible(projectId)` returns the newest `ready`
  bible, parsed, or null while one is compiling. The worker handler is
  `worker/handlers/project-creative-dna.ts`; a `rejected` answer is stored as a failure, not a bible.
- Later damis call `renderCreativeDna(consumer, bible)` (`shared/creative-context.ts`) and put the
  returned `PromptText` (already `cache: true`) in their system prompt after their own
  instructions. Consumers: `script_writer`, `script_checker`, `asset_detector`,
  `asset_generation`, `sheet_generator`, `director`, `text_blocks_video` (the Director reads both slices). `getReviewOptions`
  gives the review screens their options. `shared/platform.ts` holds the platform numbers
  (block lengths, speech rates).
- Who consumes which slice (input field `creativeDna`, the rendered block as a string, optional;
  `shared/creative-dna-input.ts`): `script-writer` and `script-writer-outline` take
  `script_writer`; `script-checker` takes `script_checker`; `character-generator`,
  `location-generator` and `prop-generator` take `asset_generation`; the three
  `sheet-generator-*` take `sheet_generator`; `asset-detector` takes `asset_detector`. The
  Director and Block Revision read the bible directly (below). With `creativeDna` the dami appends it as the last system block
  (cached, so one more breakpoint: the most any of them reaches is 3 of 4); without it the prompt
  is exactly what it was. `script-checker` uses the bible INSTEAD of `composeModules` (the bible
  already carries genre, style, format and orientation) and keeps `composeModules` as the
  fallback when there is no bible (a typed "Other" style). Each of them moved up one minor version.
- The wait rule (`bibleForRun(projectId)` in `projects/creative-bible.ts`, used through
  `worker/handlers/creative-bible.ts`): the handlers of `script.write`, `script.write-segment`,
  `script.revise` (writer revises only), `script.check`, `asset.look.generate|fix`,
  `asset.sheet.generate|fix` and `asset.sheet.plan` read the project's newest bible row after
  deciding the job is still wanted and before the first paid call. `ready` → use it. `pending` and
  younger than 10 minutes (from the row's `created_at`) → the handler queues a copy of its own job
  with `bibleWaits` + 1 and `startAfter` 20 s and returns without running a dami. `failed`,
  `superseded`, none, unreadable, or pending for over 10 minutes → run without a bible and log it
  (`creative bible not used`), no user-facing error. The wait count is part of the job's dedupe key
  from the first wait on (`<key>:wait<N>`), so the copy is not deduped against the job that queues
  it, a retry of the same deferral is, and a fresh request never collides; the deferring job ends
  successfully without having run a dami, so a dami never runs twice, and the 10-minute limit
  bounds the chain (at most about 30 hops).
- The structured output has no free-form objects and nullable fields are required keys holding
  null. The owner's counts (3+ rules per slice, 12+ QC items, 4+ guards, 4 to 7 / 4 to 6 review
  options) are checked by Zod after the answer; a `rejected` skeleton keeps the full shape with
  empty lists and skips them.

## Project namer

- `project-namer/` (ours, no owner file; v1.0.0) gives an untitled project its name: Haiku, `low`
  effort, 1024 output tokens. Input: genre, visual style, format (as stored) and the first ~6000
  characters of the story; output `{ title }` (1 to 60 characters, story's language, no quotes, no
  trailing period, never "Untitled"; `check()` enforces it).
- A project made without a title is "Untitled project" with `project.title_source` `placeholder`.
  The first story queues `project.name` on the same transaction: an idea or brief in
  `startVersion` (`script/start.ts`), an upload in `completeScriptVersion` (the text only exists
  once the worker has read the file). `worker/handlers/project-name.ts` runs the dami and
  `applyAutoName` (`projects/naming.ts`) sets the title with `title_source` `auto`, conditional on
  `placeholder`, so a rename by the user (`user`) always wins and a name is only ever made once.
  A failed name is only logged; the project keeps "Untitled project".

## Director and Block Revision

- `director/` is the owner's DIRECTOR v1.4 (output_22): the approved script becomes 15 or 30 second
  Seedance blocks with staging, a shot plan, rationales and a self-contained `prompt_text`. Two
  damis share one prompt, one `check()` and one input schema: `director` (modes `full` and
  `write_blocks`) and `director-plan` (mode `plan`: blocks without shots, `prompt_text` and
  `word_count`). Structured output needs one closed schema per answer shape, hence two. Opus,
  medium effort, 32k output tokens. The owner runs `plan` and then `write_blocks` in batches of
  ~8 blocks when the runtime would pass ~180 s; for up to ~8 blocks `full` is enough.
- The user turn follows the owner's `<inputs>`: `<platform_config>`, `<block_mode>`,
  `<creative_bible>`, `<asset_registry>`, `<script>` (cached), then `<plan>` (cached),
  `<mode>`, `<block_range>`. `<creative_bible>` is the owner's field list (selection,
  project_frame, contracts, the `for_director` and `for_text_blocks_video` slices, locks, guards,
  QC items of stages text_block/video/all, open questions, validation status), not
  `renderCreativeDna`, which renders one consumer per call and drops the two preflight fields.
- `<asset_registry>` is the subset of the Asset Detector's output_21 v2 the Director reads; its
  zod lives in `director/schema.ts` (no import from the detector). Voices are not assets (v1.4):
  no `voices` arrays and no `voice_` ids; a character's `voice` note comes only from the
  detector's voice facts (empty when the character never speaks); a speaker heard but not seen in
  a block is in `assets.heard_only` (no `@token`, no Characters line, no Staging entry); every
  dialogue line has `heard_as` (on_screen, off_screen, voice_over, phone_or_device, singing).
  Blocks stored by v1.3 (with `voices`, without `heard_only` / `heard_as`) still parse through
  the tolerant stored-row schemas.
- `director/validate.ts` is the owner's `<code_side_validator>` as pure functions. Two
  deliberate differences: dialogue lines are removed before the forbidden-word regex (a script
  line may say "still"), and `script_coverage` is checked by quotes found in order within a small
  gap tolerance (two quotes cannot prove "no gaps").
- `director/binding.ts` (pure): `@char_1` tokens to `Name <<<image_N>>>` with the ordered
  `kind:Name` refs (`bindAssetTokens`), the same pass written as `[kind:Name]` tags
  (`tagAssetIds`, what blocks store), and stable output_21-style ids for BLAXZY assets.
- `director/stub.ts`: the Creative Bible stub a project without a bible sends (a typed "Other"
  genre or style, or a failed compile). The owner's prompt and validator read `creative_bible`
  everywhere, so the stub keeps the whole shape: `genre.other` / `style.other`, the frame from
  the project style (orientation, format, runtime, the platform's default 15 s block), the user's
  own words (genre, style, look line, descriptor, art direction) in the contracts, empty slices,
  guards, locks and QC, and `validation_status: "ok_with_assumptions"` with one assumption saying
  there is no bible. The input schema takes `creativeBibleShape` (the bible without its minimum
  counts, which a compiled bible already passed) so the stub validates.
- `director/excerpts.ts` (pure): the script text of each block from its `script_coverage` quotes.

### The pipeline (craft)

- `script.direct` (replaces `script.section`) is queued after detection, by a correction round
  (`resection`) and by the retry path. The handler (`worker/handlers/script-direct.ts`) reads the
  accepted version's text, the latest detection as the registry (`detectorView` ids, voice-only
  characters as characters with no reference), the ready Creative Bible or the stub (a bible still
  compiling defers the job like every bible consumer) and `fixed_<n>` / `auto` for the block mode
  (a style asking for shot-by-shot clips fails with a clear reason). `pickCraft` picks the
  director and cinematographer (frozen into the run); the film-director plans the shots and the
  cinematographer sets the look (`directing`), then one `direction.scene` job per 4 scenes lights
  every shot (`lighting`, cinematographer `scene` mode). The last scene batch runs the Breakdown
  (`src/server/direction/breakdown.ts`, code: shots grouped into 15/30 s blocks, timed into 2 to
  6 s windows) and stores its v1.4 plan (`planned`); one `direction.write` job per batch of 8 then
  runs `write_blocks` with the batch's `<shot_plan>` and `<visual_layer>`, which the written
  blocks must follow exactly (`checkShotPlanFollowed`). The `full` and `plan` modes stay in the
  dami (and `director-plan` stays registered) but no job runs them any more; their old rows still
  read.
- Data: `direction` (one row per run set, append-only; `header`, `plan`, frozen `context`, and
  for craft runs `craft`, `shot_plan`, `visual`, `breakdown`) and `direction_batch` (a child
  table of `scene` and `write` batches, so parallel batches each write only their own row).
  `src/server/direction/service.ts`: storing a batch locks the direction row; the batch that finds
  none pending assembles the blocks in the same transaction (`replaceBlocks`, sectioning state,
  direction `ready`), so completion is idempotent and a late duplicate changes nothing.
- A block stores the Director's data in `prompt_block.direction` (with `asset_names`), its prompt
  with `[kind:Name]` tags, its ordered refs, 15 or 30 s. Preparation (`production.prepare`) is
  code only: `production/binding.ts` turns the tags into `<<<image_N>>>` for ready assets.
  `block.revise` runs Block Revision (below); the draft block-reviser is retired.
- Failures go through `handleFailure`; a blocked or invalid Director fails the direction and the
  sectioning state, and the user retries through the existing retry path.
- `block-revision/` is BLOCK_REVISION v1.5 (`block-revision`): the next version of one block from
  free-text requests only (asset correction, regenerate, director notes, confirmed review issues,
  timed notes, keep list, attempt history). The owner's review options and sliders are not part
  of the input by decision; the output keeps `slider_state` (always zeros). Sonnet by default;
  `blockRevisionRunContext(input)` gives the context that selects Opus when `regenerate` is set.
  `block.revise` builds the input in `production/revision-job.ts` (current block,
  continuity bible and Creative Bible of the Director run, neighbours, the review's
  `revisionRequest`, asset correction, attempt history) and stores the revised block as the new
  version (`direction.revision` holds change log, fix map, flags). The input takes the Director's
  lenient bible shape so a project with the stub bible can be revised. Older blocks without
  Director data cannot be revised. v1.5 follows the Director's v1.4 assets (`heard_only`, no
  voices), keeps any `<<<audio_N>>>` token in the prompt (checked in `validate.ts`; Voice Box,
  not yet wired, will write them) and sets `flags.voice_rebind_required` when a change moves a
  spoken line, changes its speaker or hides the speaker's face.
- Sample mode (`sample/director.ts`, `sample/block-revision.ts`) is deterministic, passes the
  dami's own `check()`, and covers all three Director modes.

## Craft pipeline: film director and cinematographer (not wired yet)

The new four-step prompting pipeline: (1) FILM DIRECTOR, (2) CINEMATOGRAPHER, (3) Breakdown (code,
groups shots into 15/30 s blocks), (4) prompter. Steps 1 and 2 are damis here.

- `film-director/`: the owner's Director master prompt (`source/director_master_prompt.md`,
  copied verbatim into `prompt-text.ts`). `film-director` runs MODE B steps 1, 2, 4, 5 and 7 only:
  with a Director Style Card it turns the script into `shotPlanSchema` (notes, changes, scene
  geography, beats and ordered shots with full staging, dialogue reusing the v1.4 dialogue shape).
  No prompt text, no continuity bible, no physical descriptions: assets are named by id only.
  `film-director-card` is MODE A (a director's name in, `{ card_markdown }` out), run by hand
  with `pnpm dami:run film-director-card <input.json> --live`.
- `film-director/styles/`: the Director Style Cards (`<id>.card.md` reviewed, copied into
  `<id>.card.ts`, a test keeps them equal). The Nolan card is a marked placeholder until the live
  Mode A run replaces it.
- `cinematographer/`: the owner's six DP cards (`source/`, copied into `cards/`), listed with
  their modes in `library.ts`. One dami, input discriminated on `mode`: `look` (once per film:
  camera and light language, one card mode per scene) and `scene` (per scene: lens, light,
  framing, grade and texture per shot). Structured output needs one closed schema, so the model
  answers a `{ mode, look | null, scene | null }` wrapper and `finalize` returns the mode's half.
- `src/server/direction/craft.ts`: `pickCraft` returns the defaults (Nolan, Deakins) until the
  owner's "brain" dami decides them from the Style step.

## Video Review and the router

- `video-review/` is the owner's VIDEO_REVIEW v1.0 (Sonnet, medium effort): it compares a generated
  clip's keyframes, the server's detected cuts and the asset sheets with the block that asked for it
  and reports windows, cuts, identity, boundary, audio, issues (cause, kind, severity, suggested
  route), keep candidates and what is not checkable. The system prompt is the owner's file from
  `<role>` through `</output_format>` (`prompt-text.ts`, checked against `source/`); the file's
  `<frame_extraction_spec>` and `<router>` are the server's code and stay out of the prompt.
- The input holds file ids only: sheets, frames and PREV_END are image parts, each preceded by its
  label line (`SHEET char_1 (MOHAMMAD)`, `FRAME f07 t=8.0s window 4-9s planned shot 2`,
  `PREV_END`). The frame labels are written by `planFrames`; `MAX_PROMPT_IMAGES` (40) is checked by
  the input schema.
- `check()` enforces: evidence frame ids exist, one entry per planned window, `pass` only without a
  blocker or major issue, the route follows the cause (artifact to reroll, binding to rebind,
  instruction_miss to revise), the cut counts match the server's detection.
- **Flow.** The generation completion hook (`applyTakeGenerationResult`) moves a succeeded take to
  `in_review` and, when its block has a usable Director direction, sets `auto_review = pending` and
  queues `take.review` (drafts and finals alike: a final is a re-render that can differ, and a
  rejected final costs a paid draft). The user can decide at once; the screen shows "Checking the
  clip…" until the report is there. `production/take-check.ts` (`runTakeCheck`) downloads the clip,
  `detectCuts`, `planFrames` from the direction's shot windows, `extractFrames` +
  `storeReviewFrames`, builds the input (block subset from `direction`, the Continuity Bible from the
  direction run, the Creative Bible's guards and locks when ready, the expected and actual reference
  binding, the bound assets' sheets and up to 6 other characters' sheets, PREV_END from the
  previous block's accepted take), runs the dami and stores the report on the take
  (`auto_review = ready`). It also stores the clip's last frame (`last_frame_file_id`). A failure
  on the last attempt sets `auto_review = failed`; blocks without direction are `skipped`. Nothing
  here ever blocks the user.
- **Review screen.** The report's issues become plain sentences with their time range (the
  `label`s) the user can dismiss one by one; the keep candidates are shown as "Looks good" points
  kept unless unticked; the user can mark a stretch of the clip with the playhead and write a note
  on it; the free-text box stays. Only ids and the user's words go to the server.
- **The router** (`production/router.ts`, pure) decides from the confirmed issues, the notes and
  the binding; `production/take-routing.ts` is its database side. Reject runs, in the router's
  order: **rebind** (a confirmed wrong-reference finding whose binding really is wrong: the
  references are fixed in code and a new draft is made with the same prompt, route `rebind`),
  **revise** (missed instructions, any note or timed note, an identity confusion despite a right
  binding, an artifact that came back in 2 rerolls in a row: a `review` row with
  `revision_request` is written and `requestBlockRevision` is called; when the revised block
  version is prepared, `production/revision-draft.ts` approves it and creates its draft take
  with the price the user confirmed), **reroll** (confirmed rendering artifacts only: the same
  prompt and references as a new variant, route `reroll`). Revise wins over rebind over reroll, and
  every route ends in one new draft, so the confirmation is always one draft's price
  (`quoteTakeSpend` also names the route). There is no cap on generations.
- **Accepting** a clip makes sure its last frame is stored (PREV_END) and applies the owner's rule
  6 (`shouldMarkNextStale`) as a notice, not a block: when the accepted shot's end differs from the
  Director's original plan for it and the next shot already has a clip, the next shot's current
  version gets `handoff_notice` ("The shot before now ends differently.", event
  `production.handoff_changed`). "Update This Shot" (`production/handoff.ts`) revises it with a
  system hand-off note in any state; with clips it supersedes them and the revised version gets a
  draft at the price the user confirmed (stored on the review row). A new version has no notice.

## Agent drafts and retired damis

- Still on agent-written prompts (no owner file yet): `script-checker/` (reads the `script_checker`
  slice) and `script-reviser/`.
- Retired and deleted: `prompt-sectioner` and `text-blocks` (the Director writes the final prompts;
  binding is code), `block-reviser` (Block Revision), `take-fixer` (Video Review + the router
  - Block Revision), `asset-prompt-writer` and `asset-fixer`, `sheet-generator` and `sheet-fixer`
    (the owner's designers and sheet makers). The Asset Detector v1 is replaced by v2.

## Runs, concurrency and the light entry

- `dami_run.status` is `queued`, `running`, `succeeded`, `failed` or `aborted`. `aborted` means
  the call was cancelled (`DamiAbortedError`: the job's signal fired, e.g. a worker shutdown or an
  expired attempt; never retried) or the run was swept. `sweepStuckDamiRuns({ stuckAfterMinutes?,
now?, db? })` marks `running` rows older than 90 minutes (default) as `aborted`; the worker's
  `dami.sweep` job runs it every 15 minutes. The update is conditional on `running`, so a run that
  finishes concurrently is never overwritten.
- `DAMI_MAX_CONCURRENCY` limits concurrent Claude calls per process, not per fleet: one shared
  `Semaphore` (`getProcessClaudeLimiter`) covers every dami in the process, and a call waiting for
  a slot leaves the queue when its signal aborts. The fleet total is processes times the limit.
- `@/server/damis/light` is the entry for pages and other web-bundle code: the catalog reader, the
  designer lookups, the mode getter and a few constants, with no runner, no sample
  client and no prompt text. Import it instead of `@/server/damis` when that is all you need.

## Registry

`DAMIS` in `index.ts` lists every live dami by key and `SAMPLE_GENERATORS` in `sample/client.ts`
has one deterministic generator for each; `registry.test.ts` keeps the two in step.

## Images

A message part may be `{ image: { fileId } }`: the dami input keeps only file ids. In live mode
`runDami` loads each image from storage, downscales it to 1568 px on the long edge and sends it as a
base64 image block (injectable as `DamiRunnerDeps.resolveImage`); sample mode never reads storage.
`DamiRunContext.maxOutputTokens` overrides a dami's `maxOutputTokens` for one call.

## Prompt layout (for prompt caching)

- system: the dami's base prompt (cache breakpoint), then the composed modules (cache breakpoint);
- user message: project parameters and per-request content. The Director caches the script and
  bible block, so the plan call and every batch share it.

## Adding or changing a dami

Any change to a dami's prompt, its modules' text, or its schema: bump its `version` (it is stored
on every run and review). Add a module by creating one file under `modules/genres` or
`modules/styles` and listing it in `modules/registry.ts`.
