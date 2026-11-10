/**
 * Shared class recipes. Every colour comes from a token (see globals.css),
 * so changing the brand never requires editing a component.
 */

export type ControlSize = "md" | "lg";

/** Bordered surface used by Input, Select trigger, DatePicker trigger, DurationInput. */
export const controlSurface =
  "flex w-full items-center gap-2 rounded-md border border-line-strong bg-sunken text-fg " +
  "transition-[border-color,background-color] duration-(--duration-fast) " +
  "hover:border-fg-subtle focus-within:border-focus " +
  "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus " +
  "has-[[aria-invalid=true]]:border-danger " +
  "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 has-[:disabled]:hover:border-line-strong";

export const controlHeight: Record<ControlSize, string> = {
  md: "min-h-11",
  lg: "min-h-13",
};

/** 16px on phones prevents iOS zoom on focus. */
export const controlText = "text-base sm:text-sm";

/** Floating panels (popover, select list, tooltip-like surfaces). */
export const popupSurface =
  "popup-motion rounded-lg border border-line bg-raised text-fg shadow-lg outline-none";

export const itemRow =
  "relative flex cursor-default select-none items-center gap-3 rounded-sm px-3 py-2 text-sm outline-none " +
  "data-[highlighted]:bg-hover data-[disabled]:opacity-40 data-[selected]:text-fg";
