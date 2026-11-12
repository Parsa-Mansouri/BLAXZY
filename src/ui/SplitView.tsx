"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { PanelLeft } from "lucide-react";
import { IconButton } from "./Button";
import { cn } from "./cn";

/** Matches the `shell` breakpoint in globals.css: below it the sidebar becomes a drawer. */
const WIDE_QUERY = "(min-width: 60rem)";

function subscribeWide(callback: () => void): () => void {
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function useIsWide(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => true,
  );
}

const noop = () => () => {};

function useIsMac(): boolean {
  return useSyncExternalStore(
    noop,
    () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent),
    () => false,
  );
}

interface SplitViewContextValue {
  sidebarId: string;
  /** Whether the sidebar can currently be seen (expanded on wide screens, drawer open on narrow). */
  sidebarVisible: boolean;
  toggle: () => void;
  /** Callback ref for the toggle button, so focus can return to it when the drawer closes. */
  registerToggle: (node: HTMLElement | null) => void;
}

const SplitViewContext = createContext<SplitViewContextValue | null>(null);

export function useSplitView(): SplitViewContextValue | null {
  return useContext(SplitViewContext);
}

export interface SplitViewProps {
  sidebar: ReactNode;
  children: ReactNode;
  /** Server-read starting state, so the first paint is already correct. */
  defaultCollapsed?: boolean;
  /** Cookie that remembers the collapsed state between visits. */
  cookieName?: string;
  /** Changes on navigation; closes the drawer on narrow screens. Pass the pathname. */
  navigationKey?: string;
  /** Accessible name of the sidebar landmark. */
  sidebarLabel?: string;
}

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * The two-pane window: a floating rounded sidebar and the content. On wide screens the sidebar collapses
 * with one slide while the content reflows; below 960px it opens as a drawer over dimmed content.
 * Ctrl/Cmd + \ toggles it.
 */
export function SplitView({
  sidebar,
  children,
  defaultCollapsed = false,
  cookieName = "sidebar",
  navigationKey,
  sidebarLabel = "Sidebar",
}: SplitViewProps) {
  const sidebarId = useId();
  const wide = useIsWide();
  const mac = useIsMac();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [lastKey, setLastKey] = useState(navigationKey);
  const toggleRef = useRef<HTMLElement | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);
  const returnFocus = useRef(false);

  // Close the drawer on navigation and whenever the window grows past the breakpoint.
  if (lastKey !== navigationKey) {
    setLastKey(navigationKey);
    if (drawerOpen) setDrawerOpen(false);
  }
  if (wide && drawerOpen) setDrawerOpen(false);

  const toggle = useCallback(() => {
    if (!window.matchMedia(WIDE_QUERY).matches) {
      setDrawerOpen((open) => !open);
      return;
    }
    setCollapsed((was) => {
      const next = !was;
      document.cookie = `${cookieName}=${next ? "collapsed" : "expanded"}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
      return next;
    });
  }, [cookieName]);

  // Keyboard shortcut.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key === "\\") {
        event.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  // Drawer focus: move in on open, Escape closes and returns focus to the toggle.
  useEffect(() => {
    if (!drawerOpen) return;
    asideRef.current
      ?.querySelector<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]')
      ?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      returnFocus.current = true;
      setDrawerOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  // The content is inert while the drawer is open, so the toggle can take focus only once the
  // drawer has closed and the content is live again.
  useEffect(() => {
    if (drawerOpen || !returnFocus.current) return;
    returnFocus.current = false;
    toggleRef.current?.focus();
  }, [drawerOpen]);

  const registerToggle = useCallback((node: HTMLElement | null) => {
    toggleRef.current = node;
  }, []);

  const sidebarVisible = wide ? !collapsed : drawerOpen;
  const context = useMemo(
    () => ({ sidebarId, sidebarVisible, toggle, registerToggle }),
    [sidebarId, sidebarVisible, toggle, registerToggle],
  );

  return (
    <SplitViewContext.Provider value={context}>
      <div
        data-sidebar={collapsed ? "collapsed" : "expanded"}
        data-drawer={drawerOpen ? "open" : "closed"}
        className="group/shell flex min-h-dvh"
      >
        <div
          aria-hidden="true"
          onClick={() => setDrawerOpen(false)}
          className={cn(
            "pointer-events-none fixed inset-0 z-(--z-drawer) bg-scrim opacity-0 transition-opacity duration-(--dur-base)",
            "group-data-[drawer=open]/shell:pointer-events-auto group-data-[drawer=open]/shell:opacity-100 shell:hidden",
          )}
        />
        <div
          className={cn(
            // Narrow: an overlay drawer.
            "fixed inset-y-0 left-0 z-(--z-drawer) w-(--sidebar-w) -translate-x-full",
            "transition-transform duration-(--dur-slide-motion) ease-spring",
            "group-data-[drawer=open]/shell:translate-x-0",
            // Wide: in the flow, collapsing to zero width while the content reflows.
            "shell:sticky shell:top-0 shell:z-auto shell:h-dvh shell:shrink-0 shell:translate-x-0 shell:overflow-hidden",
            "shell:transition-[width] shell:group-data-[sidebar=collapsed]/shell:w-0",
          )}
        >
          <aside
            ref={asideRef}
            id={sidebarId}
            aria-label={sidebarLabel}
            inert={!sidebarVisible}
            className={cn(
              // A floating rounded panel: 12px gutter on every side but the content side.
              "flex h-full w-(--sidebar-w) flex-col p-3 shell:pr-0",
              "transition-transform duration-(--dur-slide-motion) ease-spring",
              "shell:group-data-[sidebar=collapsed]/shell:-translate-x-full",
            )}
          >
            {/* Rows inside take --nested-radius: 16px panel - 10px padding = 6px corners. */}
            <div className="relative flex min-h-0 flex-1 flex-col gap-6 rounded-panel bg-sidebar px-2.5 pt-5 pb-3 [--nested-radius:6px]">
              {sidebar}
              <IconButton
                label="Hide Sidebar"
                shortcut={mac ? "⌘\\" : "Ctrl+\\"}
                icon={<PanelLeft />}
                aria-controls={sidebarId}
                aria-expanded={sidebarVisible}
                onClick={toggle}
                className="absolute top-3 right-2.5 text-label-2 hover:text-label"
              />
            </div>
          </aside>
        </div>
        <div className="flex min-w-0 flex-1 flex-col" inert={!wide && drawerOpen}>
          {children}
        </div>
      </div>
    </SplitViewContext.Provider>
  );
}

/** The standard sidebar button for the leading edge of the toolbar. */
export function SidebarToggle({ className }: { className?: string }) {
  const view = useSplitView();
  const mac = useIsMac();
  if (!view) return null;
  const { registerToggle, sidebarVisible, sidebarId, toggle } = view;
  return (
    <IconButton
      ref={registerToggle}
      label={sidebarVisible ? "Hide Sidebar" : "Show Sidebar"}
      shortcut={mac ? "⌘\\" : "Ctrl+\\"}
      icon={<PanelLeft />}
      aria-controls={sidebarId}
      aria-expanded={sidebarVisible}
      aria-keyshortcuts={"Control+\\ Meta+\\"}
      onClick={toggle}
      className={cn("text-label-2 hover:text-label", className)}
    />
  );
}
