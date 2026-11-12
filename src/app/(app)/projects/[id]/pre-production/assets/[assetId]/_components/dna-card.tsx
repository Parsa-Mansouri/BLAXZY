"use client";

import type { DnaCard, SheetSpecView } from "@/server/assets";
import { dimensionWords, sheetLevelWords, type PackKind } from "../_lib/sheet-review";
import { Caps } from "./desk";

function Lines({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <Caps as="h4">{title}</Caps>
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item} className="text-secondary text-pretty break-words text-label-2">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What every view keeps: the accepted design's DNA (its summary, fixed anchors or signature
 * details, identity, rules and what may change) and, for a prop, its scale card and sheet level.
 * The scale card is drawn by BLAXZY, never by the image model, so it is shown as text.
 */
export function DnaCardView({
  kind,
  card,
  spec,
}: {
  kind: PackKind;
  card: DnaCard | null;
  /** The pack's sheet spec (a prop's scale card and level). */
  spec: SheetSpecView | null;
}) {
  const scale = kind === "prop" ? (spec?.scaleCard ?? null) : null;
  const level = kind === "prop" ? sheetLevelWords(spec?.sheetLevel) : null;
  if (!card && !scale && !level) return null;
  return (
    <section
      aria-labelledby="dna-title"
      className="flex flex-col gap-6 rounded-card border border-outline-quiet bg-elevated p-5 sm:p-6"
    >
      <div className="flex flex-col gap-2">
        <h3 id="dna-title" className="text-section">
          {kind === "location" ? "Location DNA" : "Prop DNA"}
        </h3>
        {card?.summary ? (
          <p className="max-w-(--measure) text-body text-pretty break-words text-label">
            {card.summary}
          </p>
        ) : null}
      </div>
      {card ? (
        <div className="grid gap-6 sm:grid-cols-2">
          <Lines
            title={kind === "location" ? "Fixed anchors" : "Signature details"}
            items={card.anchors}
          />
          <Lines title="Identity" items={card.identity} />
          <Lines title="Never changes" items={card.constraints} />
          <Lines title="May change" items={card.mutable} />
        </div>
      ) : null}
      {scale || level ? (
        <div className="grid gap-6 border-t border-outline-quiet pt-5 sm:grid-cols-2">
          {scale ? (
            <div className="flex flex-col gap-2">
              <Caps as="h4">Scale card</Caps>
              <p className="font-mono text-secondary break-words whitespace-pre-wrap text-label">
                {scale.text}
              </p>
              <p className="text-meta text-label-2">{dimensionWords(scale.dimensionsStatus)}</p>
            </div>
          ) : null}
          {level ? (
            <div className="flex flex-col gap-2">
              <Caps as="h4">{level.title}</Caps>
              <p className="text-secondary text-pretty text-label-2">{level.line}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
