"use client";

import type { ReactElement, ReactNode } from "react";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { cn } from "./cn";

export const TooltipProvider = BaseTooltip.Provider;

export interface TooltipProps {
  /** Short text shown on hover and keyboard focus. */
  content: ReactNode;
  /** The element that triggers the tooltip. It receives the trigger props. */
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  /** Milliseconds before opening on hover. */
  delay?: number;
  disabled?: boolean;
  className?: string;
}

export function Tooltip({
  content,
  children,
  side = "top",
  align = "center",
  delay = 400,
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
          sideOffset={8}
          className="z-(--z-tooltip)"
        >
          <BaseTooltip.Popup
            className={cn(
              "max-w-64 popup-motion rounded-sm border border-line bg-raised px-2.5 py-1.5 text-xs text-fg shadow-md",
              "data-[instant]:transition-none",
              className,
            )}
          >
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
