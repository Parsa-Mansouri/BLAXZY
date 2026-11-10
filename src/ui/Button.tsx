"use client";

import { forwardRef, type ReactElement, type ReactNode } from "react";
import { useRender } from "@base-ui/react/use-render";
import { mergeProps } from "@base-ui/react/merge-props";
import { cn } from "./cn";
import { Spinner } from "./Spinner";
import { Tooltip } from "./Tooltip";

/**
 * - `prominent`: white capsule with black text. At most one per screen: the next step.
 * - `standard`: grey fill. Everything else that is a button.
 * - `plain`: text only, for quiet secondary actions.
 * - `destructive`: red text on the standard fill.
 * - `destructive-confirm`: red fill. Only inside an Alert that confirms a destructive action.
 */
export type ButtonVariant =
  "prominent" | "standard" | "plain" | "destructive" | "destructive-confirm";
export type ButtonSize = "regular" | "large";

const variants: Record<ButtonVariant, string> = {
  prominent:
    "rounded-capsule bg-accent text-on-accent font-semibold hover:bg-accent/90 active:bg-accent/75",
  standard: "rounded-control bg-fill-2 text-label hover:bg-fill active:bg-fill",
  plain: "rounded-control text-label hover:bg-fill-4 active:bg-fill-3",
  destructive: "rounded-control bg-fill-2 text-red hover:bg-fill active:bg-fill",
  "destructive-confirm":
    "rounded-control bg-red text-on-red font-semibold hover:bg-red/90 active:bg-red/75",
};

const sizes: Record<ButtonSize, string> = {
  regular: "h-(--control-h) gap-1.5 px-3",
  large: "h-(--control-h-lg) gap-2 px-4",
};

const capsulePadding: Record<ButtonSize, string> = { regular: "px-4", large: "px-5" };

const iconSizes: Record<ButtonSize, string> = {
  regular: "size-(--control-h)",
  large: "size-(--control-h-lg)",
};

const base =
  "focus-ring relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap text-body font-medium " +
  "transition-colors duration-(--dur-fast) " +
  "aria-disabled:pointer-events-none aria-disabled:opacity-40 " +
  "[&_svg]:size-(--icon) [&_svg]:shrink-0";

export interface ButtonProps extends Omit<React.ComponentPropsWithoutRef<"button">, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, keeps the width, and blocks clicks. */
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  /** Render as another element, e.g. `render={<Link href="/x" />}`. */
  render?: ReactElement;
  /** Shorthand for `render={<a href={href} />}` (a full page load; prefer `render` with Link). */
  href?: string;
  children?: ReactNode;
}

interface InnerProps extends ButtonProps {
  iconOnly?: boolean;
}

function useButton(
  {
    variant = "standard",
    size = "regular",
    loading = false,
    leadingIcon,
    trailingIcon,
    render,
    href,
    disabled,
    className,
    children,
    onClick,
    iconOnly,
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
      className: cn(
        base,
        variants[variant],
        iconOnly ? iconSizes[size] : sizes[size],
        !iconOnly && variant === "prominent" && capsulePadding[size],
        className,
      ),
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
              "inline-flex items-center justify-center gap-[inherit]",
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

  return useRender({ defaultTagName: "button", render: element, ref, props });
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
  /** Keyboard shortcut shown in the tooltip. */
  shortcut?: string;
  tooltipSide?: "top" | "bottom" | "left" | "right";
}

/** A square, icon-only button. Plain by default. */
export const IconButton = forwardRef<HTMLElement, IconButtonProps>(function IconButton(
  { label, icon, tooltip = true, shortcut, tooltipSide, variant = "plain", ...rest },
  ref,
) {
  const button = useButton(
    { ...rest, variant, iconOnly: true, children: icon, "aria-label": label },
    ref,
  );
  if (!tooltip) return button;
  return (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide}>
      {button}
    </Tooltip>
  );
});
