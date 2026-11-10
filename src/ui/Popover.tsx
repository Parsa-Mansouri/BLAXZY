"use client";

import type { ReactElement, ReactNode } from "react";
import { Popover as BasePopover } from "@base-ui/react/popover";
import { cn } from "./cn";
import { popupSurface } from "./styles";

export interface PopoverProps {
  /** The element that opens the popover. It receives the trigger props. */
  trigger: ReactElement;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
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
  align = "start",
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
          sideOffset={8}
          collisionPadding={12}
          className="z-(--z-popover)"
        >
          <BasePopover.Popup
            aria-label={ariaLabel}
            initialFocus={initialFocus}
            className={cn(popupSurface, "max-w-[calc(100vw-1.5rem)] p-4", className)}
          >
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}

export const PopoverClose = BasePopover.Close;
