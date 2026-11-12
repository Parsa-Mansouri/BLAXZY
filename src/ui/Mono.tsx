"use client";

import { forwardRef, type ElementType, type ReactElement, type ReactNode } from "react";
import { useRender } from "@base-ui/react/use-render";
import { mergeProps } from "@base-ui/react/merge-props";
import { cn } from "./cn";

export interface MonoProps {
  children: ReactNode;
  as?: ElementType;
  className?: string;
}

/**
 * A technical value in Geist Mono with aligned figures: a timecode, a duration, a price in
 * credits, a file name. The only place the mono face is used (status lines are Geist).
 * For ordinary numbers in Geist that still need to line up, use the `tabular-nums` class.
 */
export function Mono({ children, as: Tag = "span", className }: MonoProps) {
  return <Tag className={cn("mono-value", className)}>{children}</Tag>;
}

/** A keyboard shortcut, e.g. "⌘\". Mono, secondary colour. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn("mono-value text-label-2", className)}>{children}</kbd>;
}

export interface TextLinkProps extends React.ComponentPropsWithoutRef<"a"> {
  /** Render as another element, e.g. `render={<Link href="/x" />}`. Defaults to `<a>`. */
  render?: ReactElement;
}

/**
 * A text link inside running text: the brand colour, underlined on hover, the brand focus ring.
 * On the paper sheet it turns ink. Never on the white block (use a button there).
 */
export const TextLink = forwardRef<HTMLElement, TextLinkProps>(function TextLink(
  { render, className, ...rest },
  ref,
) {
  const props = mergeProps<"a">({ className: cn("link focus-ring", className) }, rest);
  return useRender({ defaultTagName: "a", render: render ?? <a />, ref, props });
});
