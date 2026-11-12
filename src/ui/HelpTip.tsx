"use client";

import type { ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { CircleHelp } from "lucide-react";
import { cn } from "./cn";
import { PopoverArrow } from "./Popover";
import { popupSurface } from "./styles";

export interface HelpTipProps {
  /** The explanation. One or two plain sentences. */
  children: ReactNode;
  title?: string;
  /** Optional concrete example, shown under the explanation. */
  example?: ReactNode;
  /** Accessible name of the button. */
  label?: string;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}

/** The "?" help button (lucide CircleHelp, 16px beside its label). Opens a popover that explains the thing next to it. */
export function HelpTip({
  children,
  title,
  example,
  label = "Help",
  side = "top",
  className,
}: HelpTipProps) {
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={label}
        className={cn(
          "relative inline-flex size-(--icon) shrink-0 items-center justify-center rounded-full text-label-2 focus-ring",
          "transition-colors duration-(--dur-press) hover:text-label data-[popup-open]:text-label",
          "after:absolute after:-inset-2 after:content-[''] pointer-coarse:after:-inset-3",
          className,
        )}
      >
        <CircleHelp aria-hidden="true" className="size-(--icon)" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side={side}
          sideOffset={10}
          collisionPadding={8}
          className="z-(--z-popover)"
        >
          <Popover.Popup
            initialFocus={false}
            className={cn(popupSurface, "flex w-72 max-w-[calc(100vw-1rem)] flex-col gap-1 p-3")}
          >
            <PopoverArrow />
            {title ? <Popover.Title className="text-headline">{title}</Popover.Title> : null}
            <Popover.Description render={<div />} className="text-callout text-label-2">
              {children}
            </Popover.Description>
            {example ? (
              <p className="pt-1 text-callout text-label-2">
                <span className="text-label">Example: </span>
                {example}
              </p>
            ) : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
