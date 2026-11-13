"use client";

import type { ReactElement, ReactNode } from "react";
import { Popover as BasePopover } from "@base-ui/react/popover";
import { cn } from "./cn";
import { popupSurface } from "./styles";

/** The arrow that points a popover at its anchor. Shared by Popover, HelpTip and Tip. */
export function PopoverArrow() {
  return (
    <BasePopover.Arrow
      className={cn(
        "block h-2 w-4 overflow-clip",
        "data-[side=bottom]:-top-2 data-[side=top]:-bottom-2 data-[side=top]:rotate-180",
        "data-[side=left]:-right-3 data-[side=left]:rotate-90 data-[side=right]:-left-3 data-[side=right]:-rotate-90",
        "before:absolute before:top-1 before:left-1/2 before:size-3 before:-translate-x-1/2 before:rotate-45 before:rounded-[2px] before:bg-elevated-2 before:content-['']",
      )}
    />
  );
}

export interface PopoverProps {
  /** The element that opens the popover. It receives the trigger props. */
  trigger: ReactElement;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  /** Show the pointing arrow (default true). */
  arrow?: boolean;
  /** Accessible name of the panel when it has no visible title. */
  "aria-label"?: string;
  className?: string;
  /** Element to focus on open. Defaults to the first focusable. */
  initialFocus?: React.ComponentProps<typeof BasePopover.Popup>["initialFocus"];
}

export function Popover({
  trigger,
  children,
  open,
  onOpenChange,
  side = "bottom",
  align = "center",
  arrow = true,
  className,
  initialFocus,
  "aria-label": ariaLabel,
}: PopoverProps) {
  return (
    <BasePopover.Root open={open} onOpenChange={onOpenChange}>
      <BasePopover.Trigger render={trigger} />
      <BasePopover.Portal>
        <BasePopover.Positioner
          side={side}
          align={align}
          sideOffset={arrow ? 10 : 4}
          collisionPadding={8}
          className="z-(--z-popover)"
        >
          <BasePopover.Popup
            aria-label={ariaLabel}
            initialFocus={initialFocus}
            className={cn(popupSurface, "max-w-[calc(100vw-1rem)] p-3", className)}
          >
            {arrow ? <PopoverArrow /> : null}
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
