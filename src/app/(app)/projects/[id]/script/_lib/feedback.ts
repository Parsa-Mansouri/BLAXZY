/**
 * A short sideways shake (220ms, on the app's curve) for a field whose input was refused. Does
 * nothing under reduced motion or where the Web Animations API is missing.
 */
export function shake(element: HTMLElement | null) {
  if (!element || typeof element.animate !== "function") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  element.animate(
    [
      { transform: "translateX(0)" },
      { transform: "translateX(-6px)" },
      { transform: "translateX(5px)" },
      { transform: "translateX(-3px)" },
      { transform: "translateX(0)" },
    ],
    { duration: 220, easing: "cubic-bezier(0.32, 0.72, 0, 1)" },
  );
}
