"use client";

import { useState, type ReactNode } from "react";
import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { cn } from "./cn";

export interface TabItem {
  value: string;
  /** Fixed words; set in 13px capitals. */
  label: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: TabItem[];
  /** Controlled value. Leave unset and use `defaultValue` for an uncontrolled strip. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Accessible name of the tab list. */
  "aria-label": string;
  /** Quiet content at the trailing end of the strip, e.g. "Earlier version, read only". */
  trailing?: ReactNode;
  /**
   * The panel content for the selected tab. A function receives the selected value. It replays
   * a 250ms fade-in when the tab changes.
   */
  children?: ReactNode | ((value: string) => ReactNode);
  className?: string;
  /** Classes for the panel (default: 32px above it). */
  panelClassName?: string;
}

/**
 * A tab strip with ONE white underline that slides to the selected tab (300ms). Tabs are 13px
 * capitals; arrow keys move between them.
 */
export function Tabs({
  tabs,
  value,
  defaultValue,
  onValueChange,
  trailing,
  children,
  className,
  panelClassName,
  "aria-label": ariaLabel,
}: TabsProps) {
  const [inner, setInner] = useState(defaultValue ?? tabs[0]?.value ?? "");
  const current = value ?? inner;
  return (
    <BaseTabs.Root
      value={current}
      onValueChange={(next) => {
        const v = String(next);
        if (value === undefined) setInner(v);
        onValueChange?.(v);
      }}
      className={className}
    >
      <div className="relative flex flex-wrap items-center gap-x-4 border-b border-separator">
        <BaseTabs.List aria-label={ariaLabel} className="relative flex min-w-0 overflow-x-auto">
          {tabs.map((tab) => (
            <BaseTabs.Tab
              key={tab.value}
              value={tab.value}
              disabled={tab.disabled}
              className={cn(
                "min-w-[132px] shrink-0 px-3 py-2.5 text-left caps-label text-label-2 focus-ring focus-visible:-outline-offset-2",
                "transition-colors duration-(--dur-press) hover:text-label",
                "data-[active]:text-label data-[disabled]:pointer-events-none data-[disabled]:text-label-3",
              )}
            >
              {tab.label}
            </BaseTabs.Tab>
          ))}
          <BaseTabs.Indicator
            renderBeforeHydration
            className={cn(
              "absolute bottom-0 left-0 h-0.5 w-(--active-tab-width) translate-x-(--active-tab-left) rounded-capsule bg-accent",
              "transition-[translate,width] duration-(--dur-tab) ease-out",
            )}
          />
        </BaseTabs.List>
        {trailing ? (
          <div className="ml-auto swap-in py-2 text-meta text-label-2">{trailing}</div>
        ) : null}
      </div>
      {children !== undefined
        ? tabs.map((tab) => (
            <BaseTabs.Panel
              key={tab.value}
              value={tab.value}
              className={cn("pt-8 outline-none", panelClassName)}
            >
              {tab.value === current ? (
                <div key={current} className="swap-in">
                  {typeof children === "function" ? children(current) : children}
                </div>
              ) : null}
            </BaseTabs.Panel>
          ))
        : null}
    </BaseTabs.Root>
  );
}
