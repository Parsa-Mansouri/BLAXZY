---
version: 1
slug: "src-app"
primary_target: "src/app"
related_targets: ["src/ui"]
---

# App surface brief: the whole signed-in application and account pages

Scope: `src/app/**` and the UI kit in `src/ui/**`. Visitor mode: **Operate**.

Audience and job: a film director at a desk in a dim room, moving a project through four stages.
Success: they always know where they are, what the one next step is, and their own titles and
images are the most prominent thing on screen. Must stay untouched: the black ground, the BLAXZY
wordmark, all behaviour, routes and server code. A polished result would still feel wrong if it
looked like a web dashboard: boxes, a coloured accent, a narrow centred column, marketing copy.

## Direction contract

THESIS: BLAXZY is a calm, Apple-like film studio on black: a floating library sidebar on the
left, one clear task per screen on the right. Source of truth: the owner-approved mockups
(November 2026). It refuses the web-dashboard arrangement of top bar, centred column and boxes.

OWN-WORLD: true black ground; a floating rounded sidebar (#0f0f11); dark tiles (#141416); white
as the only accent (one white capsule per screen); colour only for status (done green, waiting
amber, working grey, failed red). Geist for everything, Geist Mono only for status lines,
Courier Prime on a paper sheet for screenplay text. Type scale 48 / 34-28 / 18 / 17 / 15 / 14 /
13, nothing smaller. Fixed words in capitals; user-written names keep their case.

STORY: every signed-in page opens with a 48px capital title rising out of a mask, a 48x3 white
rule wiping in, and one sentence; then the one thing the user is here to do, largest and
brightest, with alternatives present but quieter. Lists on the left choose what the focus area
on the right shows; review is non-linear.

FIRST VIEWPORT (Home, 1440 wide): the floating sidebar (wordmark, outlined New Project, HOME and
PROJECTS, recent films as single rows under a hairline, Account at the foot), then a large hero
for the current film with its status line and Continue, then the films as tiles whose actions
slide up over the picture.

FORM: user-pinned direction from the approved mockups. Inside a project the library sidebar
stays; the four stages are a slim strip in the toolbar, with a back control on deeper pages.

SIGNATURE INTERACTION: one curve, cubic-bezier(.32,.72,0,1), for everything: the title rise, the
rule and selected-row wipes, staggered entrances in 40ms steps, a 250ms fade on every state swap,
one sliding tab underline, cover panels over pictures, buttons pressing to 98%. Reduced motion
removes all movement.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
