"use client";

import type { ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
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

/** The round "?" help button. Opens a popover that explains the thing next to it. */
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
          "relative inline-flex size-(--icon) shrink-0 items-center justify-center rounded-full bg-fill-2 text-subheadline font-semibold text-label-2 focus-ring",
          "transition-colors duration-(--dur-fast) hover:bg-fill hover:text-label data-[popup-open]:bg-fill data-[popup-open]:text-label",
          "pointer-coarse:after:absolute pointer-coarse:after:-inset-3 pointer-coarse:after:content-['']",
          className,
        )}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" className="size-[62.5%]">
          <path
            d="M5.6 5.7a2.4 2.4 0 0 1 4.7.6c0 1.6-2.3 2-2.3 3.4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <circle cx="8" cy="12.6" r="1.1" fill="currentColor" />
        </svg>
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
