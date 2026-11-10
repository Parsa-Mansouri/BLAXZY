"use client";

import { useRef, type ReactNode, type RefObject } from "react";
import { Popover } from "@base-ui/react/popover";
import { Button } from "./Button";
import { cn } from "./cn";
import { popupSurface } from "./styles";

export interface CoachMarkProps {
  open: boolean;
  /** Called on Skip, on Done (last step), and on Escape. The caller decides persistence. */
  onDismiss: () => void;
  /** Called by Next. When omitted the primary button reads "Got it" and dismisses. */
  onNext?: () => void;
  /** The element the callout points at. */
  anchor: RefObject<Element | null> | Element | null;
  title: string;
  children: ReactNode;
  /** 1-based position, shown as "2 of 4". */
  step?: number;
  total?: number;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  nextLabel?: string;
  doneLabel?: string;
  skipLabel?: string;
  className?: string;
}

/** A first-time callout anchored to an element. Fully controlled. */
export function CoachMark({
  open,
  onDismiss,
  onNext,
  anchor,
  title,
  children,
  step,
  total,
  side = "bottom",
  align = "center",
  nextLabel = "Next",
  doneLabel = "Got it",
  skipLabel = "Skip",
  className,
}: CoachMarkProps) {
  const primaryRef = useRef<HTMLElement | null>(null);
  const hasSteps = step !== undefined && total !== undefined && total > 1;
  const isLast = !hasSteps || step >= total;
  const showSkip = hasSteps && !isLast;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next, details) => {
        // Only Escape dismisses: clicking elsewhere must not lose the tour.
        if (!next && details.reason === "escape-key") onDismiss();
      }}
    >
      <Popover.Portal>
        <Popover.Positioner
          anchor={anchor}
          side={side}
          align={align}
          sideOffset={12}
          collisionPadding={12}
          className="z-(--z-popover)"
        >
          <Popover.Popup
            initialFocus={primaryRef as RefObject<HTMLElement | null>}
            className={cn(
              popupSurface,
              "w-80 max-w-[calc(100vw-1.5rem)] border-accent/40 p-5",
              className,
            )}
          >
            <Popover.Arrow className="data-[side=bottom]:-top-2 data-[side=top]:-bottom-2 data-[side=top]:rotate-180">
              <svg width="20" height="10" viewBox="0 0 20 10" aria-hidden="true">
                <path d="M0 10 10 0l10 10" fill="var(--raised)" stroke="var(--line-strong)" />
              </svg>
            </Popover.Arrow>
            <div className="flex flex-col gap-1.5">
              <Popover.Title className="text-base font-semibold tracking-tight">
                {title}
              </Popover.Title>
              <Popover.Description render={<div />} className="text-sm text-fg-muted">
                {children}
              </Popover.Description>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="text-xs text-fg-subtle tabular-nums">
                {hasSteps ? `${step} of ${total}` : ""}
              </span>
              <div className="flex items-center gap-1">
                {showSkip ? (
                  <Button size="sm" variant="ghost" onClick={onDismiss}>
                    {skipLabel}
                  </Button>
                ) : null}
                <Button
                  ref={primaryRef}
                  size="sm"
                  variant="primary"
                  onClick={isLast || !onNext ? onDismiss : onNext}
                >
                  {isLast ? doneLabel : nextLabel}
                </Button>
              </div>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
