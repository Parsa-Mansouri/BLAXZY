"use client";

import type { ReactNode } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Button } from "./Button";

export interface AlertProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A question that names the action, e.g. `Archive "Night Train"?`. */
  title: string;
  /** What happens, in one sentence. */
  message?: ReactNode;
  /** The action's verb, e.g. "Archive". */
  confirmLabel: string;
  onConfirm: () => void;
  cancelLabel?: string;
  /** Red confirm button. Use for anything that removes or discards. */
  destructive?: boolean;
  loading?: boolean;
  /** Shown in red when the action failed; say what to do next. */
  error?: ReactNode;
}

/** A confirmation alert. Use only to confirm a destructive action. */
export function Alert({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel,
  onConfirm,
  cancelLabel = "Cancel",
  destructive = true,
  loading = false,
  error,
}: AlertProps) {
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (loading && !next) return;
        onOpenChange(next);
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-(--z-overlay) bg-scrim fade-motion" />
        <AlertDialog.Viewport className="fixed inset-0 z-(--z-modal) flex items-center justify-center p-4">
          <AlertDialog.Popup className="flex w-full max-w-sm popup-motion flex-col gap-6 rounded-block bg-elevated-2 p-6 text-label shadow-float outline-none">
            <div className="flex flex-col gap-2">
              <AlertDialog.Title className="text-section text-balance">{title}</AlertDialog.Title>
              {message ? (
                <AlertDialog.Description className="text-body text-pretty text-label-2">
                  {message}
                </AlertDialog.Description>
              ) : null}
              {error ? (
                <p role="alert" className="text-secondary text-red">
                  {error}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <AlertDialog.Close render={<Button variant="plain" disabled={loading} />}>
                {cancelLabel}
              </AlertDialog.Close>
              <Button
                variant={destructive ? "destructive-confirm" : "primary"}
                onClick={onConfirm}
                loading={loading}
              >
                {confirmLabel}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
