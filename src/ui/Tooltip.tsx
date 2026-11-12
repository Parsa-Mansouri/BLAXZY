"use client";

import type { ReactElement, ReactNode } from "react";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { cn } from "./cn";

export const TooltipProvider = BaseTooltip.Provider;

export interface TooltipProps {
  /** Short, plain text shown on hover and keyboard focus. */
  content: ReactNode;
  /** Keyboard shortcut shown after the text, e.g. "⌘\". */
  shortcut?: string;
  /** The element that triggers the tooltip. It receives the trigger props. */
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  /** Milliseconds before opening on hover. */
  delay?: number;
  disabled?: boolean;
  className?: string;
}

/** A small, plain label. Never put anything a user must act on inside a tooltip. */
export function Tooltip({
  content,
  shortcut,
  children,
  side = "bottom",
  align = "center",
  delay = 600,
  disabled,
  className,
}: TooltipProps) {
  return (
    <BaseTooltip.Root disabled={disabled}>
      <BaseTooltip.Trigger delay={delay} render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className="z-(--z-tooltip)"
        >
          <BaseTooltip.Popup
            className={cn(
              "flex max-w-64 items-baseline gap-2 rounded-row bg-elevated-2 px-2.5 py-1.5 text-meta text-label shadow-float",
              "fade-motion data-[instant]:transition-none",
              className,
            )}
          >
            <span>{content}</span>
            {shortcut ? <kbd className="mono-value text-label-2">{shortcut}</kbd> : null}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
