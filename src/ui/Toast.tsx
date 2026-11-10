"use client";

import { useMemo, type ReactNode } from "react";
import { Toast as BaseToast } from "@base-ui/react/toast";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "./cn";

export type ToastKind = "info" | "success" | "warning" | "danger";

export interface ToastOptions {
  title: string;
  description?: string;
  /** Defaults to "info". */
  kind?: ToastKind;
  /** Milliseconds before auto-dismiss. 0 keeps it until dismissed. Danger toasts always stay. */
  duration?: number;
}

export interface ToastApi {
  show: (options: ToastOptions) => string;
  info: (title: string, description?: string) => string;
  success: (title: string, description?: string) => string;
  warning: (title: string, description?: string) => string;
  danger: (title: string, description?: string) => string;
  dismiss: (id?: string) => void;
}

const icons = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
} as const;

const tones: Record<ToastKind, string> = {
  info: "text-accent-text",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

const DEFAULT_DURATION = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <BaseToast.Provider limit={4}>
      {children}
      <BaseToast.Portal>
        <BaseToast.Viewport className="fixed inset-x-4 bottom-4 z-(--z-toast) mx-auto sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-96">
          <ToastList />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  );
}

function ToastList() {
  const { toasts } = BaseToast.useToastManager();
  return toasts.map((toast) => {
    const kind = (toast.type as ToastKind | undefined) ?? "info";
    const Icon = icons[kind] ?? Info;
    return (
      <BaseToast.Root
        key={toast.id}
        toast={toast}
        className="ui-toast rounded-lg border border-line-strong bg-raised text-fg shadow-lg"
      >
        <BaseToast.Content className="ui-toast-content flex items-start gap-3 p-4">
          <Icon aria-hidden="true" className={cn("mt-0.5 size-5 shrink-0", tones[kind])} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <BaseToast.Title className="text-sm font-medium" />
            <BaseToast.Description className="text-sm text-fg-muted" />
          </div>
          <BaseToast.Close
            aria-label="Dismiss"
            className="-mt-1 -mr-1 flex size-8 shrink-0 items-center justify-center rounded-sm text-fg-subtle focus-ring transition-colors hover:bg-hover hover:text-fg"
          >
            <X aria-hidden="true" className="size-4" />
          </BaseToast.Close>
        </BaseToast.Content>
      </BaseToast.Root>
    );
  });
}

/** Imperative toast API. Must be used under <ToastProvider>. */
export function useToast(): ToastApi {
  const manager = BaseToast.useToastManager();
  return useMemo<ToastApi>(() => {
    const show = (options: ToastOptions): string => {
      const kind = options.kind ?? "info";
      return manager.add({
        title: options.title,
        description: options.description,
        type: kind,
        timeout: kind === "danger" ? 0 : (options.duration ?? DEFAULT_DURATION),
      });
    };
    const make = (kind: ToastKind) => (title: string, description?: string) =>
      show({ title, description, kind });
    return {
      show,
      info: make("info"),
      success: make("success"),
      warning: make("warning"),
      danger: make("danger"),
      dismiss: (id) => manager.close(id),
    };
  }, [manager]);
}
