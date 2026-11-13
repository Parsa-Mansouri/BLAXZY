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
- `@/server/damis/light` is the entry for pages and other web-bundle code: review catalogs and
  their helpers, issue and reason code lists, and the mode helpers, with no runner, no sample
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
- user message: project parameters and per-request content. The prompt-sectioner also caches the
  numbered script, so all its segment calls share it.

## Adding or changing a dami

Any change to a dami's prompt, its modules' text, or its schema: bump its `version` (it is stored
on every run and review). Add a module by creating one file under `modules/genres` or
`modules/styles` and listing it in `modules/registry.ts`.
