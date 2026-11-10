"use client";

import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type ReactElement,
  type ReactNode,
} from "react";
import { useRender } from "@base-ui/react/use-render";
import { mergeProps } from "@base-ui/react/merge-props";
import { ChevronRight } from "lucide-react";
import { cn } from "./cn";
import { FieldProvider } from "./Field";

const GroupContext = createContext<{ footerId?: string; size: GroupSize }>({ size: "regular" });

export type GroupSize = "regular" | "large";

/** The inset hairline between rows: starts at the row's leading padding, like System Settings. */
const rowDivider =
  "relative before:pointer-events-none before:absolute before:inset-x-3 before:top-0 before:h-(--hairline) before:bg-separator first:before:hidden";

const rowHeight: Record<GroupSize, string> = {
  regular: "min-h-(--row-h)",
  large: "min-h-(--row-h-lg)",
};

export interface GroupedListProps {
  /** Group title above the block. */
  header?: ReactNode;
  /** Help text under the block. Fields in the group are described by it. */
  footer?: ReactNode;
  /** `large` gives roomier rows (sign-in forms). */
  size?: GroupSize;
  className?: string;
  children: ReactNode;
}

/** An inset grouped list: one rounded block, rows divided by inset hairlines. */
export function GroupedList({
  header,
  footer,
  size = "regular",
  className,
  children,
}: GroupedListProps) {
  const id = useId();
  const footerId = footer ? `${id}-footer` : undefined;
  return (
    <GroupContext.Provider value={{ footerId, size }}>
      <section
        aria-labelledby={header ? `${id}-header` : undefined}
        className={cn("flex flex-col gap-1.5", className)}
      >
        {header ? (
          <h2 id={`${id}-header`} className="px-3 text-headline text-label">
            {header}
          </h2>
        ) : null}
        <div className="flex flex-col rounded-group bg-elevated">{children}</div>
        {footer ? (
          <div id={footerId} className="px-3 text-callout text-label-2">
            {footer}
          </div>
        ) : null}
      </section>
    </GroupContext.Provider>
  );
}

export interface GroupedListRowProps {
  /** Leading label. */
  label: ReactNode;
  /** Trailing content: a value, a control, a badge. */
  children?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

/** A static row: label on the leading side, value or control on the trailing side. */
export function GroupedListRow({ label, children, icon, className }: GroupedListRowProps) {
  const { size } = useContext(GroupContext);
  return (
    <div
      className={cn(
        rowDivider,
        rowHeight[size],
        "flex items-center gap-3 px-3 py-1.5 text-body",
        className,
      )}
    >
      {icon ? <span className="shrink-0 text-label-2 [&_svg]:size-(--icon)">{icon}</span> : null}
      <span className="min-w-0 flex-1 text-label">{label}</span>
      {children !== undefined ? (
        <span className="min-w-0 truncate text-right text-label-2">{children}</span>
      ) : null}
    </div>
  );
}

export interface GroupedListButtonProps extends Omit<
  React.ComponentPropsWithoutRef<"button">,
  "children"
> {
  children: ReactNode;
  icon?: ReactNode;
  /** Shows a trailing chevron: the row navigates somewhere. */
  chevron?: boolean;
  /** Red label for sign-out and similar actions. */
  destructive?: boolean;
  /** Render as another element, e.g. `render={<Link href="/x" />}`. */
  render?: ReactElement;
}

/** A whole-row button or link. */
export const GroupedListButton = forwardRef<HTMLElement, GroupedListButtonProps>(
  function GroupedListButton(
    { children, icon, chevron = false, destructive = false, render, className, type, ...rest },
    ref,
  ) {
    const { size } = useContext(GroupContext);
    const props = mergeProps<"button">(
      {
        type: render ? undefined : (type ?? "button"),
        className: cn(
          rowDivider,
          rowHeight[size],
          "flex w-full items-center gap-3 px-3 py-1.5 text-left text-body focus-ring focus-visible:-outline-offset-2",
          "first:rounded-t-group last:rounded-b-group",
          "transition-colors duration-(--dur-fast) hover:bg-fill-4 active:bg-fill-3",
          "disabled:pointer-events-none disabled:opacity-50",
          destructive ? "text-red" : "text-label",
          className,
        ),
        children: (
          <>
            {icon ? (
              <span className="shrink-0 text-label-2 [&_svg]:size-(--icon)">{icon}</span>
            ) : null}
            <span className="min-w-0 flex-1">{children}</span>
            {chevron ? (
              <ChevronRight aria-hidden="true" className="size-(--icon-sm) shrink-0 text-label-2" />
            ) : null}
          </>
        ),
      },
      rest,
    );
    return useRender({ defaultTagName: "button", render: render ?? <button />, ref, props });
  },
);

export interface GroupedListFieldProps {
  /** Row label; also the control's accessible name. */
  label: ReactNode;
  /** What is wrong and how to fix it, shown in the row in red. */
  error?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  /** One control, usually an Input. It renders bare to fill the row. */
  children: ReactNode;
}

/** A form row: label on the leading side, a bare text field filling the rest. */
export function GroupedListField({
  label,
  error,
  required = false,
  disabled = false,
  className,
  children,
}: GroupedListFieldProps) {
  const id = useId();
  const { footerId, size } = useContext(GroupContext);
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, footerId ?? null].filter(Boolean).join(" ");
  return (
    <FieldProvider
      value={{
        id,
        describedBy: describedBy || undefined,
        invalid: Boolean(error),
        required,
        disabled,
        inline: true,
      }}
    >
      <div
        className={cn(
          rowDivider,
          "grid grid-cols-[minmax(0,--spacing(28))_minmax(0,1fr)] items-center gap-x-3 px-3",
          "first:rounded-t-group last:rounded-b-group",
          "has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-focus",
          className,
        )}
      >
        <label
          htmlFor={id}
          className={cn(rowHeight[size], "flex items-center text-body text-label")}
        >
          {label}
        </label>
        <div className={cn(rowHeight[size], "flex min-w-0 items-center")}>{children}</div>
        {error ? (
          <p id={errorId} role="alert" className="col-start-2 pb-2 text-callout text-red">
            {error}
          </p>
        ) : null}
      </div>
    </FieldProvider>
  );
}
