import type { ReactNode } from "react";
import { cn } from "@/ui";

export interface SlateField {
  label: string;
  value: ReactNode;
  /** Take the slate's full width. */
  wide?: boolean;
}

export interface SlateProps {
  /** The first field's label ("Plan", "Tool"). */
  kind: string;
  name: string;
  fields: readonly SlateField[];
  /** Bright (white clapper and lines) or quiet (grey). */
  live: boolean;
  delay?: number;
  /** A full-width cell after the fields, for pictures. */
  children?: ReactNode;
  className?: string;
}

/**
 * A film slate: the striped clapper on top (it lifts on hover), then the slate's fields in a
 * ruled grid, the name the biggest of them.
 */
export function Slate({ kind, name, fields, live, delay = 0, children, className }: SlateProps) {
  return (
    <article
      aria-label={name}
      className={cn("group flex enter flex-col", className)}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div
        aria-hidden="true"
        className={cn(
          "h-10 origin-bottom-left transition-transform duration-(--dur-wipe) ease-(--ease-curve) group-hover:-rotate-[7deg]",
          live ? "clapper" : "clapper-quiet",
        )}
      />
      <div aria-hidden="true" className={cn("h-6", live ? "clapper" : "clapper-quiet")} />
      <dl
        className={cn(
          "grid grid-cols-2 gap-px border",
          live
            ? "border-label bg-label text-label"
            : "border-separator-opaque bg-separator-opaque text-label-3",
        )}
      >
        <div className="col-span-2 flex flex-col gap-3 bg-ground p-6">
          <dt className="credit opacity-60">{kind}</dt>
          <dd className="credit-title">{name}</dd>
        </div>
        {fields.map((field) => (
          <div
            key={field.label}
            className={cn("flex flex-col gap-2 bg-ground p-6", field.wide && "col-span-2")}
          >
            <dt className="credit opacity-60">{field.label}</dt>
            <dd className="credit-lg">{field.value}</dd>
          </div>
        ))}
        {children ? <div className="col-span-2 bg-ground p-6">{children}</div> : null}
      </dl>
    </article>
  );
}
