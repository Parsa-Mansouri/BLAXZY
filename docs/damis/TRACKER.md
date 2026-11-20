# Dami tracker

Every dami BLAXZY runs or plans to run, the latest owner (Hamed) file for it, and where it stands in
the code. Update this file whenever an owner file arrives or a dami is wired, upgraded or retired.

Last updated: 2026-11-20 (owner drop of 2026-11-20: the new prompting pipeline. The Director
master prompt (first style: Nolan) and six cinematographer cards are wired as Film Director and
Cinematographer; a code Breakdown groups their shots into blocks; Director v1.4 writes the prompts
until the owner's Prompter file arrives. The Style step asks for the block length).

## Prompting pipeline (from 2026-11-20)

Style step question (15 s / 30 s blocks; shot by shot later) → script + output_10 + output_21 →
① Film Director (row 21) → ② Cinematographer (row 22, `look` once + `scene` per scene) →
③ Breakdown (code, row 23) → ④ Prompter (row 24; Director v1.4 bridges) → validator (code) →
output_22 → Block Revision. A future **Brain** dami (row 25) will pick the director and the
cinematographer from the Style step; until then `src/server/direction/craft.ts` picks Nolan and
Deakins.

## Status key

- **live (owner)**: the owner's file is implemented and wired into the worker.
- **agent draft**: running on an agent-written prompt; no owner file exists.
- **received (not wired)**: the owner's file is in `inbox/<date>/`; no code yet.
- **retired**: removed from the code; an owner dami replaced it.

## Damis

| # | Dami | Stage | Latest owner file | Status | Code (`src/server/damis/`) | Notes |
|---|---|---|---|---|---|---|
| 1 | Creative DNA (DAMI-00, output_10 "Creative Bible") | Style (end) | `creative-dna/source/dami_00_creative_dna.system.md` v1.0, plus the registry, `output_10.schema.json` and `creative_dna.tests.json` in the same folder; `reference/creativeDna.ts` (reference code only) | live (owner) | `creative-dna/` | Runs once per project. Its registry (6 genres, 7 styles) replaces `modules/genres` and `modules/styles`; its per-dami slices feed every later dami (see `src/server/damis/README.md`). |
| 2 | Enhancer | Script | `enhancer/source/blaxzy_enhancer_dami.md` | live (owner) | `enhancer/` | |
| 3 | Script Writer + outline | Script | `script-writer/source/dami_script_writer_v0.2.md` + `script_output.schema.json` | live (owner) | `script-writer/` | Has its own revise mode (19 reason codes). |
| 4 | Script Checker | Script | none | agent draft | `script-checker/` | Creative DNA has a `for_script_checker` slice, so the owner expects this dami. File owed. |
| 5 | Script Reviser | Script | none | agent draft | `script-reviser/` | May be redundant with the Script Writer's revise mode. Ask the owner. |
| 6 | Asset Detector (output_21) | Pre-production | `asset-detector/source/asset_detector_dami_v2.md` (+ `review-catalog.json`) | live (owner, v2) | `asset-detector/` | v2 drops voices as assets: no `voices[]`, no `voice_` ids; adds per-character `dialogue_language`, `voice_delivery`, `voice_hints` and per-scene `speakers` / `heard_only`. |
| 7 | Character Generator | Pre-production | `character-generator/source/character_generator_dami_v5.md` | live (owner) | `character-generator/` | |
| 8 | Location Generator | Pre-production | `location-generator/source/location_generator_dami_v1.md` (+ `location_shared_modules_v1.md`) | live (owner) | `location-generator/`, `location-shared/` | |
| 9 | Prop Generator | Pre-production | `prop-generator/source/prop_generator_dami_v1.md` (+ `prop_shared_modules_v1.md`) | live (owner) | `prop-generator/`, `prop-shared/` | |
| 10 | Sheet Generator: character (output_30) | Pre-production | `sheet-generator-character/source/sheet_generator_character_v4.md` | live (owner) | `sheet-generator-character/` | |
| 11 | Sheet Generator: location | Pre-production | `sheet-generator-location/source/sheet_generator_location_v1.md` | live (owner) | `sheet-generator-location/` | |
| 12 | Sheet Generator: prop | Pre-production | `sheet-generator-prop/source/sheet_generator_prop_v1.md` | live (owner) | `sheet-generator-prop/` | |
| 13 | Director (output_22) | After script approval (background); since 2026-11-20 it is the ④ Prompter bridge (row 24) | `director/source/dami_director.system.md` v1.4 | live (owner) | `director/` | v1.4 (2026-11-19): voices are not assets (`assets.heard_only` for speakers heard but not seen, no bible `voices`, no `voice_` ids), dialogue `heard_as`, voice notes only from detector facts; v1.3 blocks already stored still parse. Wired (Phase 4): `script.direct` runs `full` for up to ~8 blocks, else `plan` plus `direction.write` batches of ~8 (`write_blocks`). Replaced the earlier Director v1, which the owner marked wrong. Blocks arrive directed (15 or 30 s); a project without a Creative Bible gets a stub bible. Code-side validator is `director/validate.ts`. |
| 14 | Text Blocks / reference binding | Production | none | retired | none | Retired (Phase 4). The Director writes the final prompts; reference binding is code (`bindAssetTokens`/`tagAssetIds` at store time, `production/binding.ts` at preparation). Folder, sample and tests deleted. |
| 15 | Block Revision | Production | `block-revision/source/dami_block_revision.system.md` v1.5 | live (owner) | `block-revision/` (the draft block-reviser is retired) | v1.5 (2026-11-19): follows Director v1.4 assets, keeps `<<<audio_N>>>` tokens, adds `flags.voice_rebind_required`. Minimal-diff fixes, sliders, keep list, escalation levels 1 to 4, attempt history. |
| 16 | Video Review (+ Router, code) | Production | `video-review/source/dami_video_review.system.md` v1.0 | live (owner) | `video-review/` | Run by the `take.review` job on every generated clip of a directed block (ffmpeg cut detection and keyframes, the report on the take). The Router (rebind, revise, reroll) is backend code (`production/router.ts`, `take-routing.ts`), not a dami; there is no 6-generation cap (generations are unlimited, each confirmed by the user). |
| 17 | Prompt Sectioner | Production | none | retired | none | Retired (Phase 4), replaced by the Director. Folder, sample generator, tests and `script.section` job deleted. |
| 18 | Take Fixer | Production | none | retired | none | Retired (Phase 6), replaced by Video Review + the router + Block Revision. Folder, sample generator, tests and the `take.fix` job deleted. |
| 19 | Storyboard (output_31) | New STORYBOARD stage, between Pre-production and Production | `inbox/2026-11-19/dami_storyboard.system.md` v1.0 | received (not wired) | none yet | One storyboard sheet per block: turns a Director block plus the approved asset sheets (attached as images) into one Nano Banana prompt for a pencil storyboard, one numbered panel per shot, red movement marks; modes `first` / `fix` (free-text change request, optional panel numbers). Re-runs a block only when its block version or a sheet it uses changes. Opus, low effort. Needs: a new wizard stage, a storyboard version table (like `asset_sheet`), a `storyboard_image` generation purpose, and the live Higgsfield provider (stub today). |
| 20 | Voice Box (output_23 + voice_cast) | Production, between the text-block preview and generation | `inbox/2026-11-19/dami_voice_box.system.md` v1.0 + `voice_box_review_catalog_v1.json` | received (not wired) | none yet | Modes `detect` (per block: lines, delivery type, timing fit, recommended source upload / tts / native), `cast` (once per speaking character, picks from the TTS voice catalog or writes a voice-design prompt; consent rules for cloning) and `bind` (TTS requests, upload checks, line placement, `<<<audio_N>>>` reference audio, rewritten Audio line, mix plan). Sonnet. Needs Director v1.4 / Block Revision v1.5 (done), ElevenLabs TTS through Higgsfield, an `audio` generation kind, voice uploads with consent, and an ffmpeg mix step; `take.generate` hard-codes `sound: true` today (native only). |
| 21 | Film Director (① shot plan) | After script approval (background) | `film-director/source/director_master_prompt.md` (drop 2026-11-20, sent as "director-master-prompt nolan.md"); style cards in `film-director/styles/` | live (owner) | `film-director/` | Mode B steps 1, 2, 4, 5 and 7 only: beats, director's notes, scene geography, mise-en-scène per shot, shot timing. No prompt text and no physical descriptors (the sheets own appearance). Style library: Nolan only. **`styles/nolan.card.md` is a placeholder** until the Mode A card is generated by one live run of `film-director-card`. |
| 22 | Cinematographer (② visual layer) | After the Film Director | `cinematographer/source/`: Deakins v1.2, Christopher Doyle v1.1, Delbonnel v1.2, Gordon Willis v1.3, Lubezki v1.2, Storaro v1.2 (drop 2026-11-20; the library change brief is `reference/enhancer-library-update.md`, already applied to every card) | live (owner) | `cinematographer/` | The card is sent verbatim as the system prompt. `look` runs once per direction (one card mode per scene), `scene` once per scene (lens, light, framing, grade and texture per shot). Structured JSON replaces the cards' Rule 3. Default card: Deakins. |
| 23 | Breakdown (③) | After the Cinematographer | none (code) | code | `src/server/direction/breakdown.ts` | Groups the shots into 15 or 30 s blocks without splitting a shot, within the platform budgets. Shot by shot is planned but cannot be written until the Prompter exists. |
| 24 | Prompter (④) | After the Breakdown | none yet | owner file owed | bridged by `director/` (v1.4, `write_blocks`) | Until the file arrives, v1.4 gets each block's shot plan and visual layer and writes the output_22 blocks. |
| 25 | Brain | Style step | none yet | planned (owner) | `src/server/direction/craft.ts` (placeholder) | Will decide the director style and the cinematographer per project. |

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

## Owner files outside `source/` folders

- `reference/creativeDna.ts`: the owner's sample runner for Creative DNA. Reference only; it reads
  files at module load, uses `any` and calls the SDK directly, so it is not used as code and is not
  compiled.
- `inbox/2026-11-16/BLAXZY_Wizard_Question_Bank_FA.docx` (+ `.extracted.txt`): the Wizard question
  bank, kept for the next plan. Every other file of the 2026-11-16 drop is copied into its dami's
  `source/` folder; the superseded Asset Detector v1 files are in git history only.
- `inbox/2026-11-19/`: `dami_storyboard.system.md`, `dami_voice_box.system.md` and
  `voice_box_review_catalog_v1.json`, waiting for their build phases (rows 19 and 20). The rest of
  that drop: Director v1.4 and Block Revision v1.5 replaced the files in their `source/` folders
  (the earlier versions are in git history); its Director v1.3, Block Revision v1.4 and Video
  Review v1.0 copies were identical to the wired files and were not kept.

## Decisions and open questions

Answered by the user (2026-11-16):

- **Text Blocks is retired.** The Director writes the final prompts; reference binding is code.
- **Change requests are free text everywhere.** No reason catalogs, no technical/preference step,
  no sliders on any review screen; Creative DNA's `review_options` are not shown. The catalogs stay
  in the repo only for their rules (edit-eligible codes, design-change routing).
- **Generations are unlimited, with credit confirmation.** Every paid generation (looks, sheets,
  drafts, finals, fixes, retries, regenerations) asks the user to confirm the credits first, with a
  per-user "Don't ask again" that the Account page can turn off.
- **Voices move to Production.** Asset Detector v2 drops voices as assets; they are chosen per
  block in Production, not in Pre-production.
- **Projects are named automatically** from the first story (project namer, ours, no owner file);
  a rename by the user always wins.

Still open for the owner (Hamed):

1. **Script Checker:** is an owner file coming? (Creative DNA has a `for_script_checker` slice.)
2. **Script Reviser:** redundant with the Script Writer's revise mode?
3. ~~**Voices in the Director and Block Revision.**~~ Answered by the 2026-11-19 drop: Director
   v1.4 and Block Revision v1.5 have no `voices[]` and no `voice_` ids.
4. **Asset tokens:** the Director uses `@char_1` tokens; BLAXZY uses real names ("Mara (2)") inside
   the app. Confirm the mapping is ours to do.
5. **Registry language:** all module fields except `specialization_en` and `shared_core_en` are
   Persian. Is an English version coming, or does Creative DNA always translate?
6. **"Other" genre or style:** a typed genre or style has no registry module, so no Creative Bible
   is compiled and the Director gets a stub bible. Is that acceptable?
7. **Noir tile copy:** the Style screen describes Noir as "rain-slick streets and smoky light",
   which the registry's Noir guards forbid. Change the copy?
8. **Genre list (question bank):** P08 offers 11 genres (adds mystery, crime, romance, fantasy,
   adventure) plus a secondary genre (P09); the registry and the Style screen have 6 and one genre.
   Which is right?
9. **Style split (question bank):** P12 (medium: realistic, 3D, 2D, stop-motion, illustrated, mixed)
   and P13 (look: natural, noir, minimal…) split what the registry treats as one choice of 7. Which
   model wins?
10. **Voice timing (question bank):** the bank designs voices in Pre-production (VO01 to VO07, a
    "voice" category card); we follow Asset Detector v2 and handle voices in Production. Confirm.
11. **Set / set dressing (question bank):** the bank adds a "set" level under a location (ST01 to
    ST06) and a vehicle branch for props. Is that a new asset kind for the detector and designers?
12. **Logical damis (question bank):** are owner files coming for extraction, gap detection,
    question selection, consistency check and brief building, or should we build the selector as
    code?
13. **Storyboard stage:** the Storyboard file adds a wizard stage between Pre-production and
    Production (style, script, pre-production, **storyboard**, production). Confirm it is a full
    stage with its own approval gate, and whether a project can skip it.
14. **Voice Box review catalog:** `voice_box_review_catalog_v1.json` is a reason-code menu with a
    technical/preference step (RV01). BLAXZY decided on free-text change requests everywhere;
    Voice Box would follow that too (catalog kept for its rules: cast-change confirmation, consent,
    G07 mapping). Confirm.
15. **Voice catalog and cloning:** Voice Box `cast` picks from the TTS engine's voice catalog and
    can clone a consented sample. Which Higgsfield (ElevenLabs) endpoints and voice list do we
    use, and is cloning allowed on our plan?
16. **Prompter file (2026-11-20 pipeline):** step ④ has no owner file yet. Director v1.4 writes the
    prompts from the Breakdown's blocks until it arrives; shot by shot waits for it too.
17. **Brain dami:** will pick the director style and the cinematographer from the Style step. Until
    it arrives every project uses Nolan and Deakins.
18. **Nolan card:** we generate the master prompt's Mode A card with one live run. Does the owner
    want to review it, or will he send his own?
