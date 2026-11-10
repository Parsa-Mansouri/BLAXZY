# damis

Claude-powered processes. Import only from `@/server/damis` (`index.ts`). This module is the only
code that calls the Claude API and the only writer of `dami_run`.

## Layout

- `framework/` `defineDami`, `runDami` (validation, structured output, streaming, retries,
  concurrency limit, corrective retry, `dami_run` bookkeeping), errors, models, pricing.
- `modules/` genre and visual-style prompt modules (one file each), format/orientation text, and
  `composeModules` (fixed order: genre, style, format, orientation; generic fallbacks).
- `shared/` craft rules shared by damis, the `ProjectStyle` schema, duration planning, line tools.
- One folder per dami: `schema.ts`, `prompt.ts`, `dami.ts`, `fixtures/` (`input.json` for
  `pnpm dami:run`, `model-output.json` for tests), and a test.

## Prompt layout (for prompt caching)

- system: the dami's base prompt (cache breakpoint), then the composed modules (cache breakpoint);
- user message: project parameters and per-request content. The prompt-sectioner also caches the
  numbered script, so all its segment calls share it.

## Adding or changing a dami

Any change to a dami's prompt, its modules' text, or its schema: bump its `version` (it is stored
on every run and review). Add a module by creating one file under `modules/genres` or
`modules/styles` and listing it in `modules/registry.ts`.
