"use client";

import { forwardRef, type ReactElement, type ReactNode } from "react";
import { useRender } from "@base-ui/react/use-render";
import { mergeProps } from "@base-ui/react/merge-props";
import { cn } from "./cn";
import { Tooltip } from "./Tooltip";

/** Top of the sidebar, as tall as the toolbar so the two line up. Holds the wordmark. */
export function SidebarHeader({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex h-(--toolbar-h) shrink-0 items-center px-4", className)}>
      {children}
    </div>
  );
}

/** The scrolling middle of the sidebar. Scrolls on its own when the lists are long. */
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
        "flex min-h-0 flex-1 [scrollbar-gutter:stable] flex-col gap-4 overflow-y-auto overscroll-contain px-2.5 pt-1 pb-4",
        className,
      )}
    >
      {children}
    </nav>
  );
}

/** The bottom of the sidebar: account and credits. */
export function SidebarFooter({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex shrink-0 flex-col gap-1 px-2.5 pt-2 pb-3 hairline-t", className)}>
      {children}
    </div>
  );
}

export interface SidebarSectionProps {
  /** Small header in the secondary label colour. Omit for an untitled first section. */
  title?: string;
  children: ReactNode;
  className?: string;
}

export function SidebarSection({ title, children, className }: SidebarSectionProps) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      {title ? (
        <h2 className="px-2 pb-0.5 text-subheadline font-semibold text-label-2">{title}</h2>
      ) : null}
      <ul className="flex flex-col gap-px">{children}</ul>
    </div>
  );
}

export interface SidebarItemProps extends Omit<React.ComponentPropsWithoutRef<"a">, "children"> {
  children: ReactNode;
  /** 16px line icon in the secondary label colour. */
  icon?: ReactNode;
  /** The row for the current page: white-tint fill, primary label. */
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
  { children, icon, selected = false, accessory, render, tooltip, className, ...rest },
  ref,
) {
  const props = mergeProps<"a">(
    {
      "aria-current": selected ? "page" : undefined,
      className: cn(
        "flex min-h-(--sidebar-row-h) w-full items-center gap-2 rounded-control px-2 text-left text-body focus-ring",
        selected ? "bg-selection text-label" : "text-label hover:bg-fill-4",
        className,
      ),
      children: (
        <>
          {icon ? (
            <span
              className={cn(
                "flex shrink-0 [&_svg]:size-(--icon)",
                selected ? "text-label" : "text-label-2",
              )}
            >
              {icon}
            </span>
          ) : null}
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
