import Link from "next/link";
import { Lock } from "lucide-react";
import { Button, PageHeader, StatusLine } from "@/ui";
import type { PreProductionLine } from "../_lib/pre-production-line";
import { FillPage } from "./fill-page";

/**
 * Production before Pre-production is done: what opens it, the way back to the current stage
 * and, when the project is in Pre-production, what is still left there.
 */
export function ProductionLocked({
  currentHref,
  currentLabel,
  line,
}: {
  currentHref: string;
  currentLabel: string;
  line: PreProductionLine | null;
}) {
  return (
    <FillPage>
      <PageHeader
        title="Production"
        description="The film is generated here, shot by shot, once Pre-production is done."
      />
      <section
        aria-label="Production is locked"
        className="flex min-h-110 flex-1 in-2 flex-col justify-between gap-12 rounded-block bg-elevated p-6 sm:p-10"
      >
        <Lock aria-hidden strokeWidth={1.5} className="size-8 text-label-3" />
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-3">
            <h2 className="max-w-[20ch] text-heading font-semibold tracking-[-0.03em] text-balance">
              Production opens when every asset is ready.
            </h2>
            <p className="max-w-[60ch] text-body text-label-2">
              You review each shot, then each generated clip.
            </p>
          </div>
          <div className="flex in-3 flex-wrap items-center gap-x-6 gap-y-4">
            <Button render={<Link href={currentHref} />}>Go to {currentLabel}</Button>
            {line ? (
              <StatusLine tone={line.tone}>
                {currentLabel}: {line.text}
              </StatusLine>
            ) : null}
          </div>
        </div>
      </section>
    </FillPage>
  );
}
