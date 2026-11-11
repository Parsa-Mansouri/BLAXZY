"use client";

import { AudioLines, ImageOff } from "lucide-react";
import { fileSrc } from "@/lib/file-src";
import { Button, cn } from "@/ui";
import { lookOrigin, versionStatusLabel, type HistoryItem } from "../_lib/asset-view";
import { StageHeading } from "./asset-context";
import { StageLayout } from "./stage-panels";
import { Artwork, MissingImage, When, type GuidedQuestion, type Orientation } from "./shared";
import { AudioPlayer } from "./voice";

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
    <section
      aria-labelledby="history-title"
      className={cn("flex in-3 flex-col gap-4 pt-8 hairline-t", className)}
    >
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
                        ? "ring-2 ring-accent ring-offset-2 ring-offset-ground"
                        : "group-hover:ring-1 group-hover:ring-separator-opaque",
                    )}
                  >
                    {voice ? (
                      <AudioLines aria-hidden="true" className="size-5 text-label-2" />
                    ) : fileId ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={fileSrc(fileId)}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        draggable={false}
                        className="absolute inset-0 size-full object-contain"
                      />
                    ) : item.version.status === "failed" ? (
                      <ImageOff aria-hidden="true" className="size-5 text-label-3" />
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
  onBack,
}: {
  item: HistoryItem;
  assetName: string;
  voice: boolean;
  orientation: Orientation;
  questions: GuidedQuestion[];
  onBack: () => void;
}) {
  const title = itemTitle(item, voice);
  const { version } = item;
  const look = item.kind === "look" ? item.version : null;
  const answers = look?.guidedAnswers
    ? questions.flatMap((q) => {
        const value = look.guidedAnswers?.[q.id];
        return value ? [{ label: q.label, value }] : [];
      })
    : [];

  const bar = (
    <div className="flex in-2 flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-tile bg-elevated px-4 py-3">
      <p className="text-body text-label">
        {title} · {versionStatusLabel(version.status)}
      </p>
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
            shape={item.kind === "sheet" ? "sheet" : orientation}
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
                {look ? `${lookOrigin(look)} · ` : ""}
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
            {answers.length > 0 ? (
              <div className="flex flex-col gap-2">
                <h3 className="text-section">Your Answers</h3>
                <dl className="flex flex-col gap-2">
                  {answers.map((a) => (
                    <div key={a.label} className="flex flex-col">
                      <dt className="text-meta text-label-2">{a.label}</dt>
                      <dd className="text-body break-words text-label">{a.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
          </div>
        }
      />
    </div>
  );
}
