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

const widths = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl" } as const;

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
              "flex max-h-[calc(100dvh-2rem)] w-full popup-motion flex-col gap-6 overflow-y-auto rounded-block bg-elevated-2 p-6 text-label shadow-float outline-none sm:p-8",
              widths[size],
              className,
            )}
          >
            <div className="flex flex-col gap-2">
              <BaseDialog.Title className="text-heading-sm text-balance">{title}</BaseDialog.Title>
              {description ? (
                <BaseDialog.Description className="text-body text-pretty text-label-2">
                  {description}
                </BaseDialog.Description>
              ) : null}
            </div>
            {children ? <div className="text-body">{children}</div> : null}
            {footer ? (
              <div className="flex flex-wrap items-center justify-end gap-3">{footer}</div>
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
