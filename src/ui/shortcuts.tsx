"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import type { ActionItem } from "./action-items";
import { Button } from "./Button";
import { Sheet } from "./Dialog";
import { Kbd } from "./Mono";
import {
  blockedByTyping,
  formatShortcut,
  isInteractiveTarget,
  isMacPlatform,
  isReservedCombo,
  matchesCombo,
  parseCombo,
  type Combo,
} from "./shortcut-keys";

const noop = () => () => {};

/** True on Apple platforms (⌘ instead of Ctrl). False while rendering on the server. */
export function useIsMac(): boolean {
  return useSyncExternalStore(
    noop,
    () => isMacPlatform(navigator.platform || navigator.userAgent),
    () => false,
  );
}

function currentIsMac(): boolean {
  return typeof navigator !== "undefined" && isMacPlatform(navigator.platform || navigator.userAgent);
}

interface Registration {
  id: number;
  combos: { raw: string; parsed: Combo }[];
  handler: RefObject<(event: KeyboardEvent) => void>;
  label?: string;
  group?: string;
  inEditable: boolean;
}

/** An object with an action menu, while it is hovered or focused: its keys run its actions. */
export interface ActiveItem {
  id: string;
  actions: () => ActionItem[];
  run: (action: ActionItem) => void;
}

type ActiveHow = "hover" | "focus";

interface ShortcutsContextValue {
  register: (registration: Omit<Registration, "id">) => () => void;
  activate: (item: ActiveItem, how: ActiveHow) => void;
  deactivate: (id: string, how: ActiveHow) => void;
  openHelp: () => void;
  navigate: (href: string) => void;
  linkElement: (href: string) => ReactElement;
}

const ShortcutsContext = createContext<ShortcutsContextValue | null>(null);

/** Opening an address in this tab: the app's router when a provider gives one. */
export function useNavigate(): (href: string) => void {
  return useContext(ShortcutsContext)?.navigate ?? defaultNavigate;
}

/** The element a menu item renders for an in-app link (the app passes Next's Link). */
export function useLinkElement(): (href: string) => ReactElement {
  return useContext(ShortcutsContext)?.linkElement ?? defaultLinkElement;
}

/** Hover and focus registration for `ActionMenuTarget`. */
export function useItemShortcuts(): Pick<ShortcutsContextValue, "activate" | "deactivate"> | null {
  return useContext(ShortcutsContext);
}

/** Opens the shortcuts sheet (for a help menu entry). No-op outside a provider. */
export function useShortcutsHelp(): () => void {
  return useContext(ShortcutsContext)?.openHelp ?? noopHelp;
}

function noopHelp() {}
function defaultNavigate(href: string) {
  window.location.assign(href);
}
function defaultLinkElement(href: string): ReactElement {
  return <a href={href} />;
}

/** The keys every object with an action menu answers to, for the shortcuts sheet. */
const ITEM_KEYS: { combo: string; label: string }[] = [
  { combo: "enter", label: "Open" },
  { combo: "r", label: "Rename" },
  { combo: "d", label: "Download" },
  { combo: "delete", label: "Remove or Archive" },
];

/** Runs the first registration (latest first) that matches; true when one ran. */
function dispatch(event: KeyboardEvent, registrations: readonly Registration[]): boolean {
  const isMac = currentIsMac();
  for (let i = registrations.length - 1; i >= 0; i--) {
    const registration = registrations[i];
    const hit = registration.combos.some(
      ({ parsed }) =>
        matchesCombo(parsed, event, isMac) &&
        !blockedByTyping(parsed, event.target, { inEditable: registration.inEditable }),
    );
    if (!hit) continue;
    event.preventDefault();
    registration.handler.current(event);
    return true;
  }
  return false;
}

/** Runs the hovered or focused object's action for this key; true when one ran. */
function dispatchItem(event: KeyboardEvent, item: ActiveItem | null): boolean {
  if (!item) return false;
  const isMac = currentIsMac();
  for (const action of item.actions()) {
    if (!action.shortcut || action.disabled) continue;
    const combo = parseCombo(action.shortcut);
    if (!matchesCombo(combo, event, isMac) || blockedByTyping(combo, event.target)) continue;
    // Enter on a link or a button already does its own thing.
    if (combo.key === "enter" && isInteractiveTarget(event.target)) continue;
    event.preventDefault();
    item.run(action);
    return true;
  }
  return false;
}

function ignorable(event: KeyboardEvent): boolean {
  return event.defaultPrevented || event.repeat || event.isComposing;
}

export interface ShortcutsProviderProps {
  children: ReactNode;
  /** In-app navigation for link actions run by a key (the app passes `router.push`). */
  navigate?: (href: string) => void;
  /** The element a menu item renders for an in-app link (the app passes `<Link href />`). */
  linkElement?: (href: string) => ReactElement;
}

/**
 * Owns the page's keyboard shortcuts: one key listener for every `useShortcut`, the keys of the
 * hovered or focused object with an action menu, and the "?" sheet that lists them all.
 */
export function ShortcutsProvider({ children, navigate, linkElement }: ShortcutsProviderProps) {
  const registrations = useRef<Registration[]>([]);
  const nextId = useRef(0);
  const hovered = useRef<ActiveItem | null>(null);
  const focused = useRef<ActiveItem | null>(null);
  const lastHow = useRef<ActiveHow>("hover");
  const [help, setHelp] = useState<Registration[] | null>(null);

  const register = useCallback((registration: Omit<Registration, "id">) => {
    const entry: Registration = { ...registration, id: nextId.current++ };
    registrations.current = [...registrations.current, entry];
    return () => {
      registrations.current = registrations.current.filter((r) => r !== entry);
    };
  }, []);

  const activate = useCallback((item: ActiveItem, how: ActiveHow) => {
    (how === "hover" ? hovered : focused).current = item;
    lastHow.current = how;
  }, []);

  const deactivate = useCallback((id: string, how: ActiveHow) => {
    const slot = how === "hover" ? hovered : focused;
    if (slot.current?.id === id) slot.current = null;
  }, []);

  const openHelp = useCallback(() => setHelp([...registrations.current]), []);

  // "?" opens the sheet.
  const helpHandler = useRef<(event: KeyboardEvent) => void>(openHelp);
  useEffect(
    () =>
      register({
        combos: [{ raw: "?", parsed: parseCombo("?") }],
        handler: helpHandler,
        label: "Show Keyboard Shortcuts",
        group: "General",
        inEditable: false,
      }),
    [register],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (ignorable(event)) return;
      const item =
        lastHow.current === "hover"
          ? (hovered.current ?? focused.current)
          : (focused.current ?? hovered.current);
      if (dispatchItem(event, item)) return;
      dispatch(event, registrations.current);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const value = useMemo<ShortcutsContextValue>(
    () => ({
      register,
      activate,
      deactivate,
      openHelp,
      navigate: navigate ?? defaultNavigate,
      linkElement: linkElement ?? defaultLinkElement,
    }),
    [register, activate, deactivate, openHelp, navigate, linkElement],
  );

  return (
    <ShortcutsContext.Provider value={value}>
      {children}
      <ShortcutsSheet registrations={help} onClose={() => setHelp(null)} />
    </ShortcutsContext.Provider>
  );
}

export interface ShortcutOptions {
  /** Shown in the shortcuts sheet; without one the shortcut works but is not listed. */
  label?: string;
  /** Heading it is listed under in the sheet. Default "General". */
  group?: string;
  /** Default true. */
  enabled?: boolean;
  /** Let a ⌘/Ctrl combo fire inside rich-text editors too. */
  inEditable?: boolean;
}

/**
 * Binds a key combo ("mod+b", "?", "n", "alt+1"; an array for aliases) for as long as the
 * component is mounted. Single keys, Shift and Alt combos never fire while the person types in
 * a field or works in a dialog or menu. Browser-reserved combos (⌘/Ctrl + N, T, W, L, R, Q,
 * 1–9) are refused. Works without a `ShortcutsProvider` too (it then listens by itself).
 */
export function useShortcut(
  combo: string | readonly string[],
  handler: (event: KeyboardEvent) => void,
  { label, group, enabled = true, inEditable = false }: ShortcutOptions = {},
): void {
  const context = useContext(ShortcutsContext);
  const register = context?.register;
  const handlerRef = useRef(handler);
  useLayoutEffect(() => {
    handlerRef.current = handler;
  });
  const key = typeof combo === "string" ? combo : combo.join("\n");

  useEffect(() => {
    if (!enabled) return;
    const combos = key.split("\n").flatMap((raw) => {
      const parsed = parseCombo(raw);
      if (isReservedCombo(parsed)) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(`useShortcut: "${raw}" belongs to the browser and is not bound.`);
        }
        return [];
      }
      return [{ raw, parsed }];
    });
    if (combos.length === 0) return;
    const registration = { combos, handler: handlerRef, label, group, inEditable };
    if (register) return register(registration);
    function onKeyDown(event: KeyboardEvent) {
      if (!ignorable(event)) dispatch(event, [{ ...registration, id: 0 }]);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [register, key, enabled, label, group, inEditable]);
}

interface SheetRow {
  combos: string[];
  label: string;
}

/** Registrations with a label, grouped, each label once (its combos merged). */
function groupRows(registrations: readonly Registration[]): { group: string; rows: SheetRow[] }[] {
  const groups = new Map<string, Map<string, SheetRow>>();
  for (const registration of registrations) {
    if (!registration.label) continue;
    const group = registration.group ?? "General";
    const rows = groups.get(group) ?? new Map<string, SheetRow>();
    groups.set(group, rows);
    const row = rows.get(registration.label) ?? { combos: [], label: registration.label };
    rows.set(registration.label, row);
    for (const { raw } of registration.combos) if (!row.combos.includes(raw)) row.combos.push(raw);
  }
  const ordered = [...groups.entries()].map(([group, rows]) => ({ group, rows: [...rows.values()] }));
  // General first, then the page's own groups in the order they were registered.
  return ordered.sort((a, b) => Number(b.group === "General") - Number(a.group === "General"));
}

function ShortcutRow({ label, combos }: SheetRow) {
  const isMac = useIsMac();
  return (
    <div className="flex min-h-(--menu-row-h) items-center justify-between gap-6">
      <dt className="min-w-0 text-body text-label">{label}</dt>
      <dd className="flex shrink-0 items-center gap-3">
        {combos.map((combo) => (
          <Kbd key={combo} className="text-secondary">
            {formatShortcut(combo, isMac)}
          </Kbd>
        ))}
      </dd>
    </div>
  );
}

function ShortcutGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="caps-label text-label-2">{title}</h3>
      <dl className="flex flex-col">{children}</dl>
    </section>
  );
}

/** The "?" sheet: every shortcut that works on this page, by group, then the item keys. */
function ShortcutsSheet({
  registrations,
  onClose,
}: {
  registrations: Registration[] | null;
  onClose: () => void;
}) {
  // Keep the last list while the sheet animates out.
  const [shown, setShown] = useState<Registration[]>([]);
  if (registrations && registrations !== shown) setShown(registrations);
  const groups = groupRows(shown);
  return (
    <Sheet
      open={registrations !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Keyboard Shortcuts"
      description="Right-click or press and hold anything with more actions to see them."
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="flex flex-col gap-8">
        {groups.map(({ group, rows }) => (
          <ShortcutGroup key={group} title={group}>
            {rows.map((row) => (
              <ShortcutRow key={row.label} {...row} />
            ))}
          </ShortcutGroup>
        ))}
        <ShortcutGroup title="Hovered or Selected Item">
          {ITEM_KEYS.map(({ combo, label }) => (
            <ShortcutRow key={combo} label={label} combos={[combo]} />
          ))}
        </ShortcutGroup>
      </div>
    </Sheet>
  );
}
