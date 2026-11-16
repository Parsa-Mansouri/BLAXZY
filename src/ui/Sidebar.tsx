"use client";

import { forwardRef, type ReactElement, type ReactNode } from "react";
import { useRender } from "@base-ui/react/use-render";
import { mergeProps } from "@base-ui/react/merge-props";
import { cn } from "./cn";
import { Tooltip } from "./Tooltip";

/** Top of the sidebar panel. Holds the wordmark. */
export function SidebarHeader({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("flex shrink-0 items-center px-2.5", className)}>{children}</div>;
}

/** The scrolling middle of the sidebar: New Project, the nav rows and the recent films. */
export function SidebarBody({
  children,
  className,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        "-mx-1 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-1 py-0.5",
        className,
      )}
    >
      {children}
    </nav>
  );
}

/** The bottom of the sidebar: the account row. */
export function SidebarFooter({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("flex shrink-0 flex-col gap-0.5", className)}>{children}</div>;
}

export interface SidebarSectionProps {
  /**
   * Accessible name of the group. Not shown unless `showTitle`: the sidebar has no section
   * captions, except over a group that is there only now and then ("Now Rendering").
   */
  title?: string;
  /** Show `title` as a quiet capital caption over the rows. */
  showTitle?: boolean;
  /**
   * A separate group (the recent films). Set apart by space only: the hairline it used to draw
   * is gone (group with spacing, not rules).
   */
  divided?: boolean;
  children: ReactNode;
  className?: string;
}

/** A group of sidebar rows. */
export function SidebarSection({
  title,
  showTitle = false,
  divided = false,
  children,
  className,
}: SidebarSectionProps) {
  return (
    <div className={cn("flex flex-col", divided && "pt-3", className)}>
      {title ? (
        <h2 className={showTitle ? "px-3 pb-2 caps-label text-label-3" : "sr-only"}>{title}</h2>
      ) : null}
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </div>
  );
}

export interface SidebarItemProps extends Omit<React.ComponentPropsWithoutRef<"a">, "children"> {
  children: ReactNode;
  /**
   * `nav` (HOME, PROJECTS): 13px capitals with an icon. `row` (default): a film title or the
   * account row, 15px.
   */
  variant?: "nav" | "row";
  /** 16px line icon. */
  icon?: ReactNode;
  /** The row for the current page: its fill wipes in from the left, the label turns white. */
  selected?: boolean;
  /** Trailing content, e.g. a count. */
  accessory?: ReactNode;
  /** Render as another element, e.g. `render={<Link href="/x" />}`. Defaults to `<a>`. */
  render?: ReactElement;
  /** Full text shown on hover, for rows whose label may be cut off (e.g. long project titles). */
  tooltip?: string;
  /**
   * A row under another row (a stage's areas): the label lines up with the parent's label, past
   * its icon column. Ignored when the row has its own icon.
   */
  inset?: boolean;
  /**
   * A row that cannot be opened yet (a locked stage): label-3 text, no hover fill, no press.
   * Render it as a non-link (`render={<span />}`) and say why in `tooltip`.
   */
  disabled?: boolean;
}

/** A sidebar row. Renders a link by default; pass `render` for a Next Link or a button. */
export const SidebarItem = forwardRef<HTMLElement, SidebarItemProps>(function SidebarItem(
  {
    children,
    variant = "row",
    icon,
    selected = false,
    accessory,
    render,
    tooltip,
    inset = false,
    disabled = false,
    className,
    ...rest
  },
  ref,
) {
  const props = mergeProps<"a">(
    {
      "aria-current": selected ? "page" : undefined,
      "aria-disabled": disabled ? true : undefined,
      className: cn(
        "row-wipe flex min-h-(--sidebar-row-h) w-full items-center gap-2.5 rounded-nested px-3 text-left font-medium focus-ring",
        variant === "nav" ? "caps-label" : "text-body font-medium",
        disabled
          ? "cursor-default text-label-3"
          : selected
            ? "press text-label"
            : "press text-label-2 hover:bg-fill-4 hover:text-label",
        className,
      ),
      children: (
        <>
          {icon ? (
            <span className="flex shrink-0 [&_svg]:size-(--icon)">{icon}</span>
          ) : inset ? (
            <span aria-hidden="true" className="w-(--icon) shrink-0" />
          ) : null}
          <span className="min-w-0 flex-1 truncate">{children}</span>
          {accessory ? (
            <span className="shrink-0 text-label-2 tabular-nums">{accessory}</span>
          ) : null}
        </>
      ),
    },
    rest,
  );
  const element = useRender({ defaultTagName: "a", render: render ?? <a />, ref, props });
  return (
    <li>
      {tooltip ? (
        <Tooltip content={tooltip} side="right" delay={500}>
          {element}
        </Tooltip>
      ) : (
        element
      )}
    </li>
  );
});

export interface SidebarActionProps extends Omit<
  React.ComponentPropsWithoutRef<"button">,
  "children"
> {
  children: ReactNode;
  icon?: ReactNode;
  /** Render as another element, e.g. `render={<Link href="/dashboard" />}`. */
  render?: ReactElement;
}

/** The outlined action at the top of the sidebar ("New Project"). */
export const SidebarAction = forwardRef<HTMLElement, SidebarActionProps>(function SidebarAction(
  { children, icon, render, className, type, ...rest },
  ref,
) {
  const props = mergeProps<"button">(
    {
      type: render ? undefined : (type ?? "button"),
      className: cn(
        "press flex min-h-(--sidebar-row-h) w-full shrink-0 items-center gap-2.5 rounded-nested border border-outline-quiet px-3 text-left text-secondary font-medium text-label focus-ring hover:bg-fill-4",
        className,
      ),
      children: (
        <>
          {icon ? <span className="flex shrink-0 [&_svg]:size-(--icon)">{icon}</span> : null}
          <span className="min-w-0 flex-1 truncate">{children}</span>
        </>
      ),
    },
    rest,
  );
  return useRender({ defaultTagName: "button", render: render ?? <button />, ref, props });
});
