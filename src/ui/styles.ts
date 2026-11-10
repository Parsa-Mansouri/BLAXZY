/**
 * Shared class recipes. Every colour, radius and size comes from a token in globals.css, so a
 * brand change never requires editing a component.
 */

/** Text-field surface: a grey fill, no border at rest, a white ring on keyboard focus. */
export const fieldSurface =
  "flex w-full items-center gap-2 bg-fill-3 text-label focus-ring-within " +
  "has-[[aria-invalid=true]]:ring-1 has-[[aria-invalid=true]]:ring-red has-[[aria-invalid=true]]:ring-inset " +
  "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50";

/** Field shapes: forms use 10px corners and the large height, toolbars 6px and regular. */
export const fieldShape = {
  form: "min-h-(--control-h-lg) rounded-field px-3",
  toolbar: "min-h-(--control-h) rounded-control px-2",
} as const;

export type FieldVariant = keyof typeof fieldShape;

/** Floating surfaces: menus, popovers, pop-up lists, tips. */
export const popupSurface =
  "popup-motion rounded-popover bg-elevated-2 text-label shadow-float outline-none";

/** One row in a menu or pop-up list. */
export const menuRow =
  "flex min-h-(--menu-row-h) cursor-default items-center gap-2 rounded-control px-2 text-body text-label outline-none select-none " +
  "data-[highlighted]:bg-selection data-[disabled]:text-label-3";

/** Popup padding that keeps menu-row corners concentric with the popup's corners. */
export const menuPad = "p-1.5";
