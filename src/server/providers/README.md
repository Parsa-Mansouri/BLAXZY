# providers

The generation provider layer (`@/server/providers`, contract in `docs/M2_M3_CONTRACTS.md`). It
is the only module that knows which backend is active; everything else calls `getProvider()` and
`pickModel()` and stores what they return on the `generation` row.

- `policy.ts`: `MODEL_POLICY` and `pickModel(purpose, style)`. **The single place to change model
  ids, resolutions and aspect ratios.** Looks and shots follow the project's orientation
  (16:9 / 9:16); sheets are always 16:9.
- `types.ts`: `GenerationProvider` (`price`, `create`, `getStatus`, `fetchResult`). A running
  status may carry `retryAfterMs`. A `failed` status with `retryable: true` means "ask the same
  provider job again later"; a provider whose job is dead for good returns `retryable: false`.
- `sample/`: `SampleProvider` (`GENERATION_PROVIDER=sample`, the default). No network, no cost.
  The whole job state is encoded in the provider job id (`sample_<base64url JSON>`: ready-at time,
  outcome, purpose, aspect ratio, label, request digest), so any process can poll any job.
  `fetchResult` renders a deterministic PNG with sharp from an SVG: dark ground, the label large,
  the purpose small, an amber "SAMPLE" badge and watermark; sheets are a multi-panel layout.
  Prompt switches: `[[fail]]` fails for good; `[[flaky]]` reports one retryable failure for
  `FLAKY_WINDOW_MS` after it is ready, then succeeds. Prices: look 4, sheet 6, video draft 20,
  final 60. Video is not rendered yet (`create` refuses it).
- `higgsfield.ts`: stub; every call throws `ProviderNotConfiguredError`.

## sharp

`sharp` (pinned exact in `package.json`) is loaded lazily, only when a sample image is rendered.
The worker bundle keeps it external (`--external:sharp`); the Docker image installs the same
version for the image's platform in `/app/worker/node_modules` and adds DejaVu fonts for SVG text.
