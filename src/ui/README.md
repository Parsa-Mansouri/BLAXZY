# UI kit

Presentational components built on Base UI primitives. They never import from `@/server/**`.
Import everything from `@/ui`. Review them all at `/dev/ui` (development only), dark and light.

## Theming

All visual decisions live in `src/app/globals.css`. Dark is the default; light is
`<html data-theme="light">`. Components only use the Tailwind names below, so a new brand means
editing that one file.

| Group     | Tailwind names                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Surfaces  | `bg-bg` (page), `bg-sunken` (inputs), `bg-surface` (cards), `bg-raised` (popups), `bg-scrim` (modal backdrop), `bg-hover`, `bg-pressed` (washes) |
| Text      | `text-fg`, `text-fg-muted`, `text-fg-subtle`                                                                                                     |
| Borders   | `border-line`, `border-line-strong`, `outline-focus`                                                                                             |
| Accent    | `bg-accent`, `bg-accent-hover`, `bg-accent-soft`, `text-accent-text`, `text-on-accent`                                                           |
| Status    | `text-success` / `bg-success-soft`, `text-warning` / `bg-warning-soft`, `bg-danger` / `text-danger` / `bg-danger-soft`, `text-on-danger`         |
| Radii     | `rounded-xs` 6, `rounded-sm` 8, `rounded-md` 10 (controls), `rounded-lg` 16 (surfaces), `rounded-xl` 24                                          |
| Elevation | `shadow-xs`, `shadow-md`, `shadow-lg`                                                                                                            |
| Type      | `text-xs` ... `text-4xl` (each carries its line height), `tracking-tight`, `font-sans`, `font-mono`                                              |
| Motion    | `duration-(--duration-fast\|base\|slow)`, `ease-(--ease-out)`, `ease-(--ease-in-out)`; reduced motion collapses durations to ~0                  |
| Layers    | `z-(--z-sticky)`, `z-(--z-overlay)`, `z-(--z-modal)`, `z-(--z-popover)`, `z-(--z-toast)`, `z-(--z-tooltip)`                                      |
| Layout    | `px-(--gutter)` (16px, 24px from `sm`), `max-w-(--measure)`                                                                                      |
| Utilities | `focus-ring` (keyboard focus outline), `popup-motion` (enter/exit for Base UI popups)                                                            |

Never hard-code a colour in a component. Spacing uses the default Tailwind 4px scale; controls are
44px tall (`md`) or 52px (`lg`) for touch.

## Hints

Three layers, from quiet to loud: `Hint` (always visible line), `HelpTip` (the "?" on hover, focus
or tap), `CoachMark` (first-time callout, controlled by `open` / `onDismiss`). `useDismissed(key)`
persists a dismissal in `localStorage` (SSR-safe; `dismissed` is `true` until the client knows).
