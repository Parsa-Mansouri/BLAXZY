"use client";

import { forwardRef, type ReactElement, type ReactNode } from "react";
import { useRender } from "@base-ui/react/use-render";
import { mergeProps } from "@base-ui/react/merge-props";
import { ChevronLeft } from "lucide-react";
import { cn } from "./cn";

export interface BackControlProps extends Omit<React.ComponentPropsWithoutRef<"a">, "children"> {
  /** Where back leads, named as its page: "Pre-production", "Characters". */
  children: ReactNode;
  /** Render as another element, e.g. `render={<Link href="..." />}`. Defaults to `<a>`. */
  render?: ReactElement;
}

/** The toolbar's way back up one level on deeper pages: a quiet 36px pill with a chevron. */
export const BackControl = forwardRef<HTMLElement, BackControlProps>(function BackControl(
  { children, render, className, ...rest },
  ref,
) {
  const props = mergeProps<"a">(
    {
      className: cn(
        "press inline-flex h-(--btn-sm) max-w-full min-w-0 items-center gap-1.5 rounded-capsule bg-fill-4 pr-3.5 pl-2 text-meta font-medium text-label-2 focus-ring",
        "hover:bg-fill-3 hover:text-label",
        className,
      ),
      children: (
        <>
          <ChevronLeft aria-hidden="true" className="size-(--icon) shrink-0" />
          <span className="truncate">{children}</span>
        </>
      ),
    },
    rest,
  );
  return useRender({ defaultTagName: "a", render: render ?? <a />, ref, props });
});
