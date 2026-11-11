import type { ReactNode } from "react";

/**
 * "List left, focus right" for the shot and clip reviews, like the kit's FocusLayout with the
 * narrow list. One difference: when the two no longer fit side by side, the shot being reviewed
 * comes first and the list follows it, so a phone opens on the work, not on a long list.
 */
export function ReviewLayout({
  list,
  listLabel,
  children,
}: {
  list: ReactNode;
  listLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="@container flex flex-1 flex-col">
      <div className="flex flex-1 flex-wrap items-start gap-10">
        <nav
          aria-label={listLabel}
          className="flex min-w-0 flex-[1_1_200px] in-2 flex-col gap-0.5 @max-[799px]:order-last @min-[800px]:max-w-62"
        >
          {list}
        </nav>
        <div className="min-w-0 flex-[4_1_560px] in-3">{children}</div>
      </div>
    </div>
  );
}
