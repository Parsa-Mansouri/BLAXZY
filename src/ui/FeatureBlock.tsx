"use client";

import { forwardRef, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { useRender } from "@base-ui/react/use-render";
import { mergeProps } from "@base-ui/react/merge-props";
import { cn } from "./cn";

interface BlockBaseProps extends Omit<
  React.ComponentPropsWithoutRef<"button">,
  "children" | "title"
> {
  /** Render as another element, e.g. `render={<Link href="..." />}`. */
  render?: ReactElement;
  style?: CSSProperties;
}

export interface FeatureBlockProps extends BlockBaseProps {
  /** The main road, Title Case: "Answer a Few Questions". */
  title: ReactNode;
  /** One sentence on what happens. */
  description?: ReactNode;
  /** The pill at the bottom, e.g. "Start". Part of the block, not a separate button. */
  cta?: ReactNode;
  /** A `<DemoHint>` that plays behind the label. The block becomes its `demo-host`. */
  demo?: ReactNode;
}

/**
 * The leading option when several roads lead on and one is the main one: a big white block
 * (radius 20, 32px title). Put the alternatives beside it as QuietTiles. The whole block is one
 * button or link; it counts as the screen's one white button.
 */
export const FeatureBlock = forwardRef<HTMLElement, FeatureBlockProps>(function FeatureBlock(
  { title, description, cta, demo, render, className, type, ...rest },
  ref,
) {
  const props = mergeProps<"button">(
    {
      type: render ? undefined : (type ?? "button"),
      className: cn(
        "press flex min-h-75 flex-col justify-between gap-8 rounded-block bg-accent p-8 text-left text-on-accent focus-ring",
        "hover:bg-accent/95 disabled:pointer-events-none disabled:bg-fill-2 disabled:text-label-3",
        demo != null && "demo-host",
        className,
      ),
      children: (
        <>
          {demo}
          <span className="flex flex-col gap-3">
            <span className="text-block-title text-balance">{title}</span>
            {description ? (
              <span className="max-w-[34ch] text-body text-pretty text-on-accent-2">
                {description}
              </span>
            ) : null}
          </span>
          {cta ? (
            <span className="inline-flex h-11 items-center self-start rounded-capsule bg-on-accent px-6 text-row font-semibold text-accent">
              {cta}
            </span>
          ) : null}
        </>
      ),
    },
    rest,
  );
  return useRender({ defaultTagName: "button", render: render ?? <button />, ref, props });
});

export interface QuietTileProps extends BlockBaseProps {
  /** The alternative's name, Title Case: "Write a Prompt". */
  title: ReactNode;
  /** Optional line icon above the title. */
  icon?: ReactNode;
  /** Optional one sentence; leave it out when the title says enough. */
  description?: ReactNode;
  /** A `<DemoHint>` that plays behind the label. The tile becomes its `demo-host`. */
  demo?: ReactNode;
}

/** An alternative road, present but quieter: a dark tile with its title at the bottom. */
export const QuietTile = forwardRef<HTMLElement, QuietTileProps>(function QuietTile(
  { title, icon, description, demo, render, className, type, ...rest },
  ref,
) {
  const props = mergeProps<"button">(
    {
      type: render ? undefined : (type ?? "button"),
      className: cn(
        "press flex min-h-30 flex-col justify-between gap-4 rounded-block bg-elevated p-6 text-left text-label focus-ring",
        "hover:bg-fill-4 disabled:pointer-events-none disabled:text-label-3",
        !icon && "justify-end",
        demo != null && "demo-host",
        className,
      ),
      children: (
        <>
          {demo}
          {icon ? (
            <span className="flex text-label-2 [&_svg]:size-(--icon-lg)" aria-hidden="true">
              {icon}
            </span>
          ) : null}
          <span className="flex flex-col gap-1">
            <span className="text-row font-semibold text-balance">{title}</span>
            {description ? (
              <span className="text-secondary text-pretty text-label-2">{description}</span>
            ) : null}
          </span>
        </>
      ),
    },
    rest,
  );
  return useRender({ defaultTagName: "button", render: render ?? <button />, ref, props });
});
