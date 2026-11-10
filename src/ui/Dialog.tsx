"use client";

import type { ReactNode } from "react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { cn } from "./cn";
import { IconButton } from "./Button";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Action buttons, right-aligned (stacked on phones). */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const widths = { sm: "sm:max-w-sm", md: "sm:max-w-lg", lg: "sm:max-w-2xl" } as const;

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  className,
}: DialogProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop
          className={cn(
            "fixed inset-0 z-(--z-overlay) bg-scrim backdrop-blur-[2px]",
            "transition-opacity duration-(--duration-base) ease-(--ease-out)",
            "data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
          )}
        />
        <BaseDialog.Viewport className="fixed inset-0 z-(--z-modal) flex items-end justify-center sm:items-center sm:p-6">
          <BaseDialog.Popup
            className={cn(
              "relative flex max-h-[calc(100dvh-2rem)] w-full flex-col gap-5 overflow-y-auto border border-line bg-raised p-6 text-fg shadow-lg outline-none",
              "rounded-t-xl sm:rounded-xl",
              "transition-[opacity,translate,scale] duration-(--duration-slow) ease-(--ease-out)",
              "data-[ending-style]:translate-y-6 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-6 data-[starting-style]:opacity-0",
              "sm:data-[ending-style]:translate-y-0 sm:data-[ending-style]:scale-[0.97] sm:data-[starting-style]:translate-y-0 sm:data-[starting-style]:scale-[0.97]",
              widths[size],
              className,
            )}
          >
            <div className="flex flex-col gap-1.5 pr-10">
              <BaseDialog.Title className="text-xl font-semibold tracking-tight">
                {title}
              </BaseDialog.Title>
              {description ? (
                <BaseDialog.Description className="text-sm text-fg-muted">
                  {description}
                </BaseDialog.Description>
              ) : null}
            </div>
            <BaseDialog.Close
              render={
                <IconButton
                  label="Close"
                  tooltip={false}
                  size="sm"
                  icon={<X />}
                  className="absolute top-4 right-4"
                />
              }
            />
            {children ? <div className="text-sm">{children}</div> : null}
            {footer ? (
              <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
                {footer}
              </div>
            ) : null}
          </BaseDialog.Popup>
        </BaseDialog.Viewport>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

export const DialogClose = BaseDialog.Close;
export const DialogTrigger = BaseDialog.Trigger;
