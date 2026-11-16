/**
 * The action model behind `ActionMenu`: one list of actions per object, shown as its context
 * menu (right-click, long press), its "…" menu and its keyboard keys. Plain data and pure
 * helpers, so a Server Component can build link-only menus too.
 */
import type { ReactNode } from "react";

interface ActionBase {
  /** Stable within the menu. */
  id: string;
  /** Title Case verb; end with "…" when more input follows ("Rename…"). */
  label: string;
  /** 16px lucide icon, optional. */
  icon?: ReactNode;
  /**
   * Key that runs the action while its object is hovered or focused, and shown in the menu:
   * "enter" (open), "r" (rename), "d" (download), "delete" (remove or archive, always through
   * the existing confirm). See `formatShortcut` for the combo syntax.
   */
  shortcut?: string;
  /** Red label: removes or archives something. */
  destructive?: boolean;
  disabled?: boolean;
}

/** Runs a callback. */
export interface CommandAction extends ActionBase {
  onSelect: () => void;
  href?: never;
  copy?: never;
}

/** Opens an address, in this tab or (`newTab`) a new one. */
export interface LinkAction extends ActionBase {
  href: string;
  newTab?: boolean;
  onSelect?: never;
  copy?: never;
}

/** Copies an address (made absolute) to the clipboard, with a toast. */
export interface CopyAction extends ActionBase {
  copy: string;
  onSelect?: never;
  href?: never;
}

export type ActionItem = CommandAction | LinkAction | CopyAction;

/** Falsy entries are skipped, so conditions can sit inline: `[canRename && rename]`. */
export type ActionEntry = ActionItem | null | undefined | false;

/** Groups of actions; a separator is drawn between groups. */
export type ActionGroups = readonly (readonly ActionEntry[])[];

/** Drops falsy entries and empty groups. */
export function normalizeActions(groups: ActionGroups): ActionItem[][] {
  return groups
    .map((group) => group.filter((entry): entry is ActionItem => Boolean(entry)))
    .filter((group) => group.length > 0);
}

/** "Open in New Tab" and "Copy Link" for anything with an address. */
export function linkExtras(href: string): ActionItem[] {
  return [
    { id: "open-new-tab", label: "Open in New Tab", href, newTab: true },
    { id: "copy-link", label: "Copy Link", copy: href },
  ];
}

/** "Open Image in New Tab" for a picture, given its address (`fileSrc(fileId)`). */
export function imageExtras(src: string): ActionItem[] {
  return [{ id: "open-image", label: "Open Image in New Tab", href: src, newTab: true }];
}

/** `href` resolved against the page's origin ("/projects/1" → "https://host/projects/1"). */
export function absoluteUrl(href: string, origin: string): string {
  return new URL(href, origin).toString();
}
