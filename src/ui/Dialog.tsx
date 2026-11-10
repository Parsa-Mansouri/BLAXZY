"use client";

import type { ReactNode } from "react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { cn } from "./cn";

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** One or two sentences under the title. */
  description?: ReactNode;
  children?: ReactNode;
  /**
   * Buttons, trailing-aligned. Put the default action last; label the dismiss button "Cancel".
   */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const widths = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-xl" } as const;

/** A sheet: a centred, focused task over a dimmed window. Escape and Cancel dismiss it. */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  className,
}: SheetProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-(--z-overlay) bg-scrim fade-motion" />
        <BaseDialog.Viewport className="fixed inset-0 z-(--z-modal) flex items-center justify-center p-4">
          <BaseDialog.Popup
            className={cn(
              "flex max-h-[calc(100dvh-2rem)] w-full popup-motion flex-col gap-4 overflow-y-auto rounded-sheet bg-elevated-2 p-5 text-label shadow-float outline-none",
              widths[size],
              className,
            )}
          >
            <div className="flex flex-col gap-1">
              <BaseDialog.Title className="text-title-3">{title}</BaseDialog.Title>
              {description ? (
                <BaseDialog.Description className="text-body text-label-2">
                  {description}
                </BaseDialog.Description>
              ) : null}
            </div>
            {children ? <div className="text-body">{children}</div> : null}
            {footer ? (
              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">{footer}</div>
            ) : null}
          </BaseDialog.Popup>
        </BaseDialog.Viewport>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

/** Same component under its previous name. */
export const Dialog = Sheet;
export type DialogProps = SheetProps;

export const DialogClose = BaseDialog.Close;
export const DialogTrigger = BaseDialog.Trigger;
