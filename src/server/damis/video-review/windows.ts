/** `4-9s`, `4 - 9 s` and `4–9s` compare equal. */
export const windowKey = (window: string): string =>
  window.replace(/\s+/g, "").replace(/[–—]/g, "-").toLowerCase();
