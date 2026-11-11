# providers

The generation provider layer (`@/server/providers`, contract in `docs/M2_M3_CONTRACTS.md`). It
is the only module that knows which backend is active; everything else calls `getProvider()` and
`pickModel()` and stores what they return on the `generation` row.

- `policy.ts`: `MODEL_POLICY` and `pickModel(purpose, style, video?)`. **The single place to
  change model ids, resolutions and aspect ratios.** Looks and shots follow the project's
  orientation (16:9 / 9:16); sheets are always 16:9. Video params also carry `durationSeconds`
  (whole seconds, clamped to 1..15, default 5), `resolution` (`480p` draft, `1080p` final) and
  `sound` (default false).
- `types.ts`: `GenerationProvider` (`price`, `create`, `getStatus`, `fetchResult`). A running
  status may carry `retryAfterMs`. A `failed` status with `retryable: true` means "ask the same
  provider job again later"; a provider whose job is dead for good returns `retryable: false`.
  A final's request carries `draftProviderJobId` (the accepted draft's provider job).
  `fetchResult` returns the file in memory (`bytes`) or as a stream of known length (`stream`,
  `sizeBytes`), optionally a `poster` (video), and a `dispose()` the caller runs afterwards.
- `sample/`: `SampleProvider` (`GENERATION_PROVIDER=sample`, the default). No network, no cost.
  The whole job state is encoded in the provider job id (`sample_<base64url JSON>`: ready-at time,
  outcome, purpose, aspect ratio, label, request digest), so any process can poll any job.
  `fetchResult` renders a deterministic PNG with sharp from an SVG: dark ground, the label large,
  the purpose small, an amber "SAMPLE" badge and watermark; sheets are a multi-panel layout.
  Video (`video.ts`): a real MP4 (H.264, yuv420p, faststart, 24 fps, a silent AAC track when
  `sound`) of the exact duration; draft 854x480, final 1920x1080 (swapped for 9:16). The still
  parts and a per-frame timecode/frame counter are SVG rendered by sharp; ffmpeg overlays a light
  sweep and a playhead and encodes; a JPEG poster (frame at 1 s) comes with it. The job id keeps
  duration, resolution and sound; a final with `draftProviderJobId` takes the draft's digest as
  its seed, so it is the same clip in higher quality. Output is streamed from a temp dir that
  `dispose` removes. Prompt switches: `[[fail]]` fails for good; `[[flaky]]` reports one
  retryable failure for `FLAKY_WINDOW_MS` after it is ready, then succeeds. Prices: look 4,
  sheet 6, video draft 20, final 60.
- `ffmpeg.ts`: `resolveFfmpeg` (`FFMPEG_PATH`, else the `ffmpeg-static` package, else `ffmpeg` on
  the PATH; `FfmpegUnavailableError`, a non-retryable `ProviderError`, when none works),
  `runFfmpeg`, `probeMedia` (duration and streams, parsed from `ffmpeg -i`; no ffprobe needed).
- `higgsfield.ts`: stub; every call throws `ProviderNotConfiguredError`.

## ffmpeg

`ffmpeg-static` (pinned exact) is for local runs. It is never bundled or traced: the import
carries the Next ignore comments, the `spawn` calls too (a run-time binary path would otherwise
make Next trace the whole project into the standalone output), and the worker bundle keeps it
external. The worker Docker image installs the distribution's ffmpeg and sets `FFMPEG_PATH`; the
web image has no ffmpeg. The Docker dependency install skips `ffmpeg-static`'s binary download.

## sharp

`sharp` (pinned exact in `package.json`) is loaded lazily, only when a sample image is rendered.
The worker bundle keeps it external (`--external:sharp`); the Docker image installs the same
version for the image's platform in `/app/worker/node_modules` and adds DejaVu fonts for SVG text.
