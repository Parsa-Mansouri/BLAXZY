# Owner dami files

Hamed's dami instructions (delivered 2026-11-12) live next to the code that implements them. Each
dami folder under `src/server/damis/` keeps the original files in `source/` and its review catalog
(the "complaint menu" users pick rejection reasons from) as `review-catalog.json`.

The code copies the system-prompt text from `source/` into `prompt.ts`, and a test checks that each
copied block still matches the source. To take a new version from Hamed:

1. Replace the file in `source/`.
2. Run `pnpm test`.
3. Update `prompt.ts` where the test fails, and bump the dami's `version`.

| Owner file | Folder | Kind |
|---|---|---|
| `dami_script_writer_v0.2.md` | `script-writer/source/` | Job description |
| `script_output.schema.json` | `script-writer/source/` | Script form (output schema) |
| `blaxzy_enhancer_dami.md` | `enhancer/source/` | Job description |
| `asset_detector_dami_v1.md` | `asset-detector/source/` | Job description |
| `asset_detector_review_catalog_v1.json` | `asset-detector/review-catalog.json` | Complaint menu |
| `character_generator_dami_v5.md` | `character-generator/source/` | Job description |
| `character_review_catalog_v2.json` | `character-generator/review-catalog.json` | Complaint menu |
| `location_generator_dami_v1.md` | `location-generator/source/` | Job description |
| `location_shared_modules_v1.md` | `location-shared/source/` | Rulebook (shared with the location sheet) |
| `location_review_catalog_v1.json` | `location-generator/review-catalog.json` | Complaint menu |
| `prop_generator_dami_v1.md` | `prop-generator/source/` | Job description |
| `prop_shared_modules_v1.md` | `prop-shared/source/` | Rulebook (shared with the prop sheet) |
| `prop_review_catalog_v1.json` | `prop-generator/review-catalog.json` | Complaint menu |
| `sheet_generator_character_v4.md` | `sheet-generator-character/source/` | Job description |
| `sheet_review_catalog_character_v3.json` | `sheet-generator-character/review-catalog.json` | Complaint menu |
| `sheet_generator_location_v1.md` | `sheet-generator-location/source/` | Job description |
| `sheet_review_catalog_location_v1.json` | `sheet-generator-location/review-catalog.json` | Complaint menu |
| `sheet_generator_prop_v1.md` | `sheet-generator-prop/source/` | Job description |
| `sheet_review_catalog_prop_v1.json` | `sheet-generator-prop/review-catalog.json` | Complaint menu |

## Pending

`pending/blaxzy_director_dami.md` is not wired in. The owner marked this version as wrong, so
Production keeps the current prompt-sectioner, text-blocks, block-reviser and take-fixer flow until a
corrected Director arrives.

## Settings that differ from the files

- **Output format.** The files ask for a forced tool call. The framework uses structured JSON output
  (`output_config.format`) instead, which guarantees the same schema.
- **Temperature.** The installed Anthropic SDK has no temperature setting, so each dami sets `effort`
  instead: `low` where a file says 0.3 or lower, `medium` otherwise.
- **Asset ids.** The detector's `char_1` / `loc_1` ids are translated to BLAXZY's real-name ids
  ("Mara", "Mara (2)") inside the worker. They never reach the database or the UI.
- **Sample mode.** During testing every dami runs in sample mode (`DAMI_MODE=sample`). Each one has
  a deterministic sample generator in `src/server/damis/sample/`, and every wait takes 3 seconds.
- **Designers.** The character, location and prop generators take their reference photos as file
  ids (attached in index order) and name assets by their real names. The location and prop files
  ask for temperature 0.5 on a first run and 0.3 in fix mode: first runs use `medium` effort and
  fix rounds `low`. `max_tokens` is the owner's 6000 doubled for thinking headroom. The prop's
  `script_context` is sent as text, the location's as the owner's scene list; both come from the
  latest detection's scene index and the accepted script. A reference photo's note is sent as the
  location's `reference_instructions.preserve` and the prop's `preserve` text.
