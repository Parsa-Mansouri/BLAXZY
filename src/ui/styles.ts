/**
 * Shared class recipes. Every colour, radius and size comes from a token in globals.css, so a
 * brand change never requires editing a component.
 */

/** Text-field surface: a dark tile with a grey outline, a white ring on keyboard focus. */
export const fieldSurface =
  "flex w-full items-center gap-2 border border-separator-opaque bg-elevated text-label focus-ring-within " +
  "transition-[border-color] duration-(--dur-press) " +
  "has-[[aria-invalid=true]]:border-red " +
  "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50";

/**
 * Field shapes: `form` 44px with 12px corners (forms, sign-in), `toolbar` 36px capsule (search
 * and filters), `line` a borderless field on a single underline for a big title input.
 */
export const fieldShape = {
  form: "min-h-(--control-h-lg) rounded-field px-3.5",
  toolbar: "min-h-(--control-h) rounded-capsule px-4",
  line: "rounded-none border-0 border-b bg-transparent px-0 pb-3",
} as const;

export type FieldVariant = keyof typeof fieldShape;

/** Floating surfaces: menus, popovers, pop-up lists, tips. */
export const popupSurface =
  "popup-motion rounded-popover bg-elevated-2 text-label shadow-float outline-none";

/** One row in a menu or pop-up list. */
export const menuRow =
  "flex min-h-(--menu-row-h) cursor-default items-center gap-2 rounded-row px-3 text-secondary text-label outline-none select-none " +
  "data-[highlighted]:bg-selected data-[disabled]:text-label-3";

/** Popup padding that keeps menu-row corners concentric with the popup's corners. */
export const menuPad = "p-1.5";
