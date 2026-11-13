import type { ReactNode } from "react";

/**
 * Scenes left, sheet right, filling the height left on the page (the sheet runs to the bottom
 * like a page). The list is slim so the screenplay gets a comfortable width and is the largest
 * thing on screen; 48px of black keep the list apart from the page. Below about 760px of
 * content the sheet wraps under the list.
 */
export function ScenesLayout({ side, children }: { side: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-1 in-3 flex-wrap gap-x-12 gap-y-10">
      {side ? (
        <div className="flex min-w-0 flex-[1_1_176px] flex-col gap-6 self-start sm:max-w-44 2xl:max-w-60">
          {side}
        </div>
      ) : null}
      <div className="flex min-w-0 flex-[4_1_560px] flex-col">{children}</div>
    </div>
  );
}
