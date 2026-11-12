"use client";

import { useMemo, type MouseEvent, type ReactNode } from "react";
import { Toast as BaseToast } from "@base-ui/react/toast";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "./cn";

export type ToastKind = "info" | "success" | "warning" | "danger";

/** A picture shown large above the words, whole (never cropped) on the dark ground. */
export interface ToastMedia {
  src: string;
  alt: string;
  /** The picture's shape. Defaults to "landscape". */
  aspect?: "landscape" | "portrait" | "square";
}

export interface ToastOptions {
  /** Showing a toast with the id of one already on screen updates that one. */
  id?: string;
  title: string;
  description?: string;
  /** Defaults to "info". */
  kind?: ToastKind;
  /** Milliseconds before auto-dismiss. 0 keeps it until dismissed. Danger toasts always stay. */
  duration?: number;
  /** Stays until opened or dismissed, whatever the kind. */
  persistent?: boolean;
  media?: ToastMedia;
  /** Makes the whole toast a link (the title is its name). Opening it dismisses the toast. */
  href?: string;
  /**
   * Called instead of following `href` on a plain click, for in-app navigation
   * (`() => router.push(href)`). Modified clicks (new tab) still follow the link.
   */
  onOpen?: () => void;
}

interface ToastData {
  media?: ToastMedia;
  href?: string;
  onOpen?: () => void;
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
  info: "text-label-2",
  success: "text-green",
  warning: "text-orange",
  danger: "text-red",
};

const DEFAULT_DURATION = 4000;

/* A portrait picture is boxed less tall than itself and never over two fifths of the window height. */
const mediaShapes = {
  landscape: "aspect-video",
  portrait: "aspect-4/5 max-h-[40dvh]",
  square: "aspect-square max-h-[40dvh]",
} as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <BaseToast.Provider limit={3}>
      {children}
      <BaseToast.Portal>
        <BaseToast.Viewport className="fixed inset-x-4 bottom-4 z-(--z-toast) mx-auto max-w-sm shell:inset-x-auto shell:right-6 shell:bottom-6 shell:w-sm">
          <ToastList />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  );
}

function ToastList() {
  const manager = BaseToast.useToastManager<ToastData>();
  return manager.toasts.map((toast) => {
    const kind = (toast.type as ToastKind | undefined) ?? "info";
    const Icon = icons[kind] ?? Info;
    const { media, href, onOpen } = toast.data ?? {};
    const open = (event: MouseEvent<HTMLAnchorElement>) => {
      const plain =
        event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
      if (plain && onOpen) {
        event.preventDefault();
        onOpen();
      }
      manager.close(toast.id);
    };
    return (
      <BaseToast.Root
        key={toast.id}
        toast={toast}
        className="ui-toast rounded-popover bg-elevated-2 text-label shadow-float"
      >
        <BaseToast.Content className="ui-toast-content relative rounded-[inherit]">
          {media ? (
            <div
              className={cn("relative w-full bg-ground", mediaShapes[media.aspect ?? "landscape"])}
            >
              {/* The source may be a redirect to a short-lived address: next/image cannot cache it. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={media.src}
                alt={media.alt}
                decoding="async"
                draggable={false}
                className="absolute inset-0 size-full object-contain"
              />
            </div>
          ) : null}
          <div className="flex items-start gap-2.5 p-3 pr-2">
            <Icon aria-hidden="true" className={cn("mt-px size-(--icon) shrink-0", tones[kind])} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <BaseToast.Title className="text-headline text-balance">
                {href ? (
                  // The link's ::after covers the toast, so all of it opens the link; the close
                  // button sits above it.
                  <a
                    href={href}
                    onClick={open}
                    className="outline-none after:absolute after:inset-0 after:rounded-popover focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-(--focus)"
                  >
                    {toast.title}
                  </a>
                ) : (
                  toast.title
                )}
              </BaseToast.Title>
              <BaseToast.Description className="text-callout text-pretty text-label-2" />
            </div>
            <BaseToast.Close
              aria-label="Dismiss"
              className="relative z-1 -my-1 flex size-(--control-h) shrink-0 items-center justify-center rounded-full text-label-2 focus-ring transition-colors duration-(--dur-press) hover:bg-fill-4 hover:text-label"
            >
              <X aria-hidden="true" className="size-(--icon-lg)" />
            </BaseToast.Close>
          </div>
        </BaseToast.Content>
      </BaseToast.Root>
    );
  });
}

/** Imperative toast API. Must be used under <ToastProvider>. */
export function useToast(): ToastApi {
  const manager = BaseToast.useToastManager<ToastData>();
  return useMemo<ToastApi>(() => {
    const show = (options: ToastOptions): string => {
      const kind = options.kind ?? "info";
      const stays = kind === "danger" || options.persistent;
      return manager.add({
        ...(options.id ? { id: options.id } : {}),
        title: options.title,
        description: options.description,
        type: kind,
        timeout: stays ? 0 : (options.duration ?? DEFAULT_DURATION),
        data: { media: options.media, href: options.href, onOpen: options.onOpen },
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
