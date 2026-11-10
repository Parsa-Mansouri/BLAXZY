"use client";

import { forwardRef, type ReactElement, type ReactNode } from "react";
import { useRender } from "@base-ui/react/use-render";
import { mergeProps } from "@base-ui/react/merge-props";
import { cn } from "./cn";
import { Spinner } from "./Spinner";
import { Tooltip } from "./Tooltip";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover",
  secondary: "border border-line-strong bg-surface text-fg hover:bg-raised hover:border-fg-subtle",
  ghost: "text-fg-muted hover:bg-hover hover:text-fg",
  danger: "bg-danger text-on-danger hover:bg-danger-hover",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-9 gap-1.5 px-3 text-sm",
  md: "h-11 gap-2 px-4 text-sm",
  lg: "h-13 gap-2.5 px-6 text-base",
};

const iconSizes: Record<ButtonSize, string> = { sm: "size-9", md: "size-11", lg: "size-13" };

const base =
  "focus-ring relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-md font-medium " +
  "transition-[background-color,border-color,color,scale] duration-(--duration-fast) ease-(--ease-out) " +
  "active:scale-[0.98] aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:active:scale-100 " +
  "aria-disabled:hover:bg-[inherit] [&_svg]:size-[1.15em] [&_svg]:shrink-0";

export interface ButtonProps extends Omit<React.ComponentPropsWithoutRef<"button">, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, keeps the width, and blocks clicks. */
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  /** Render as another element, e.g. `render={<Link href="/x" />}` or `<a href>`. */
  render?: ReactElement;
  /** Shorthand for `render={<a href={href} />}`. */
  href?: string;
  children?: ReactNode;
}

interface InnerProps extends ButtonProps {
  fullIcon?: boolean;
}

function useButton(
  {
    variant = "secondary",
    size = "md",
    loading = false,
    leadingIcon,
    trailingIcon,
    render,
    href,
    disabled,
    className,
    children,
    onClick,
    fullIcon,
    type,
    ...rest
  }: InnerProps,
  ref: React.ForwardedRef<HTMLElement>,
) {
  const inactive = Boolean(disabled || loading);
  const element = render ?? (href !== undefined ? <a href={href} /> : <button />);
  const isNativeButton = !render && href === undefined;

  const props = mergeProps<"button">(
    {
      className: cn(base, variants[variant], fullIcon ? iconSizes[size] : sizes[size], className),
      "aria-disabled": inactive || undefined,
      "aria-busy": loading || undefined,
      type: isNativeButton ? (type ?? "button") : undefined,
      onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
        if (inactive) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      },
      children: (
        <>
          <span
            className={cn(
              "inline-flex items-center justify-center",
              "gap-[inherit]",
              loading && "invisible",
            )}
          >
            {leadingIcon}
            {children}
            {trailingIcon}
          </span>
          {loading ? (
            <span className="absolute inset-0 flex items-center justify-center">
              <Spinner size="sm" label="Working" />
            </span>
          ) : null}
        </>
      ),
    },
    rest,
  );

  return useRender({
    defaultTagName: "button",
    render: element,
    ref,
    props,
  });
}

export const Button = forwardRef<HTMLElement, ButtonProps>(function Button(props, ref) {
  return useButton(props, ref);
});

export interface IconButtonProps extends Omit<
  ButtonProps,
  "leadingIcon" | "trailingIcon" | "children"
> {
  /** Required accessible name. Also shown as the tooltip. */
  label: string;
  icon: ReactNode;
  /** Set to false to skip the tooltip. */
  tooltip?: boolean;
}

export const IconButton = forwardRef<HTMLElement, IconButtonProps>(function IconButton(
  { label, icon, tooltip = true, variant = "ghost", ...rest },
  ref,
) {
  const button = useButton(
    { ...rest, variant, fullIcon: true, children: icon, "aria-label": label },
    ref,
  );
  if (!tooltip) return button;
  return <Tooltip content={label}>{button}</Tooltip>;
});
