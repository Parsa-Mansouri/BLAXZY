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
}: {
  items: HistoryItem[];
  voice: boolean;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}) {
  return (
    <section aria-labelledby="history-title" className="flex flex-col gap-3 pt-8 hairline-t">
      <div className="flex items-baseline gap-2.5">
        <h3 id="history-title" className="text-title-2">
          History
        </h3>
        {items.length > 0 ? (
          <span className="text-callout text-label-2 tabular-nums">{items.length}</span>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="text-body text-label-2">
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
                  className="group flex w-32 flex-col gap-1.5 rounded-artwork text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
                >
                  <span
                    className={cn(
                      "relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-field transition-[box-shadow] duration-(--dur-fast)",
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
                    <span className="text-callout font-medium text-label">
                      {itemTitle(item, voice)}
                    </span>
                    <span className="text-callout text-label-2">
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
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-group bg-elevated px-4 py-3">
      <p className="text-body text-label">
        {title} · {versionStatusLabel(version.status)}.{" "}
        <span className="text-label-2">Earlier versions are read-only.</span>
      </p>
      <Button variant="plain" onClick={onBack} className="-mr-2">
        Back to Current
      </Button>
    </div>
  );

  if (voice && version.fileId) {
    return (
      <div className="flex flex-col gap-6">
        {bar}
        <AudioPlayer fileId={version.fileId} label={`${assetName} ${title}`} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
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
              <StageHeading className="text-title-2">{title}</StageHeading>
              <p className="text-callout text-label-2">
                {look ? `${lookOrigin(look)} · ` : ""}
                <When date={version.createdAt} />
              </p>
              {version.isSample ? (
                <p className="text-callout text-label-2">Sample output from the test generator.</p>
              ) : null}
            </div>
            {version.failure ? (
              <p className="text-reading text-pretty text-label-2">{version.failure}</p>
            ) : null}
            {look?.userPrompt ? (
              <div className="flex flex-col gap-1">
                <h4 className="text-headline">Your Description</h4>
                <p className="text-reading break-words whitespace-pre-wrap text-label-2">
                  {look.userPrompt}
                </p>
              </div>
            ) : null}
            {answers.length > 0 ? (
              <div className="flex flex-col gap-2">
                <h4 className="text-headline">Your Answers</h4>
                <dl className="flex flex-col gap-2">
                  {answers.map((a) => (
                    <div key={a.label} className="flex flex-col">
                      <dt className="text-callout text-label-2">{a.label}</dt>
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
