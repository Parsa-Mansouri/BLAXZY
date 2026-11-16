import { linkExtras, type ActionGroups } from "@/ui";

/** The action menu of anything that only opens a page: Open, Open in New Tab, Copy Link. */
export function navActions(href: string, label = "Open"): ActionGroups {
  return [[{ id: "open", label, href }], linkExtras(href)];
}
