"use client";

import type { ReactNode, RefObject } from "react";
import { Popover } from "@base-ui/react/popover";
import { X } from "lucide-react";
import { Button, IconButton } from "./Button";
import { cn } from "./cn";
import { PopoverArrow } from "./Popover";
import { popupSurface } from "./styles";

export interface TipProps {
  open: boolean;
  /** Called by the close button and Escape. The caller persists it (see useDismissed). */
  onDismiss: () => void;
  /** The element the tip points at. */
  anchor: RefObject<Element | null> | Element | null;
  title: string;
  /** One sentence. */
  children: ReactNode;
  /** Optional single action, e.g. { label: "Create Project", onClick }. */
  action?: { label: string; onClick: () => void };
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  className?: string;
}

/**
 * A first-run tip in the TipKit style: an arrowed popover with a title, one sentence, a close
 * button and at most one action. Show one at a time. Fully controlled.
 */
export function Tip({
  open,
  onDismiss,
  anchor,
  title,
  children,
  action,
  side = "bottom",
  align = "center",
  className,
}: TipProps) {
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next, details) => {
        // Only Escape dismisses: a click elsewhere must not lose the tip for good.
        if (!next && details.reason === "escape-key") onDismiss();
      }}
    >
      <Popover.Portal>
        <Popover.Positioner
          anchor={anchor}
          side={side}
          align={align}
          sideOffset={10}
          collisionPadding={8}
          className="z-(--z-popover)"
        >
          <Popover.Popup
            initialFocus={false}
            className={cn(popupSurface, "w-80 max-w-[calc(100vw-1rem)] p-3 pr-2", className)}
          >
            <PopoverArrow />
            <div className="flex items-start gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
                <Popover.Title className="text-headline">{title}</Popover.Title>
                <Popover.Description render={<div />} className="text-callout text-label-2">
                  {children}
                </Popover.Description>
                {action ? (
                  <div className="pt-1.5">
                    <Button variant="standard" onClick={action.onClick}>
                      {action.label}
                    </Button>
                  </div>
                ) : null}
              </div>
              <IconButton
                label="Close Tip"
                tooltip={false}
                icon={<X />}
                onClick={onDismiss}
                className="-mt-1 text-label-2"
              />
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
