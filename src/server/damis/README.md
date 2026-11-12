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
