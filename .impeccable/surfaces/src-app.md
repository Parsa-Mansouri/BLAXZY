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

THESIS: BLAXZY is a native-feeling Apple media app (TV, Photos, Music on macOS) that happens to
run in a browser: a sidebar library on the left, the user's films as artwork on black on the
right. It refuses the web-dashboard arrangement of top bar, centred column and bordered cards.

OWN-WORLD: true black content ground; a solid, slightly lifted sidebar with a hairline edge;
Apple's dark semantic greys for labels, fills and separators; white as the only accent (white
capsule primary buttons with black text, white-tint selection); colour only for status. SF Pro
through the system stack with Inter as the fallback, at macOS text-style sizes with Apple's
tracking. Small precise controls, hairline separators and inset grouped lists instead of cards.
Artwork tiles with continuous-looking rounded corners and captions beneath.

STORY: the user sees their films first, understands the current project and its stage at a
glance, and takes the single prominent action in the toolbar or hero.

FIRST VIEWPORT (Home, 1440 wide): sidebar 240px with the wordmark at top, Library rows (Home,
All Projects), a Recent Projects section, and the account row at the bottom. A 52px toolbar with
the sidebar toggle at the far leading edge, the page title, and one white capsule "New Project"
at the trailing edge. Content is left-aligned and full-bleed to the content margins: an "Up Next"
hero for the most recent project (a wide title card with the film title set large, its stage,
and a Continue capsule), then a shelf grid of project title cards with captions.

FORM: user-pinned direction (Apple design language, media apps, classic solid collapsible
sidebar, white-only accent). No concept roll was run because the direction was pinned by the
owner; build path is code-led (no image generation in this session).

SIGNATURE INTERACTION: the sidebar collapse and expand, a single spring-like slide where content
reflows without jumping, remembered between visits; inside a project the sidebar becomes that
project's stage list.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
