import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/ui";

/** A titled part of the shot's focus area. `headingRef` makes the heading a focus target. */
export function Section({
  title,
  children,
  action,
  headingRef,
  className,
}: {
  title: string;
  className?: string;
  children: ReactNode;
  action?: ReactNode;
  /** Makes the heading a focus target (it then takes focus after a change in its section). */
  headingRef?: React.Ref<HTMLHeadingElement>;
}) {
  const heading = `block-${title.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <section aria-labelledby={heading} className={cn("flex min-w-0 flex-col gap-4", className)}>
      <div className="flex min-h-(--btn-sm) items-center justify-between gap-4">
        <h3
          ref={headingRef}
          id={heading}
          tabIndex={headingRef ? -1 : undefined}
          className="scroll-mt-[calc(var(--toolbar-h)+1rem)] text-section text-balance outline-none"
        >
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A section that starts closed: the title is the control, a chevron turns when it is open. */
export function ClosedSection({
  title,
  children,
  className,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details className={cn("group flex min-w-0 flex-col", className)}>
      <summary className="flex min-h-(--btn-sm) w-fit cursor-default list-none items-center gap-1.5 rounded-row text-section text-label focus-ring select-none hover:text-label-2 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="size-(--icon-lg) transition-transform duration-(--dur-press) ease-out group-open:rotate-90"
        />
        {title}
      </summary>
      <div className="flex flex-col gap-4 pt-3">{children}</div>
    </details>
  );
}
