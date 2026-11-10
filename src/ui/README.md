# UI kit

Presentational components in Apple's design language (dark, macOS media-app proportions), built
on Base UI primitives. They never import from `@/server/**`. Import everything from `@/ui`. Review
the whole kit at `/dev/ui` (development only).

## Tokens

Every visual decision lives in `src/app/globals.css`. Tailwind's default palette, type scale,
radii and shadows are cleared, so only these names exist. There is one theme: dark.

| Group       | Tailwind names                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backgrounds | `bg-ground` (#000, content), `bg-elevated` (#1C1C1E, sidebar, grouped lists, artwork), `bg-elevated-2` (#2C2C2E, menus, popovers, sheets), `bg-elevated-3`, `bg-scrim`                                                                                                                                                                                                                                                    |
| Labels      | `text-label` (primary), `text-label-2` (secondary, AA on every ground), `text-label-3` / `text-label-4` (decoration and disabled only)                                                                                                                                                                                                                                                                                    |
| Separators  | `bg-separator`, `bg-separator-opaque`; utilities `hairline-t`, `hairline-b`, `hairline-r` (1px, 0.5px on 2x screens)                                                                                                                                                                                                                                                                                                      |
| Fills       | `bg-fill`, `bg-fill-2`, `bg-fill-3`, `bg-fill-4` (control backgrounds), `bg-segment-selected`                                                                                                                                                                                                                                                                                                                             |
| Accent      | `bg-accent` / `text-on-accent`: the one pair reserved for the brand colour (white and black today). `bg-selection` is the white-tint selection.                                                                                                                                                                                                                                                                           |
| Status      | `red`, `green`, `orange`, `yellow` (status only), `text-on-red`                                                                                                                                                                                                                                                                                                                                                           |
| Type        | `text-large-title` 26/32, `text-title-1` 22/26, `text-title-2` 17/22, `text-title-3` 15/20, `text-headline` 13/16, `text-body` 13/16, `text-reading` 14/20, `text-script` 15/22, `text-callout` 12/15, `text-subheadline` 11/14, `text-footnote` 10/13, `text-wordmark`. Each carries its line height, tracking and weight. On touch screens and below 640px the iOS scale replaces them (Body 17/22, Large Title 34/41). |
| Radii       | `rounded-control` 6, `rounded-control-inner` 4, `rounded-field` 10, `rounded-group` 10, `rounded-artwork` 12, `rounded-popover` 12, `rounded-sheet` 14, `rounded-capsule`                                                                                                                                                                                                                                                 |
| Depth       | `shadow-float`: floating surfaces only (menus, popovers, sheets, toasts)                                                                                                                                                                                                                                                                                                                                                  |
| Sizes       | `h-(--control-h)` 28, `h-(--control-h-lg)` 32, `--row-h` 36, `--row-h-lg` 40, `--sidebar-row-h` 28, `--menu-row-h` 24 (all 44 on touch), `--icon` 16, `--sidebar-w` 240, `--toolbar-h` 52, `px-(--content-x)` 28 / 16 on phones, `max-w-(--measure)`, `--form-w`, `--settings-w`                                                                                                                                          |
| Motion      | `duration-(--dur-fast\|dur-base\|dur-slide-motion)`, `ease-out`, `ease-spring`; utilities `popup-motion` and `fade-motion`. Reduced motion keeps fades and removes movement.                                                                                                                                                                                                                                              |
| Layers      | `z-(--z-toolbar)`, `z-(--z-drawer)`, `z-(--z-overlay)`, `z-(--z-modal)`, `z-(--z-popover)`, `z-(--z-toast)`, `z-(--z-tooltip)`                                                                                                                                                                                                                                                                                            |
| Focus       | `focus-ring` (keyboard focus: 2px white at 70%, 2px offset), `focus-ring-within` for wrappers                                                                                                                                                                                                                                                                                                                             |

Never hard-code a colour or size in a component. `cn()` knows the token names above, so
`cn("text-body", "text-label")` keeps both.

## Rules of the language

- No boxes. Content sits on the black ground, separated by space and hairlines. The only
  containers are `GroupedList`, artwork (`TitleCard`) and floating surfaces.
- One `prominent` button (white capsule) per screen at most. Everything else is `standard`,
  `plain` or `destructive`. `destructive-confirm` (red fill) only inside an `Alert`.
- Title Case for buttons, menu items and titles; sentence case with a full stop for help text.

## Components

- Window: `SplitView` (sidebar + content, collapse with Ctrl/Cmd+\, cookie-persisted, drawer
  below 960px), `SidebarToggle`, `SidebarHeader` / `SidebarBody` / `SidebarSection` /
  `SidebarItem` / `SidebarFooter`, `Toolbar`, `StageList`, `TitleCard`.
- Controls: `Button`, `IconButton`, `Field`, `Input`, `Textarea`, `Select` (pop-up button),
  `Menu` / `MenuItem` / `MenuSeparator` / `MenuLabel`, `SegmentedControl`, `ChoiceCards` (option
  thumbnails), `DatePicker`, `Calendar`, `DurationInput`.
- Lists: `GroupedList`, `GroupedListRow`, `GroupedListField` (form row with a bare input),
  `GroupedListButton`.
- Overlays: `Sheet` (also exported as `Dialog`), `Alert`, `Popover`, `Tooltip`, toasts.
- Status: `Badge`, `Spinner`, `ProgressBar`, `Skeleton`.

## Hints

Three levels, quiet to loud: `Hint` (footnote text), `HelpTip` (the round "?" button that opens a
popover), `Tip` (a first-run, TipKit-style arrowed popover; show one at a time). `useDismissed(key)`
persists a dismissal in `localStorage` (SSR-safe; `dismissed` is `true` until the client knows).
