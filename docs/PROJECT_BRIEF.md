# BLAXZY — project brief

Written 2026-11-10 from the kickoff discussion. This is the reference for what BLAXZY is, how the
Wizard works, what has been decided and what is still open. Update it when a decision changes.

## What it is

BLAXZY is a self-hosted AI film-generation platform. A user describes or uploads a script and the
platform takes them, step by step, to a full set of generated clips for their film or series.

- **Owner and idea:** Hamed, a film director and one of the heaviest generative-video users around.
- **Audience:** directors and creators who can edit but find the AI tooling (Higgsfield, Flow,
  model choice, prompting) hard to learn. BLAXZY should be plug and play: nobody has to learn it.
- **Difference from other tools:** others give you one clip. BLAXZY gives you every clip of the
  production, organised, ready for an editor.
- **Technology:** Next.js web app, Claude API for all text and reasoning work, Higgsfield for
  image and video generation, Postgres, S3-compatible storage.

It has two sectors:

- **Wizard** — fewer features, far easier. Built first. Described below.
- **Pro** — for experienced users like Hamed, with much more control. Comes later and will be a
  different product on the same core. See [PRO_READINESS.md](PRO_READINESS.md).

## Prototype

`github.com/Hamed1920/shahnameh-cli` ("Film Making for Dummies") proved the idea works: prompts
in, priced before spending, generated through the Higgsfield CLI, reviewed, accepted or denied
with notes, regenerated. It stores everything in files, CSVs and git for one reviewer on one
machine, and cleanliness was never a goal, so BLAXZY is a rewrite that ports its ideas:

- price every job before generating; nothing runs until the total is approved
- video as a cheap 480p draft first, finished as the same video at full quality
- references attached as images and called inline in the prompt (`<<<image_N>>>`)
- every asset and take has a stable ID; nothing is deleted

## Vocabulary

- **Dami** — a predefined process the Claude API runs: write a script, check a script, detect
  assets, build a character sheet, fix a specific defect. Damis are narrow and deep. They are
  composed from modules (base + genre + style) instead of one prompt per combination.
- **Asset** — anything in the story that must look or sound consistent: character, location,
  prop, voice, and so on.
- **Sheet** — the reference image built from an accepted asset (character sheet, prop sheet) in
  the form generation models use best.
- **Block** — one generation unit: a section of the script, its prompt and its attached assets.
- **Output_NN** — the named results in the flowchart ([wizard-flowchart.png](wizard-flowchart.png)).

## The platform around the Wizard

Accounts (better-auth): sign up, log in, change password, general account controls. A dashboard
shows recent projects, credits and "start a project". Starting a project enters the Wizard.

## The Wizard: four stages

### 1. Style → Output_01
The platform asks about the project: style (animation, cinematic, ...), genre, movie or series,
duration (total and per episode for a series), portrait or landscape. These answers select and
tailor the script dami for exactly this project.

### 2. Script → Output_021 (assets) and Output_022 (prompts)
- Has a script? **Upload** it and a dami checks it. No script? **Describe** it briefly and a dami
  writes it.
- Either way the user **reviews** it: read, comment, reject with notes, repeat until accepted.
- On acceptance the **asset detector** dami lists every character, prop, location and other asset
  in the story (Output_021).
- The user moves straight on to pre-production. In the background another dami turns the script
  into directed 15 or 30 second blocks with ready-to-paste prompts (Output_022, the Director).

### 3. Pre-production → Output_030
- A large category screen (characters, locations, props, ...), not a list. Voices are not assets: they are chosen in Production, per block.
- Inside a category, each detected asset has a + to add its image: **upload** it or **generate**
  it. Generating offers a full prompt written by the user, or a series of guided questions that
  capture the best descriptors for that kind of asset.
- The user **reviews** the asset. Once accepted, the **sheet generator** dami builds its sheet
  while the user carries on with the next asset.
- When every asset is done, the user reviews every sheet and sends back any that are wrong.

### 4. Production → Output_04
- The directed blocks (Output_022) get their assets bound by code: the approved sheets (Output_030)
  are attached to each block in order.
- The user previews each block (assets, prompt, script section), checks the assets, then does a
  final review of all blocks.
- Blocks go to Higgsfield. **BLAXZY chooses the models; the Wizard user never does.**
- The user confirms the credits before every paid generation (there is no cap), then reviews each clip, accepting or denying it; a dami checks every clip first and a router turns a rejection into a rebind, a revision or a re-roll. When all are accepted they receive
  every plan, scene and output.

## How review works (everywhere)

Whenever a user rejects something, they say **what the issue is in their own words**: one free-text
box, no catalog of reasons (an earlier idea offered concrete options such as "the face is not fully
generated"; it was dropped, and so was the question). The
earlier idea of first asking "technical or personal preference?" was dropped too; the system can
classify that itself.

Every review stores the decision, the reason and the version of the dami that produced the
rejected output. Developers will use that feedback to improve damis by hand; there is no
automatic learning loop for now.

## Decisions

| Topic | Decision |
|---|---|
| Deliverable | Individual clips, organised. An assembled video may come later as an update. |
| Script edits after acceptance | The script is versioned. Asset detection re-runs as a diff; accepted assets are kept and only affected blocks go stale. |
| Series | Handled by the damis: per-episode scripts and blocks, assets shared across episodes. |
| Higgsfield account | One main account that BLAXZY keeps topped up. Users pay for their usage plus a margin. |
| Higgsfield access | Move from the CLI to the Higgsfield API (no machine-bound login, concurrency grows with spend, dollar billing). To be confirmed by a spike. |
| First video render | Seedance 2.5 draft (480p). An approved draft is finished as that exact video. |
| Failures (content refusals, failed jobs) | Communicated to the user; damis try to prevent them. |
| Interface language | English only. |
| Signup | Open signup with email verification. New accounts start with zero balance. |
| Brand | Hamed is defining it. Build on neutral design tokens that can be swapped. |
| Hosting | Self-hosted. GitLab and servers are being prepared by devops; until then everything runs locally in Docker. |

## UI and UX direction

- The goal is that nobody has to learn the tool. Give hints throughout, directly and subtly, at
  every step.
- Maximum simplicity, in the spirit of Apple's interface guidelines: clarity, one thing at a time,
  progressive disclosure.
- Every control is custom: dropdowns, date pickers, everything.
- Where the user types to the system, it must not look like ChatGPT. It should feel exciting and
  clearly different from a normal chatbot. Script review is a document with comments, not a chat.

## Open questions

- **Cost model:** what a real project costs BLAXZY and what the user pays. A 15-second Seedance 2.5
  block is roughly $3 at API list price before retries.
- **Retries:** who pays when a regeneration is needed because of a technical defect.
- **Payments:** which gateway, and how users buy credits.
- **Launch scale:** how many users generating at once.
- **Higgsfield API spike:** confirm draft mode with exact-video finishing, reference images with
  inline tokens, Nano Banana Pro availability, a free price check, and the terms on reselling.
- **Review fatigue:** an automatic quality-check dami and batch accept to cut the number of
  approvals. Agreed in principle, not yet designed.

## Build order

1. **M0 Foundation** — scaffold, local Docker, accounts, UI kit and hint system, dashboard shell.
2. **M1 Style + Script** — stages 1 and 2 with real Claude calls.
3. **M2 Engine** — Higgsfield API, provider layer, per-user credit ledger, fair queue.
4. **M3 Pre-production.**
5. **M4 Production.**
6. **M5 Launch** — payments, admin tools, abuse protection, deployment.
