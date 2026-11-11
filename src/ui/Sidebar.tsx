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
  /** Accessible name of the group. Not shown: the sidebar has no section captions. */
  title?: string;
  /** Draws a hairline above the group (the recent films). */
  divided?: boolean;
  children: ReactNode;
  className?: string;
}

/** A group of sidebar rows. */
export function SidebarSection({
  title,
  divided = false,
  children,
  className,
}: SidebarSectionProps) {
  return (
    <div className={cn("flex flex-col", divided && "border-t border-separator pt-5", className)}>
      {title ? <h2 className="sr-only">{title}</h2> : null}
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
    className,
    ...rest
  },
  ref,
) {
  const props = mergeProps<"a">(
    {
      "aria-current": selected ? "page" : undefined,
      className: cn(
        "row-wipe press flex min-h-(--sidebar-row-h) w-full items-center gap-2.5 rounded-row px-3 text-left font-medium focus-ring",
        variant === "nav" ? "caps-label" : "text-body font-medium",
        selected ? "text-label" : "text-label-2 hover:bg-fill-4 hover:text-label",
        className,
      ),
      children: (
        <>
          {icon ? <span className="flex shrink-0 [&_svg]:size-(--icon)">{icon}</span> : null}
          <span className="min-w-0 flex-1 truncate">{children}</span>
          {accessory ? <span className="shrink-0 text-label-2">{accessory}</span> : null}
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
  /** Render as another element, e.g. `render={<Link href="/projects/new" />}`. */
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
        "press flex min-h-(--sidebar-row-h) w-full shrink-0 items-center gap-2.5 rounded-row border border-outline-quiet px-3 text-left text-secondary font-medium text-label focus-ring hover:bg-fill-4",
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
