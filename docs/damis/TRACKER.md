# Dami tracker

Every dami BLAXZY runs or plans to run, the latest owner (Hamed) file for it, and where it stands in
the code. Update this file whenever an owner file arrives or a dami is wired, upgraded or retired.

Last updated: 2026-11-16 (owner drop of 2026-11-16 unpacked into `inbox/2026-11-16/`, including the
Wizard question bank).

## Status key

- **live (owner)**: the owner's file is implemented and wired into the worker.
- **upgrade available**: live on an older owner version; a newer file is in the inbox.
- **delivered, not wired**: the owner's file is in the inbox; no code yet.
- **agent draft**: running on an agent-written prompt; no owner file exists.
- **retire**: an agent draft that an owner dami replaces once that dami is wired.

## Damis

| # | Dami | Stage | Latest owner file | Status | Code (`src/server/damis/`) | Notes |
|---|---|---|---|---|---|---|
| 1 | Creative DNA (DAMI-00, output_10 "Creative Bible") | Style (end) | `creative-dna/source/dami_00_creative_dna.system.md` v1.0, plus the registry, `output_10.schema.json` and `creative_dna.tests.json` in the same folder; `inbox/2026-11-16/creativeDna.ts` (reference code only) | live (owner); not yet fed to other damis (Phase 2) | `creative-dna/` | Runs once per project. Its registry (6 genres, 7 styles) replaces `modules/genres` and `modules/styles`; its per-dami slices feed every later dami. |
| 2 | Enhancer | Script | `enhancer/source/blaxzy_enhancer_dami.md` | live (owner) | `enhancer/` | |
| 3 | Script Writer + outline | Script | `script-writer/source/dami_script_writer_v0.2.md` + `script_output.schema.json` | live (owner) | `script-writer/` | Has its own revise mode (19 reason codes). |
| 4 | Script Checker | Script | none | agent draft | `script-checker/` | Creative DNA has a `for_script_checker` slice, so the owner expects this dami. File owed. |
| 5 | Script Reviser | Script | none | agent draft | `script-reviser/` | May be redundant with the Script Writer's revise mode. Ask the owner. |
| 6 | Asset Detector (output_21) | Pre-production | `inbox/2026-11-16/asset_detector_dami_v2.md` + `asset_detector_review_catalog_v2.json` | upgrade available (v1 live) | `asset-detector/` | v2 drops voices as assets: no `voices[]`, no `voice_` ids; adds per-character `dialogue_language`, `voice_delivery`, `voice_hints` and per-scene `speakers` / `heard_only`. |
| 7 | Character Generator | Pre-production | `character-generator/source/character_generator_dami_v5.md` | live (owner) | `character-generator/` | |
| 8 | Location Generator | Pre-production | `location-generator/source/location_generator_dami_v1.md` (+ `location_shared_modules_v1.md`) | live (owner) | `location-generator/`, `location-shared/` | |
| 9 | Prop Generator | Pre-production | `prop-generator/source/prop_generator_dami_v1.md` (+ `prop_shared_modules_v1.md`) | live (owner) | `prop-generator/`, `prop-shared/` | |
| 10 | Sheet Generator: character (output_30) | Pre-production | `sheet-generator-character/source/sheet_generator_character_v4.md` | live (owner) | `sheet-generator-character/` | |
| 11 | Sheet Generator: location | Pre-production | `sheet-generator-location/source/sheet_generator_location_v1.md` | live (owner) | `sheet-generator-location/` | |
| 12 | Sheet Generator: prop | Pre-production | `sheet-generator-prop/source/sheet_generator_prop_v1.md` | live (owner) | `sheet-generator-prop/` | |
| 13 | Director (output_22) | After script approval (background) | `inbox/2026-11-16/dami_director.system.md` v1.3 | delivered, not wired | none | Replaces the parked `pending/blaxzy_director_dami.md` (v1, marked wrong). Modes `full`, `plan`, `write_blocks`. Ships a code-side validator spec. |
| 14 | Text Blocks / reference binding | Production | none | agent draft | `text-blocks/` | Role unclear now that the Director writes final prompts; Video Review still expects reference bindings "from the Text Blocks stage". Ask the owner. |
| 15 | Block Revision | Production | `inbox/2026-11-16/dami_block_revision.system.md` v1.4 | delivered, not wired | `block-reviser/` (agent draft, to be replaced) | Minimal-diff fixes, sliders, keep list, escalation levels 1 to 4, attempt history. |
| 16 | Video Review (+ Router, code) | Production | `inbox/2026-11-16/dami_video_review.system.md` v1.0 | delivered, not wired | none | Vision review of keyframes; needs ffmpeg cut detection and frame extraction. The Router (rebind, revise, reroll; 6-generation cap) is backend code, not a dami. |
| 17 | Prompt Sectioner | Production | none | retire | `prompt-sectioner/` | Replaced by the Director. |
| 18 | Take Fixer | Production | none | retire | `take-fixer/` | Replaced by Video Review + Block Revision. |

## Logical damis named by the question bank (no owner file yet)

`inbox/2026-11-16/BLAXZY_Wizard_Question_Bank_FA.docx` (v1.0, Persian; plain text alongside as
`.extracted.txt`) section 8 names these roles. It says they need not be separate calls, and that no
dami should be built per genre/style/asset combination (shared core + genre/style rules + asset-kind
module + project brief instead).

| Role | What it does | Status | Notes |
|---|---|---|---|
| Extraction | Turns free input (idea, uploaded script, prompt, reference note) into structured fields | none | Partly done today by the Enhancer and the designers' prompt path. |
| Gap detection | Finds required decisions still unanswered | none | |
| Question selector | Picks the next question from the bank (base / conditional / optional, never re-ask an answered one) | none | Could be code, not a dami. Today each designer has a fixed `questions.ts`. |
| Consistency check | Finds conflicts (duration vs script length, world rules vs script, "is this deliberate?") and asks the user | none | Overlaps Creative DNA `conflicts` and the Script Checker. |
| Brief builder | Prepares the brief for the writer, asset designer or block builder | none | Overlaps Creative DNA slices. |
| Revision | Turns feedback (RV01 to RV04: technical or preference, what, scope, what to keep) into a bounded change | none | Overlaps Block Revision and each designer's fix mode. |

## Question bank (Wizard, v1.0)

133 questions with ids, answer options and show conditions, plus the approval gates:

| Ids | Stage | Count |
|---|---|---|
| P01 to P28 | Style / project brief: format, duration, frame, genre and tone, visual language, world and period, audience, speech, language, limits; P28 = brief approval gate | 28 |
| S01 to S22 | Script: entry path, uploaded-script permissions, idea development, no-idea path, series, S21 = script approval gate | 22 |
| A01 to A04, C01, C02 | Pre-production entry: asset list review, start path per asset, reference role, character branch | 6 |
| H, AN, R, F | Character branches: human, animal, robot, fantasy/hybrid | 8 / 6 / 6 / 7 |
| L, ST | Location and set / set dressing (set is a new asset level) | 8 / 6 |
| PR, V | Prop and vehicle | 7 / 2 |
| VO | Voice identity, voice permission, music and ambience | 7 |
| AP01, AP02 | Two gates: base design, then sheet | 2 |
| B01 to B06 | Production blocks; B06 = explicit cost and re-generation approval before paid work | 6 |
| G01 to G08 | Take review and delivery | 8 |
| RV01 to RV04 | Shared revision panel for every stage | 4 |

## Owner files in the inbox not needed

- `inbox/2026-11-16/asset_detector_dami_v1.md`: identical to `asset-detector/source/asset_detector_dami_v1.md`.
- `inbox/2026-11-16/asset_detector_review_catalog_v1.json`: identical to `asset-detector/review-catalog.json` (except a trailing newline).
- `inbox/2026-11-16/creativeDna.ts`: the owner's sample runner. Reference only; it reads files at module load, uses `any` and calls the SDK directly, so it is not used as code.

## Open questions for the owner

Answered (2026-11-16, by the user): **Text Blocks is retired** (the Director writes the final prompts;
reference binding is code). **Change requests are free text everywhere**: no reason catalogs, no
technical/preference step, no sliders on any review screen; the catalogs stay in `source/` as
reference only, and Creative DNA's `review_options` are not shown. **Generations are unlimited**, but
every paid generation (looks, sheets, drafts, finals, fixes, retries, regenerations) asks the user to
confirm the credits first, with a per-user "Don't ask again" that the Account page can turn off.

1. **Script Checker:** is an owner file coming?
2. **Text Blocks:** with Director v1.3 writing the final prompts, is this dami only reference binding and voice, or is it gone?
3. **Review options:** the static review catalogs per dami versus Creative DNA's per-project `review_options`. Which one feeds the reject flow, and at which review points?
4. **Voices:** Asset Detector v2 removes voices as assets, but Director v1.3 and Block Revision still carry `voices[]` / `voice_1`. Which is right?
5. **Asset tokens:** the Director uses `@char_1` tokens; BLAXZY uses real names ("Mara (2)") inside the app. Confirm the mapping is ours to do.
6. **Registry language:** all module fields except `specialization_en` and `shared_core_en` are Persian. Is an English version coming, or does Creative DNA always translate?
7. **"Other" genre or style:** a typed genre or style has no registry module, and Creative DNA needs a real `genre.*` / `style.*` id. What should happen?
8. **Noir tile copy:** the Style screen describes Noir as "rain-slick streets and smoky light", which the registry's Noir guards forbid. Change the copy?
9. **Genre list:** question P08 offers 11 genres (adds mystery, crime, romance, fantasy, adventure) plus a secondary genre (P09); the registry and the Style screen have 6 and one genre. Which is right?
10. **Style split:** P12 (medium: realistic, 3D, 2D, stop-motion, illustrated, mixed) and P13 (look: natural, noir, minimal…) split what the registry treats as one style choice of 7. Which model wins?
11. **Voice timing:** the bank designs voices in Pre-production (VO01 to VO07, a "voice" category card); Asset Detector v2 moves voices to Production, per block. Which is current?
12. **Set / set dressing:** the bank adds a "set" level under a location (ST01 to ST06) and a vehicle branch for props. Is that a new asset kind for the detector and designers?
13. **Logical damis:** are owner files coming for extraction, gap detection, question selection, consistency check and brief building, or should we build the selector as code?
