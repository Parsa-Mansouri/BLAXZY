"use client";

import { forwardRef, type ReactElement, type ReactNode } from "react";
import { useRender } from "@base-ui/react/use-render";
import { mergeProps } from "@base-ui/react/merge-props";
import { cn } from "./cn";
import { Spinner } from "./Spinner";
import { Tooltip } from "./Tooltip";

/**
 * Every button is a capsule that presses to 98%.
 *
 * - `primary` (also `prominent`): white with black text. ONE per screen: the main step.
 * - `outlined` (also `standard`): 1px grey outline. The usual secondary action.
 * - `dark`: filled #343437. A secondary action on a raised surface (cover panels, the hero).
 * - `plain`: text only in the secondary colour, for quiet actions such as Back or Cancel.
 * - `destructive`: outlined with red text.
 * - `destructive-confirm`: red fill. Only inside an Alert that confirms a destructive action.
 */
export type ButtonVariant =
  | "primary"
  | "prominent"
  | "outlined"
  | "standard"
  | "dark"
  | "plain"
  | "destructive"
  | "destructive-confirm";

/** `small` 36px, `regular` 40px (page header actions), `large` 48px (hero, finish steps). */
export type ButtonSize = "small" | "regular" | "large";

const primary = "bg-accent text-on-accent font-semibold hover:bg-accent/90";
const outlined = "border border-outline text-label hover:bg-fill-4";

const variants: Record<ButtonVariant, string> = {
  primary,
  prominent: primary,
  outlined,
  standard: outlined,
  dark: "bg-fill text-label hover:bg-elevated-3",
  plain: "text-label-2 hover:text-label",
  destructive: "border border-outline text-red hover:bg-fill-4",
  "destructive-confirm": "bg-red text-on-red font-semibold hover:bg-red/90",
};

const sizes: Record<ButtonSize, string> = {
  small: "h-(--btn-sm) gap-1.5 px-4 text-secondary",
  regular: "h-(--btn) gap-2 px-5 text-body",
  large: "h-(--btn-lg) gap-2 px-7 text-[16px] leading-[22px]",
};

/** Plain buttons keep a small inset so their text lines up with the content edge. */
const plainSizes: Record<ButtonSize, string> = {
  small: "px-1",
  regular: "px-1",
  large: "px-2",
};

const iconSizes: Record<ButtonSize, string> = {
  small: "size-8",
  regular: "size-(--btn-sm)",
  large: "size-11",
};

const base =
  "press focus-ring relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-capsule font-medium " +
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
    variant = "outlined",
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
        !iconOnly && variant === "plain" && plainSizes[size],
        iconOnly && variant === "plain" && "hover:bg-fill-4",
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

/** A round, icon-only button. Plain by default; `dark` gives the filled round button. */
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
