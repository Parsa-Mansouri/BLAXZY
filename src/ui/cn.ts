import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge told about the token names in globals.css. Without this it reads a text style
 * such as `text-body` as a colour and drops it when `text-label` follows.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        "large-title",
        "title-1",
        "title-2",
        "title-3",
        "headline",
        "body",
        "reading",
        "script",
        "callout",
        "subheadline",
        "footnote",
        "wordmark",
      ],
      radius: [
        "control",
        "control-inner",
        "field",
        "group",
        "artwork",
        "popover",
        "sheet",
        "capsule",
      ],
      shadow: ["float"],
    },
  },
});

/** Joins class names and resolves Tailwind conflicts (later wins). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
