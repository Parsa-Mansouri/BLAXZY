"use client";

import { AudioLines, ImageOff } from "lucide-react";
import { fileSrc } from "@/lib/file-src";
import { Button, cn, StoredImage } from "@/ui";
import type { LookView } from "@/server/assets";
import {
  lookOrigin,
  lookShape,
  parentLook,
  versionStatusLabel,
  type HistoryItem,
} from "../_lib/asset-view";
import type { DesignerInfo } from "../_lib/designer-view";
import { fieldName } from "../_lib/look-review";
import { StageHeading } from "./asset-context";
import { StageLayout } from "./stages/stage-layout";
import { ReferenceThumbs } from "./reference-conflict";
import { Artwork, MissingImage, type GuidedQuestion, type Orientation } from "./shared";

/** "ai_decides" (I'm not sure) in words. */
function answerWords(value: string, designer: DesignerInfo | null, label?: string): string {
  if (designer && value === designer.aiDecides) return "Not sure: BLAXZY decided";
  return label ?? value;
}

/** The look's answers to the guided questions, with their questions (as asked, when known). */
function guidedAnswerRows(
  look: LookView,
  questions: readonly GuidedQuestion[],
  designer: DesignerInfo | null,
): { key: string; label: string; value: string }[] {
  return Object.entries(look.guidedAnswers ?? {}).flatMap(([id, value]) => {
    if (!value) return [];
    const question = questions.find((q) => q.id === id);
    const option = question?.options?.find((o) => o.value === value);
    return [
      {
        key: id,
        label: question?.label ?? fieldName(id),
        value: answerWords(value, designer, option?.label),
      },
    ];
  });
}

/** The look's answers to the designer's own questions. */
function clarifyRows(look: LookView): { key: string; label: string; value: string }[] {
  return Object.entries(look.clarifyAnswers ?? {}).flatMap(([id, value]) => {
    if (!value) return [];
    const question = look.spec?.questions.find((q) => q.id === id);
    return [{ key: id, label: question?.question ?? fieldName(id), value }];
  });
}

function AnswerList({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; label: string; value: string }[];
}) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-section">{title}</h3>
      <dl className="flex flex-col gap-2">
        {rows.map((a) => (
          <div key={a.key} className="flex flex-col">
            <dt className="text-meta text-label-2">{a.label}</dt>
            <dd className="text-body break-words text-label">{a.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
import { AudioPlayer } from "./voice";
import { When } from "@/app/(app)/_components/values";

function itemTitle(item: HistoryItem, voice: boolean): string {
  if (item.kind === "sheet") return `Sheet ${item.version.versionNumber}`;
  return `${voice ? "Recording" : "Image"} ${item.version.versionNumber}`;
}

/** Earlier looks and sheets as a strip of small images; choosing one opens it read-only. */
export function HistoryStrip({
  items,
  voice,
  selectedKey,
  onSelect,
  className,
}: {
  items: HistoryItem[];
  voice: boolean;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  className?: string;
}) {
  return (
    <section aria-labelledby="history-title" className={cn("flex in-3 flex-col gap-4", className)}>
      <h2 id="history-title" className="text-section">
        History
      </h2>
      {items.length === 0 ? (
        <p className="text-secondary text-label-2">
          {voice
            ? "Every recording you add is kept here."
            : "Every image and sheet made for this asset is kept here."}
        </p>
      ) : (
        <ul className="-mx-2 flex snap-x gap-3 overflow-x-auto px-2 pt-1 pb-3">
          {items.map((item) => {
            const selected = item.key === selectedKey;
            const fileId = item.version.fileId;
            return (
              <li key={item.key} className="snap-start">
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelect(selected ? null : item.key)}
                  className="group flex w-32 press flex-col gap-2 rounded-tile text-left focus-ring"
                >
                  <span
                    className={cn(
                      "relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-tile transition-[box-shadow] duration-(--dur-press)",
                      fileId && !voice ? "bg-ground" : "bg-elevated",
                      selected
                        ? "ring-2 ring-brand ring-offset-2 ring-offset-ground"
                        : "group-hover:ring-1 group-hover:ring-separator-opaque",
                    )}
                  >
                    {voice ? (
                      <AudioLines
                        aria-hidden="true"
                        strokeWidth={1.5}
                        className="size-5 text-label-2"
                      />
                    ) : fileId ? (
                      <StoredImage
                        src={fileSrc(fileId)}
                        alt=""
                        className="absolute inset-0 size-full object-contain"
                      />
                    ) : item.version.status === "failed" ? (
                      <ImageOff
                        aria-hidden="true"
                        strokeWidth={1.5}
                        className="size-5 text-label-3"
                      />
                    ) : null}
                  </span>
                  <span className="flex flex-col px-0.5">
                    <span className="text-meta font-medium text-label">
                      {itemTitle(item, voice)}
                    </span>
                    <span className="text-meta text-label-2">
                      {versionStatusLabel(item.version.status)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** One earlier version, large and read-only, with how it was made. */
export function HistoryViewer({
  item,
  assetName,
  voice,
  orientation,
  questions,
  designer,
  looks,
  onBack,
}: {
  item: HistoryItem;
  assetName: string;
  voice: boolean;
  orientation: Orientation;
  questions: GuidedQuestion[];
  designer: DesignerInfo | null;
  /** The listed looks, to say what a look answered. */
  looks: LookView[];
  onBack: () => void;
}) {
  const title = itemTitle(item, voice);
  const { version } = item;
  const look = item.kind === "look" ? item.version : null;
  const answers = look ? guidedAnswerRows(look, questions, designer) : [];
  const clarify = look ? clarifyRows(look) : [];

  const bar = (
    <div className="flex in-2 flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-tile bg-elevated px-4 py-3">
      <p className="text-body text-label">Earlier version · {versionStatusLabel(version.status)}</p>
      <Button variant="plain" onClick={onBack}>
        Back to Current
      </Button>
    </div>
  );

  if (voice && version.fileId) {
    return (
      <div className="flex flex-col gap-8">
        {bar}
        <AudioPlayer fileId={version.fileId} label={`${assetName} ${title}`} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {bar}
      <StageLayout
        frame={
          <Artwork
            fileId={version.fileId}
            alt={`${assetName}, ${title}`}
            shape={look ? lookShape(look.aspectRatio, orientation) : "sheet"}
          >
            {version.fileId ? null : (
              <MissingImage
                label={version.status === "failed" ? "This version failed." : "No image yet."}
              />
            )}
          </Artwork>
        }
        rail={
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <StageHeading className="text-heading-sm">{title}</StageHeading>
              <p className="text-meta text-label-2">
                {look ? `${lookOrigin(look, parentLook(looks, look))} · ` : ""}
                <When date={version.createdAt} />
              </p>
              {version.isSample ? (
                <p className="text-meta text-label-2">Sample output from the test generator.</p>
              ) : null}
            </div>
            {version.failure ? (
              <p className="text-body text-pretty text-label-2">{version.failure}</p>
            ) : null}
            {look?.userPrompt ? (
              <div className="flex flex-col gap-1">
                <h3 className="text-section">Your Description</h3>
                <p className="text-body break-words whitespace-pre-wrap text-label-2">
                  {look.userPrompt}
                </p>
              </div>
            ) : null}
            {look && look.references.length > 0 ? (
              <div className="flex flex-col gap-2">
                <h3 className="text-section">Your Photos</h3>
                <ReferenceThumbs references={look.references} designer={designer} />
              </div>
            ) : null}
            <AnswerList title="Your Answers" rows={answers} />
            <AnswerList title="Your Answers to the Designer" rows={clarify} />
            {look?.spec?.summary ? (
              <div className="flex flex-col gap-1">
                <h3 className="text-section">The Designer’s Summary</h3>
                <p className="text-body text-pretty break-words text-label-2">
                  {look.spec.summary}
                </p>
              </div>
            ) : null}
          </div>
        }
      />
    </div>
  );
}
