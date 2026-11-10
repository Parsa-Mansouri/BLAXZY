"use client";

import type { ReactElement, ReactNode } from "react";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import { cn } from "./cn";
import { menuPad, menuRow, popupSurface } from "./styles";

export interface MenuProps {
  /** The element that opens the menu (usually an IconButton or a row). */
  trigger: ReactElement;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  className?: string;
}

/** A pull-down menu of commands. Items are Title Case verbs; add "…" when more input follows. */
export function Menu({
  trigger,
  children,
  open,
  onOpenChange,
  side = "bottom",
  align = "start",
  className,
}: MenuProps) {
  return (
    <BaseMenu.Root open={open} onOpenChange={onOpenChange}>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner
          side={side}
          align={align}
          sideOffset={4}
          collisionPadding={8}
          className="z-(--z-popover)"
        >
          <BaseMenu.Popup
            className={cn(
              popupSurface,
              menuPad,
              "flex max-w-[calc(100vw-1rem)] min-w-48 flex-col",
              className,
            )}
          >
            {children}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}

export interface MenuItemProps {
  children: ReactNode;
  onClick?: () => void;
  /** Red label for commands that remove something. */
  destructive?: boolean;
  disabled?: boolean;
  /** Shortcut shown on the trailing side, e.g. "⌘N". */
  shortcut?: string;
  /** Render as another element, e.g. `render={<Link href="/account" />}`. */
  render?: ReactElement;
  className?: string;
}

export function MenuItem({
  children,
  onClick,
  destructive = false,
  disabled,
  shortcut,
  render,
  className,
}: MenuItemProps) {
  const content = (
    <>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut ? <kbd className="font-sans text-label-2">{shortcut}</kbd> : null}
    </>
  );
  const classes = cn(menuRow, destructive && "text-red", className);
  if (render) {
    return (
      <BaseMenu.LinkItem render={render} className={classes}>
        {content}
      </BaseMenu.LinkItem>
    );
  }
  return (
    <BaseMenu.Item onClick={onClick} disabled={disabled} className={classes}>
      {content}
    </BaseMenu.Item>
  );
}

/** A thin line between groups of commands. */
export function MenuSeparator() {
  return <BaseMenu.Separator className="mx-2 my-1 h-(--hairline) bg-separator" />;
}

/** A non-interactive line at the top of a menu, e.g. the signed-in email. */
export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="truncate px-2 pt-1 pb-1.5 text-callout text-label-2">{children}</div>;
}
