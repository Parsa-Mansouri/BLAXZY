"use client";

import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useMemo,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { ContextMenu } from "@base-ui/react/context-menu";
import { Ellipsis } from "lucide-react";
import { absoluteUrl, normalizeActions, type ActionGroups, type ActionItem } from "./action-items";
import { IconButton, type ButtonSize, type ButtonVariant } from "./Button";
import { cn } from "./cn";
import { isTypingTarget } from "./dom";
import { LongPressGuard } from "./long-press";
import { Menu, MenuItem, MenuSeparator } from "./Menu";
import { menuPad, popupSurface } from "./styles";
import { useToast } from "./Toast";

type LinkElement = (href: string) => ReactElement;

function plainLink(href: string): ReactElement {
  return <a href={href} />;
}

const LinkElementContext = createContext<LinkElement>(plainLink);

export interface ActionMenuProviderProps {
  /** The element an in-app link item renders: the app passes `(href) => <Link href={href} />`. */
  linkElement: LinkElement;
  children: ReactNode;
}

/** Lets action menus render in-app links with the app's router link. Without it: plain `<a>`. */
export function ActionMenuProvider({ linkElement, children }: ActionMenuProviderProps) {
  return <LinkElementContext.Provider value={linkElement}>{children}</LinkElementContext.Provider>;
}

/** Copies an address, made absolute, to the clipboard and says so in a toast. */
function useCopyLink(): (href: string) => void {
  const toast = useToast();
  return useCallback(
    (href: string) => {
      const failed = () =>
        toast.danger("The link could not be copied", "Your browser did not allow it.");
      if (!navigator.clipboard) {
        failed();
        return;
      }
      const url = absoluteUrl(href, window.location.origin);
      navigator.clipboard.writeText(url).then(() => toast.success("Link copied"), failed);
    },
    [toast],
  );
}

/** The rows of an action menu, groups split by thin lines. Works in any Base UI menu popup. */
export function ActionMenuItems({ groups }: { groups: ActionItem[][] }) {
  const copyLink = useCopyLink();
  const linkElement = useContext(LinkElementContext);
  return groups.map((group, index) => (
    <Fragment key={group[0]?.id ?? index}>
      {index > 0 ? <MenuSeparator /> : null}
      {group.map((action) => {
        const label = (
          <span className="flex min-w-0 items-center gap-2.5">
            {action.icon ? (
              <span aria-hidden="true" className="flex shrink-0 [&_svg]:size-(--icon)">
                {action.icon}
              </span>
            ) : null}
            <span className="min-w-0 truncate">{action.label}</span>
          </span>
        );
        if (action.href !== undefined && !action.disabled) {
          return (
            <MenuItem
              key={action.id}
              destructive={action.destructive}
              render={
                action.newTab ? (
                  <a href={action.href} target="_blank" rel="noopener noreferrer" />
                ) : (
                  linkElement(action.href)
                )
              }
            >
              {label}
            </MenuItem>
          );
        }
        return (
          <MenuItem
            key={action.id}
            destructive={action.destructive}
            disabled={action.disabled}
            onClick={() => {
              if (action.onSelect) action.onSelect();
              else if (action.copy !== undefined) copyLink(action.copy);
            }}
          >
            {label}
          </MenuItem>
        );
      })}
    </Fragment>
  ));
}

export interface ActionMenuTargetProps {
  /** The object's actions, in groups. With none, right-click shows the browser's own menu. */
  actions: ActionGroups;
  /**
   * The element that becomes the target (it must pass props and a ref to its DOM element, like
   * the kit's rows and buttons). Defaults to a `<div>` around `children`.
   */
  render?: ReactElement;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Accessible name of the context menu, e.g. "Actions for Jonas". */
  label?: string;
}

/** Base UI's handler-skipping hook on its merged events (absent on plain React events). */
type SkippableEvent = { preventBaseUIHandler?: () => void };

/**
 * Makes an object answer to right-click (and the keyboard's menu key or Shift+F10, which the
 * browser sends as a context-menu event) and to a 500ms long press with its action menu. A
 * click that follows a long press is swallowed, so a wrapped link does not open as well.
 * Inside a field, a textarea, a select or an editable element the browser keeps its own menu
 * and text selection: the action menu stays shut there.
 */
export function ActionMenuTarget({
  actions,
  render,
  children,
  className,
  style,
  label,
}: ActionMenuTargetProps) {
  const groups = useMemo(() => normalizeActions(actions), [actions]);
  const [guard] = useState(() => new LongPressGuard());
  const empty = groups.length === 0;
  const now = () => performance.now();

  return (
    <ContextMenu.Root
      disabled={empty}
      onOpenChange={(open) => {
        if (open) guard.menuOpened();
      }}
    >
      <ContextMenu.Trigger
        render={render}
        className={className}
        style={style}
        data-action-target=""
        onContextMenu={(event) => {
          if (!isTypingTarget(event.target)) return;
          // Skip Base UI's handler, and keep the event from its document listener (which would
          // block the browser's menu) and from any outer target.
          (event as SkippableEvent).preventBaseUIHandler?.();
          event.stopPropagation();
        }}
        onTouchStart={(event) => {
          if (isTypingTarget(event.target)) {
            (event as SkippableEvent).preventBaseUIHandler?.();
            guard.touchCancel();
            return;
          }
          const touch = event.touches[0];
          if (event.touches.length === 1 && touch) {
            guard.touchStart(now(), touch.clientX, touch.clientY);
          } else {
            guard.touchCancel();
          }
        }}
        onTouchMove={(event) => {
          const touch = event.touches[0];
          if (touch) guard.touchMove(touch.clientX, touch.clientY);
        }}
        onTouchEnd={() => guard.touchEnd(now())}
        onTouchCancel={() => guard.touchCancel()}
        onClickCapture={(event) => {
          if (guard.shouldSuppressClick(now())) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        {children}
      </ContextMenu.Trigger>
      {empty ? null : (
        <ContextMenu.Portal>
          <ContextMenu.Positioner collisionPadding={8} className="z-(--z-popover)">
            <ContextMenu.Popup
              aria-label={label}
              className={cn(
                popupSurface,
                menuPad,
                "flex max-w-[calc(100vw-1rem)] min-w-52 flex-col",
              )}
            >
              <ActionMenuItems groups={groups} />
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      )}
    </ContextMenu.Root>
  );
}

export interface ActionMenuButtonProps {
  actions: ActionGroups;
  /** Accessible name, e.g. "More for Jonas". */
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * Shown only while its object (an `ActionMenuTarget`) is hovered or holds focus, and while
   * its menu is open; always shown on touch screens. Default true.
   */
  reveal?: boolean;
  align?: "start" | "center" | "end";
  className?: string;
}

/** The "…" button: the same actions as the object's context menu, as a pull-down menu. */
export function ActionMenuButton({
  actions,
  label = "More Actions",
  variant = "plain",
  size = "small",
  reveal = true,
  align = "end",
  className,
}: ActionMenuButtonProps) {
  const groups = useMemo(() => normalizeActions(actions), [actions]);
  if (groups.length === 0) return null;
  return (
    <Menu
      align={align}
      trigger={
        <IconButton
          label={label}
          tooltip={false}
          size={size}
          variant={variant}
          icon={<Ellipsis />}
          className={cn(reveal && "action-reveal", className)}
        />
      }
    >
      <ActionMenuItems groups={groups} />
    </Menu>
  );
}

export interface ActionMenuProps extends Omit<ActionMenuTargetProps, "children"> {
  children: ReactNode;
  /**
   * The "…" button: `overlay` floats it over the top-right corner (pictures, tiles), `none`
   * leaves right-click and long press only. Place it yourself with `ActionMenuButton` for
   * anything else. Default "none".
   */
  button?: "overlay" | "none";
  /** Accessible name of the "…" button. Default: `label`, else "More Actions". */
  buttonLabel?: string;
  buttonClassName?: string;
}

/**
 * An object with actions: right-click and long press open its menu, and
 * (`button="overlay"`) a "…" button shows the same menu.
 */
export function ActionMenu({
  actions,
  button = "none",
  buttonLabel,
  buttonClassName,
  render,
  className,
  style,
  label,
  children,
}: ActionMenuProps) {
  return (
    <ActionMenuTarget
      actions={actions}
      render={render}
      label={label}
      className={cn(button === "overlay" && "relative", className)}
      style={style}
    >
      {children}
      {button === "overlay" ? (
        <ActionMenuButton
          actions={actions}
          label={buttonLabel ?? label}
          variant="dark"
          className={cn("absolute top-3 right-3 z-1", buttonClassName)}
        />
      ) : null}
    </ActionMenuTarget>
  );
}
