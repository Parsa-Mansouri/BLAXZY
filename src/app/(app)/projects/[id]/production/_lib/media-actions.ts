import { fileSrc } from "@/lib/file-src";
import type { ActionItem } from "@/ui";

/** "Open Video in New Tab" for a stored clip. */
export function videoExtras(fileId: string): ActionItem[] {
  return [
    { id: "open-video", label: "Open Video in New Tab", href: fileSrc(fileId), newTab: true },
  ];
}
