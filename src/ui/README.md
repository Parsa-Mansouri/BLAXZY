# UI kit

Presentational components for BLAXZY's pinned design language: a true black ground, white for
the one primary button, one brand colour for small marks, colour otherwise only for status, Geist
type, one motion curve. Built on Base UI primitives; never imports from `@/server/**`. Import
everything from `@/ui`. Review the whole kit at `/dev/ui` (development only). The approved
mockups are the source of truth for sizes and motion; the "Polish rules" below refine them.

## Tokens

Every visual decision lives in `src/app/globals.css`. Tailwind's default palette, type scale and
radii are cleared, so only these names exist. Names marked legacy still work for older screens;
new code uses the canonical names.

| Group   | Tailwind names                                                                                                                                                                                                                                                                                                                                                                                |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grounds | `bg-ground` #000, `bg-sidebar` #0f0f11, `bg-hero` #0a0a0b, `bg-elevated` #141416 (tiles, fields), `bg-elevated-2` #1c1c1e (cover panels, menus, sheets), `bg-selected` #1f1f22, `bg-scrim`, `bg-paper` / `text-ink`                                                                                                                                                                           |
| Labels  | `text-label` #f2f2f3, `text-label-2` #c9c9ce (secondary, descriptions, inactive nav), `text-label-3` #a1a1a6 (placeholders, disabled, empty tiles; AA on every dark surface), `text-label-4` (decoration only, never text)                                                                                                                                                                    |
| Lines   | `border-separator` #1f1f21 (hairlines), `border-separator-opaque` #3a3a3c (fields, dashed add tiles), `border-outline` #48484a (outlined buttons), `border-outline-quiet` #2e2e31 (also disabled outlines), `border-outline-hero`                                                                                                                                                             |
| Fills   | `bg-fill` #343437 (dark button), `bg-fill-2` (also disabled fills), `bg-fill-3`, `bg-fill-4` (hover)                                                                                                                                                                                                                                                                                          |
| Accent  | `bg-accent` / `text-on-accent` (white / black: the primary button and the white block), `text-on-accent-2` (secondary text on white)                                                                                                                                                                                                                                                          |
| Brand   | `--brand` #5b84ff: `text-brand`, `bg-brand`, `border-brand`, `ring-brand`, `outline-brand`. Small marks only (see rule 11)                                                                                                                                                                                                                                                                    |
| Status  | `done` #30d158, `waiting` #ff9f0a, `working` #8e8e93, `failed` #ff453a (also `green`, `orange`, `grey`, `red`); stage strip `stage-done`, `stage-todo`                                                                                                                                                                                                                                        |
| Type    | `text-display` 48, `text-heading` 34, `text-heading-sm` 28, `text-block-title` 32 (FeatureBlock), `text-cover-title` 22, `text-section` 18, `text-row` 17, `text-control-lg` 16, `text-body` 15/22, `text-secondary` 14/21, `text-meta` 13/18, `text-script` 16/24, `text-hero-title`, `text-wordmark`; `caps-label`; `font-sans`, `font-script`; `mono-value` (Geist Mono + tabular figures) |
| Radii   | `rounded-row` 10, `rounded-tile` 12, `rounded-card` 14, `rounded-panel` 16, `rounded-block` 20, `rounded-paper` 6, `rounded-mark` 2, `rounded-item` 8 (rows in a popup), `rounded-inset` 6 (rows in the sidebar), `rounded-nested` (whatever the parent publishes), `rounded-capsule`                                                                                                         |
| Icons   | `--icon` 16 (beside text), `--icon-lg` 20 (standalone); `--icon-sm` is a legacy alias of 16                                                                                                                                                                                                                                                                                                   |
| Sizes   | `h-(--btn-sm)` 36, `h-(--btn)` 40, `h-(--btn-lg)` 48, `--toolbar-h` 64, `px-(--content-x)` 40 / 16 on phones, `--sidebar-w`, `max-w-(--measure)`                                                                                                                                                                                                                                              |
| Motion  | curve `ease-out` (= cubic-bezier(.32,.72,0,1)); `--dur-press` 150, `--dur-feedback` 250, `--dur-swap` 250, `--dur-tab` 300, `--dur-cover` 360, `--dur-enter` 400, `--dur-wipe` 500, `--dur-rise` 650                                                                                                                                                                                          |
| Legacy  | type `large-title`, `title-1..3`, `headline`, `reading`, `callout`, `subheadline`, `footnote`; radii `control`, `field`, `group`, `artwork`, `popover`, `sheet`; `bg-selection`                                                                                                                                                                                                               |

## Motion classes

Entrances and swaps: `rise-mask` + `rise` (title out of its mask), `rule-in` (the 48x3 rule),
`in-1` / `in-2` / `in-3` (260 / 340 / 420ms entrances), `enter` with `stagger(i)` (repeated
items, 40ms steps), `swap-in` / `SwapFade` (250ms after a state swap), `press` (scale .98),
`row-wipe` (selected fill wipes in; mark the row with `aria-current` or `data-active`),
`cover-host` / `cover-panel` (action panel over a picture), `glow-a` / `glow-b` (Home hero only).
Under reduced motion every animation and transition finishes at once.

### Feedback motion (rule 20)

Motion that confirms what just happened. All 150 to 300ms on the app curve, never decorative,
nothing moves under reduced motion (the global rule finishes them at once).

| Want                                | Use                                                                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A tick that draws in on save/accept | `<Tick />` (16px, brand). Render it only once the thing is done: `{done ? <Tick /> : null}`. `SelectRow done`, `OptionTile` and `OptionRow` already do this.       |
| "Saved" / "Accepted" / "Copied"     | `const [saved, flashSaved] = useFlash()`; call `flashSaved()` after the action succeeds; put `<Confirmation show={saved}>Saved</Confirmation>` beside the control. |
| A row settling into its new state   | Add `settle` and change the element's `key` when its state changes: `<li key={status} className="settle">`.                                                        |
| A field rejecting an answer         | `Field` and `GroupedListField` shake by themselves when `error` appears. Elsewhere add the `shake` class when the error appears.                                   |
| A small thing appearing in place    | `pop-in` (150ms fade-up).                                                                                                                                          |
| Progress moving                     | `ProgressBar` (its fill eases over 300ms).                                                                                                                         |

## Loading (rule 19)

- Buttons: `loading` on `Button` is the pending state: a spinner over the label, the same width,
  clicks and form submits blocked, `aria-busy`. `pendingLabel="Saving"` names it for screen
  readers. For a `<form action={serverAction}>`, use `<SubmitButton>`: it reads React's form
  status and goes pending by itself, so it cannot be submitted twice.
- Routes: every `loading.tsx` is a skeleton shaped like its real screen, inside
  `<SkeletonRegion>` (announced once as "Loading"). Primitives: `SkeletonHeader` (title, rule,
  description, `actions={n}`), `SkeletonText` (`lines`), `SkeletonTile` (`aspect`, `caption`,
  `status`), `SkeletonRows` (a FocusLayout list), `SkeletonButton`, and the raw `Skeleton`.
  The app shell's `PageSkeleton` (library grid) and `StageSkeleton` (project list+focus) live in
  `src/app/_components/route-states.tsx`. Never a lone spinner for a whole page.
- Lists that load more show a pending row (`SkeletonRows rows={1}`) at the end while loading.

## Focus, caret and fields

- Buttons, links, tiles and rows: keyboard focus only (`focus-ring`), a white ring with a 2px
  gap. Not the brand colour.
- Text entry never gets a ring or an outline box. Every kit field (`Input` in all variants,
  `Textarea`, `DurationInput`, the Select search) shows focus by its own border or underline
  turning full white (`field-focus`), plus the caret. `focus-ring` and `focus-ring-within` skip
  text inputs and textareas by themselves, so a screen's own field never gets a box either; give
  it a border and `field-focus`.
- The caret is the text's own colour (`caret-color: currentColor`): white on dark fields, ink on
  the paper and on white blocks.
- Light surfaces (`bg-accent`, `bg-paper`, `paper`) set `--field-focus` to ink, so a field placed
  on them shows focus with a dark border or underline.

## Rules of the language

- Exactly three levels per screen. The main option is bigger and different (`FeatureBlock`, the
  one `primary` button); alternatives stay present but quieter (`QuietTile`, outlined buttons).
- One white button per screen. Buttons are Title Case capsules.
- Nothing under 13px. Secondary text is `text-label-2`.
- Fixed words in titles, nav, stages and tabs are capitals; user-written names keep their case
  (`PageHeader keepCase`).
- Never "x of y" totals for assets, shots or sheets. Never fake a generated image: use
  `PicturePlaceholder` or the "Example image" in `OptionTile`.
- No sample product previews (stage strips, screenplay samples, sample tiles) in the shell, the
  route state pages, the sidebar or any kit component; they belong on the landing page only.

## Polish rules

The owner's 20-point checklist, as kit rules. The kit already follows them; screens must too.

1. **No filler badges.** No pill, chip, tag or counter the person does not act on; no "new" or
   "sample" tags; no status pill beside a StatusLine that says the same. `Badge` is for real
   status in dense lists only.
2. **No redundant labels.** No label that repeats the heading, the placeholder or the obvious.
   Keep what accessibility needs as `aria-label` or `sr-only` text.
3. **No italics.** Base styles set `em`, `i`, `cite` upright; emphasis is weight or colour.
4. **Mono only where needed.** Geist Mono (`<Mono>`, `<Kbd>`, `mono-value`) only for timecodes,
   durations, prices in credits, keyboard shortcuts and file names. `StatusLine` is Geist.
5. **Use the design system.** Tokens and kit components only: no raw colours, inline rgba,
   ad-hoc px sizes, radii or durations, no hand-rolled buttons, fields or rows.
6. **Show the actual product** where the app presents itself (landing only; see the rule above
   on previews). Picture slots without a real image stay labelled placeholders.
7. **Enlarge the main feature.** The one thing the person came for is the largest element.
8. **Group with spacing.** Related things close, separate groups at least 2x further apart;
   space instead of rules and boxes (the sidebar's recent films and `DurationInput` no longer
   draw dividers).
9. **Specific headlines.** Titles say the specific thing: "Is this Jonas?", "No films yet",
   "This Page Could Not Be Shown"; never "Review", "Details", "Something went wrong".
10. **One emphasised CTA.** Exactly one `primary`, `large` button per screen in a predictable
    place; everything else `outlined`, `dark` or `plain`.
11. **One brand accent.** `--brand` (#5b84ff) only for small marks: the rule under the page
    title, the selected ring and tick (`OptionTile`, `OptionRow`, `SelectRow`, `ChoiceCards`),
    the current stage line (`StageStrip`), the tab underline (`Tabs`), text links (`TextLink`,
    `link`, bare links in running text), text selection and the progress fill. Never a status,
    never a large fill, never body text, never the focus ring or caret, never text on the white
    block or the paper (it fails AA there: links turn ink on paper by themselves).
12. **Consistent icons.** Lucide only, stroke 1.5 (the app's `LucideProvider` sets it and a base
    rule enforces it, overriding `strokeWidth` props), 16px (`--icon`) beside text and 20px
    (`--icon-lg`) standalone (`IconButton`, `QuietTile`, `OptionTile` "other", toast close).
    Outlined only; the same icon for the same meaning (Plus = add, Trash2 = delete,
    ChevronLeft = back, CircleHelp = help, Check / `Tick` = done).
13. **No embellishments.** No gradients, glows, shadows, dashed borders, dots or ornaments
    without a function. Kept: the Home hero glow, floating-surface shadows (they separate layers),
    dashed borders on add tiles and drop areas only, the calendar's today dot. The paper sheet's
    shadow is gone.
14. **Concentric corners.** Inner radius = outer radius - padding. Containers publish the radius
    for their children as `--nested-radius`; children use `rounded-nested`. The sidebar panel
    (16, padding 10) gives rows 6px; popups and menus (14, padding 6) give rows 8px
    (`rounded-item`); a 12px field with a chip 6px in gives 6px. When the padding is at least the
    outer radius the child keeps its own shape (capsule buttons in 20px blocks with 24-32px
    padding). Circles in circles share a centre.
15. **AA contrast.** Every text, placeholder and disabled label meets 4.5:1 (3:1 at 24px+) on
    its real background. Disabled controls use `text-label-3` on a dark fill instead of fading
    (no `opacity-40`). On white use `text-on-accent` / `text-on-accent-2`; on paper use ink
    (placeholders 70% ink).
16. **Headlines wrap properly.** Base styles balance every heading and set paragraphs and list
    items `pretty`. `PageHeader` caps the title at 22 characters a line and breaks inside a long
    word rather than overflow; the toolbar cuts a long project name with an ellipsis and shows it
    on hover.
17. **Optical alignment.** `PageHeader` pulls the title left by its side bearing
    (`optical-edge`) so it lines up with the rule and text below. Buttons with a leading or
    trailing icon get 4px less padding on that side. Capitals and numerals in circles use
    `optical-center` (avatars, calendar days). Play triangles use `optical-play`.
18. **Tabular figures.** Numbers that change or are compared align: `StatusLine`,
    `ProgressBar`, `DurationInput`, `Calendar`, `Badge`, `SelectRow` trailing counts, sidebar
    accessories. Elsewhere add `tabular-nums` (Geist) or `<Mono>` (technical values).
19. **Loading states.** See "Loading": shaped `loading.tsx` skeletons, pending buttons
    (`loading`, `SubmitButton`), progress for uploads, a pending row while loading more.
20. **Useful feedback motion.** See "Feedback motion": tick draw-in, confirmation, settle, shake;
    150-300ms, the app curve, off under reduced motion.

## Components

- Window: `SplitView`, `SidebarToggle`, `SidebarHeader` / `SidebarAction` / `SidebarBody` /
  `SidebarSection` / `SidebarItem` / `SidebarFooter`, `Toolbar`, `StageStrip`, `BackControl`.
- Page: `PageHeader`, `FocusLayout` (focus area takes all remaining width; `fill` makes it fill
  the page height as a flex column so the main action can sit at the bottom with `mt-auto`),
  `SelectRow`, `Tabs`, `SwapFade`, `stagger`.
- Pictures and options: `PictureTile`, `PicturePlaceholder`, `TitleCard`, `OptionTile` (`fill`:
  the picture grows to its grid cell), `OptionRow`, `FeatureBlock`, `QuietTile`.
- Text: `PaperSheet`, `ScreenplayAction`, `ScreenplayDialogue`, `TextLink`, `Mono`, `Kbd`.
- Controls: `Button` (`primary`, `outlined`, `dark`, `plain`, `destructive`; `small`, `regular`,
  `large`; `loading`, `pendingLabel`), `SubmitButton`, `IconButton`, `Field`, `Input` (`form`,
  `toolbar`, `line`), `Textarea`, `Select`, `Menu`, `SegmentedControl`, `ChoiceCards`,
  `DatePicker`, `Calendar`, `DurationInput`.
- Lists: `GroupedList`, `GroupedListRow`, `GroupedListField`, `GroupedListButton`.
- Overlays: `Sheet` (also `Dialog`), `Alert`, `Popover`, `Tooltip`, toasts.
- Status: `StatusLine`, `StatusDot`, `Badge`, `Spinner`, `ProgressBar`, `StageList` (legacy
  vertical list).
- Loading: `Skeleton`, `SkeletonRegion`, `SkeletonHeader`, `SkeletonText`, `SkeletonTile`,
  `SkeletonRows`, `SkeletonButton`.
- Feedback: `Tick`, `Confirmation`, `useFlash`.
- Help: `Hint`, `HelpTip`, `Tip`, `useDismissed`.

## Filling the page

Signed-in screens use the whole area right of the sidebar, in width and height. Grids use fluid
columns (`repeat(auto-fit, minmax(<min>, 1fr))`), list+focus screens let the focus area take all
the remaining width, and one-composition screens fill the height under the toolbar: project stage
pages sit in a full-height flex column, so give the main region `flex-1` (or `FocusLayout fill`)
and pin the main action with `mt-auto`. Running text keeps about 70ch; the screenplay paper may
grow to about 820px.
