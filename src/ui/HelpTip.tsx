"use client";

import { useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { CircleHelp } from "lucide-react";
import { cn } from "./cn";
import { popupSurface } from "./styles";

export interface HelpTipProps {
  /** The explanation. Keep it to one or two plain sentences. */
  children: ReactNode;
  title?: string;
  /** Optional concrete example, shown in a quiet block. */
  example?: ReactNode;
  /** Accessible name of the "?" button. */
  label?: string;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}

/** A small "?" that explains itself on hover, keyboard focus, or tap. */
export function HelpTip({
  children,
  title,
  example,
  label = "What is this?",
  side = "top",
  className,
}: HelpTipProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        openOnHover
        delay={150}
        closeDelay={120}
        aria-label={label}
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        className={cn(
          "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-fg-subtle focus-ring",
          "transition-colors duration-(--duration-fast) hover:bg-hover hover:text-fg data-[popup-open]:text-accent-text",
          className,
        )}
      >
        <CircleHelp aria-hidden="true" className="size-4" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side={side}
          sideOffset={8}
          collisionPadding={12}
          className="z-(--z-popover)"
        >
          <Popover.Popup
            initialFocus={false}
            className={cn(
              popupSurface,
              "flex w-72 max-w-[calc(100vw-1.5rem)] flex-col gap-2 p-4 text-sm",
            )}
          >
            {title ? <Popover.Title className="font-medium text-fg">{title}</Popover.Title> : null}
            <Popover.Description render={<div />} className="text-fg-muted">
              {children}
            </Popover.Description>
            {example ? (
              <div className="rounded-sm bg-sunken px-3 py-2 text-fg-muted">
                <span className="mr-1.5 font-medium text-fg">Example</span>
                {example}
              </div>
            ) : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
