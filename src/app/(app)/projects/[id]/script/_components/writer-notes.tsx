"use client";

import { ActionMenu, Button, StatusLine, cn, stagger } from "@/ui";
import type { VersionView } from "./version-types";

type Assumption = VersionView["assumptions"][number];

/** Warnings start with a tag ("Runtime: ...", "MERGE_CHECK: ..."); show the sentence only. */
function warningText(warning: string): string {
  return warning.replace(/^[A-Z_]+:\s*/, "").replace(/^Runtime:\s*/, "");
}

/**
 * What the writer flagged and what it invented, beside the reading: each warning as a waiting
 * line, then every added detail as a row the user can turn down ("Not This" asks for a revision
 * without it). Enhanced versions show their look line, or that the user's own words were kept.
 */
export function WriterNotes({
  version,
  onRejectAssumption,
  disabled,
  className,
}: {
  version: VersionView;
  /** Null on a read-only (older) version. */
  onRejectAssumption: ((assumption: Assumption) => void) | null;
  disabled?: boolean;
  className?: string;
}) {
  const { warnings, assumptions, lookLine, enhanceFellBack } = version;
  if (warnings.length === 0 && assumptions.length === 0 && !lookLine && !enhanceFellBack) {
    return null;
  }
  return (
    <section
      aria-labelledby="writer-notes"
      className={cn("mt-16 flex w-full max-w-205 flex-col gap-8", className)}
    >
      <h2 id="writer-notes" className="text-section text-balance">
        {version.source === "enhanced" ? "About This Story" : "What the Writer Decided"}
      </h2>

      {enhanceFellBack ? (
        <StatusLine tone="waiting">
          Your idea could not be expanded this time, so your own words are kept. Review them, or ask
          for changes.
        </StatusLine>
      ) : null}

      {lookLine ? (
        <figure className="flex flex-col gap-2 border-l-2 border-brand pl-4">
          <figcaption className="font-mono text-meta tracking-caps text-label-2 uppercase">
            The look, in one line
          </figcaption>
          <blockquote className="text-body text-pretty text-label">{lookLine}</blockquote>
        </figure>
      ) : null}

      {warnings.length > 0 ? (
        <ul className="flex flex-col gap-2.5" aria-label="Warnings">
          {warnings.map((w, i) => (
            <li key={i}>
              <StatusLine tone="waiting">{warningText(w)}</StatusLine>
            </li>
          ))}
        </ul>
      ) : null}

      {assumptions.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h3 className="font-mono text-meta tracking-caps text-label-2 uppercase">
            Added to fill the gaps
          </h3>
          <ul className="flex flex-col divide-y divide-outline-quiet border-y border-outline-quiet">
            {assumptions.map((a, i) => (
              <ActionMenu
                key={`${a.sceneNumber}-${i}`}
                render={<li />}
                label={`Actions for the Scene ${a.sceneNumber} detail`}
                actions={[
                  [
                    onRejectAssumption && {
                      id: "not-this",
                      label: "Not This",
                      disabled,
                      onSelect: () => onRejectAssumption(a),
                    },
                  ],
                ]}
                className="flex enter flex-wrap items-start gap-x-6 gap-y-2 py-4"
                style={stagger(i)}
              >
                <span className="w-16 shrink-0 pt-0.5 font-mono text-meta text-label-3 tabular-nums">
                  Scene {a.sceneNumber}
                </span>
                <div className="flex min-w-0 flex-[1_1_16rem] flex-col gap-1">
                  <p className="text-body text-pretty text-label">{a.text}</p>
                  <p className="text-secondary text-pretty text-label-2">{a.reason}</p>
                </div>
                {onRejectAssumption ? (
                  <Button
                    variant="plain"
                    size="small"
                    disabled={disabled}
                    onClick={() => onRejectAssumption(a)}
                  >
                    Not This
                  </Button>
                ) : null}
              </ActionMenu>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
