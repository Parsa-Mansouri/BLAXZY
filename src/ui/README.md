# UI kit

Presentational components for BLAXZY's pinned design language: a true black ground, white as the
only accent, colour only for status, Geist type, one motion curve. Built on Base UI primitives;
never imports from `@/server/**`. Import everything from `@/ui`. Review the whole kit at
`/dev/ui` (development only). The approved mockups are the source of truth for sizes and motion.

## Tokens

Every visual decision lives in `src/app/globals.css`. Tailwind's default palette, type scale and
radii are cleared, so only these names exist. Names marked legacy still work for older screens;
new code uses the canonical names.

| Group   | Tailwind names                                                                                                                                                                                                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Grounds | `bg-ground` #000, `bg-sidebar` #0f0f11, `bg-hero` #0a0a0b, `bg-elevated` #141416 (tiles, fields), `bg-elevated-2` #1c1c1e (cover panels, menus, sheets), `bg-selected` #1f1f22, `bg-scrim`, `bg-paper` / `text-ink`                                                                        |
| Labels  | `text-label` #f2f2f3, `text-label-2` #c9c9ce (secondary, descriptions, inactive nav), `text-label-3` #9a9aa0 (placeholders in empty tiles, disabled), `text-label-4` (decoration only)                                                                                                     |
| Lines   | `border-separator` #1f1f21 (hairlines), `border-separator-opaque` #3a3a3c (fields, dashed tiles), `border-outline` #48484a (outlined buttons), `border-outline-quiet` #2e2e31, `border-outline-hero`                                                                                       |
| Fills   | `bg-fill` #343437 (dark button), `bg-fill-2`, `bg-fill-3`, `bg-fill-4` (hover)                                                                                                                                                                                                             |
| Accent  | `bg-accent` / `text-on-accent` (white / black), `text-on-accent-2` (secondary text on white)                                                                                                                                                                                               |
| Status  | `done` #30d158, `waiting` #ff9f0a, `working` #8e8e93, `failed` #ff453a (also `green`, `orange`, `grey`, `red`); stage strip `stage-done`, `stage-todo`                                                                                                                                     |
| Type    | `text-display` 48, `text-heading` 34, `text-heading-sm` 28, `text-section` 18, `text-row` 17, `text-body` 15/22, `text-secondary` 14/21, `text-meta` 13/18, `text-script` 16/24, `text-hero-title`, `text-wordmark`; `caps-label` (13px capitals); `font-sans`, `font-mono`, `font-script` |
| Radii   | `rounded-row` 10, `rounded-tile` 12, `rounded-card` 14, `rounded-panel` 16, `rounded-block` 20, `rounded-paper` 6, `rounded-capsule`                                                                                                                                                       |
| Sizes   | `h-(--btn-sm)` 36, `h-(--btn)` 40, `h-(--btn-lg)` 48, `--toolbar-h` 64, `px-(--content-x)` 40 / 16 on phones, `--sidebar-w`, `max-w-(--measure)`                                                                                                                                           |
| Motion  | curve `ease-out` (= cubic-bezier(.32,.72,0,1)); `--dur-press` 150, `--dur-swap` 250, `--dur-tab` 300, `--dur-cover` 360, `--dur-enter` 400, `--dur-wipe` 500, `--dur-rise` 650                                                                                                             |
| Legacy  | type `large-title`, `title-1..3`, `headline`, `reading`, `callout`, `subheadline`, `footnote`; radii `control`, `field`, `group`, `artwork`, `popover`, `sheet`; `bg-selection`                                                                                                            |

## Motion classes

`rise-mask` + `rise` (title out of its mask), `rule-in` (the 48x3 rule), `in-1` / `in-2` / `in-3`
(260 / 340 / 420ms entrances), `enter` with `stagger(i)` (repeated items, 40ms steps),
`swap-in` / `SwapFade` (250ms after a state swap), `press` (scale .98), `row-wipe` (selected fill
wipes in; mark the row with `aria-current` or `data-active`), `cover-host` / `cover-panel`
(action panel over a picture), `glow-a` / `glow-b` (Home hero only). Under reduced motion every
animation and transition finishes at once.

## Rules of the language

- Exactly three levels per screen. The main option is bigger and different (`FeatureBlock`, the
  one `primary` button); alternatives stay present but quieter (`QuietTile`, outlined buttons).
- One white button per screen. Buttons are Title Case capsules.
- Nothing under 13px. Secondary text is `text-label-2`. Geist Mono only in `StatusLine`.
- Fixed words in titles, nav, stages and tabs are capitals; user-written names keep their case
  (`PageHeader keepCase`).
- Never "x of y" totals for assets, shots or sheets. Never fake a generated image: use
  `PicturePlaceholder` or the "Example image" in `OptionTile`.

## Components

- Window: `SplitView`, `SidebarToggle`, `SidebarHeader` / `SidebarAction` / `SidebarBody` /
  `SidebarSection` / `SidebarItem` / `SidebarFooter`, `Toolbar`, `StageStrip`, `BackControl`.
- Page: `PageHeader`, `FocusLayout` (focus area takes all remaining width; `fill` makes it fill
  the page height as a flex column so the main action can sit at the bottom with `mt-auto`),
  `SelectRow`, `Tabs`, `SwapFade`, `stagger`.
- Pictures and options: `PictureTile`, `PicturePlaceholder`, `TitleCard`, `OptionTile` (`fill`:
  the picture grows to its grid cell),
  `OptionRow`, `FeatureBlock`, `QuietTile`.
- Text: `PaperSheet`, `ScreenplayAction`, `ScreenplayDialogue`.
- Controls: `Button` (`primary`, `outlined`, `dark`, `plain`, `destructive`; `small`, `regular`,
  `large`), `IconButton`, `Field`, `Input` (`form`, `toolbar`, `line`), `Textarea`, `Select`,
  `Menu`, `SegmentedControl`, `ChoiceCards`, `DatePicker`, `Calendar`, `DurationInput`.
- Lists: `GroupedList`, `GroupedListRow`, `GroupedListField`, `GroupedListButton`.
- Overlays: `Sheet` (also `Dialog`), `Alert`, `Popover`, `Tooltip`, toasts.
- Status: `StatusLine`, `StatusDot`, `Badge`, `Spinner`, `ProgressBar`, `Skeleton`, `StageList`
  (legacy vertical list).
- Help: `Hint`, `HelpTip`, `Tip`, `useDismissed`.

## Filling the page

Signed-in screens use the whole area right of the sidebar, in width and height. Grids use fluid
columns (`repeat(auto-fit, minmax(<min>, 1fr))`), list+focus screens let the focus area take all
the remaining width, and one-composition screens fill the height under the toolbar: project stage
pages sit in a full-height flex column, so give the main region `flex-1` (or `FocusLayout fill`)
and pin the main action with `mt-auto`. Running text keeps about 70ch; the screenplay paper may
grow to about 820px.
