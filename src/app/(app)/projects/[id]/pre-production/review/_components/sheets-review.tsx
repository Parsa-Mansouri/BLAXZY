"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { fileSrc } from "@/lib/file-src";
import { stageHref } from "@/lib/stages";
import {
  Button,
  FocusLayout,
  PageHeader,
  SelectRow,
  Skeleton,
  StatusDot,
  StatusLine,
  SwapFade,
  cn,
  stagger,
  type StatusTone,
} from "@/ui";
import { refreshCredits } from "../../../../../_lib/credits";
import { assetHref, type AssetKindKey } from "../../../_lib/asset-kinds";
import { reviewSheetAction } from "../../assets/[assetId]/actions";
import { FitToImage, type IssueChoice } from "../../assets/[assetId]/_components/shared";
import { ContinueToProduction } from "../../_components/continue-to-production";
import { DrawnTick } from "../../_components/drawn-tick";
import { MarkLayer, useMarking } from "../../_components/mark-layer";
import { RequestChangesPanel } from "../../_components/request-changes-panel";
import { FILL_PAGE, PICTURE_MAX_H } from "../../_lib/fill";
import { loadReviewSheetAction, requestSheetChangesAction, type ReviewSheet } from "../actions";

/** `accepted` green, `todo` waits for the user (amber), `back` is being built again (grey). */
export type ReviewStatus = "accepted" | "todo" | "back";

export interface ReviewItem {
  id: string;
  name: string;
  kind: AssetKindKey;
  /** The category's name: "Characters". */
  group: string;
  status: ReviewStatus;
}

const TONES: Record<ReviewStatus, StatusTone> = {
  accepted: "done",
  todo: "waiting",
  back: "working",
};

const WORDS: Record<ReviewStatus, string> = {
  accepted: "Accepted",
  todo: "To accept",
  back: "Sent back for changes",
};

/** The sheet of an asset, or null when it has none to show. Missing key: not read yet. */
type Loaded = ReviewSheet | null;

/** "2 to accept · 1 sent back": what is left, never "x of y". */
function leftWords(
  todo: number,
  back: number,
  notReady: number,
): { text: string; tone: StatusTone } {
  const parts: string[] = [];
  if (todo > 0) parts.push(`${todo} to accept`);
  if (back > 0) parts.push(`${back} sent back`);
  if (notReady > 0) parts.push(`${notReady} not ready yet`);
  if (parts.length === 0) return { text: "Every sheet is accepted", tone: "done" };
  return { text: parts.join(" · "), tone: todo > 0 ? "waiting" : "working" };
}

/**
 * Every sheet in one place: the list on the left picks the sheet shown on the right. Accept a
 * sheet waiting for review, or send any sheet back with what should change. Nothing forces an
 * order; after a decision the next sheet waiting for the user is shown.
 */
export function SheetsReview({
  projectId,
  items: initialItems,
  initialId,
  initialSheet,
  notReady,
  issues,
  maxNote,
  moved,
}: {
  projectId: string;
  items: ReviewItem[];
  initialId: string | null;
  initialSheet: ReviewSheet | null;
  notReady: number;
  /** The sheet issues that apply to each kind of asset. */
  issues: Partial<Record<AssetKindKey, IssueChoice[]>>;
  maxNote: number;
  /** The project has moved on to Production already. */
  moved: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [selected, setSelected] = useState(initialId);
  const [sheets, setSheets] = useState<Record<string, Loaded>>(
    initialId && initialSheet ? { [initialId]: initialSheet } : {},
  );
  const requested = useRef(new Set<string>(initialId && initialSheet ? [initialId] : []));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [accepting, startAccepting] = useTransition();
  const [sending, startSending] = useTransition();
  const marking = useMarking();
  const imageRef = useRef<HTMLImageElement>(null);

  const index = Math.max(
    0,
    items.findIndex((i) => i.id === selected),
  );
  const current = items[index] ?? null;
  const sheet = current ? sheets[current.id] : undefined;

  // Read the sheet on screen and the one after it, so moving on is instant.
  useEffect(() => {
    for (const item of [items[index], items[index + 1]]) {
      if (!item || item.status === "back" || requested.current.has(item.id)) continue;
      requested.current.add(item.id);
      void loadReviewSheetAction(item.id).then((result) => {
        if (!result.ok) {
          requested.current.delete(item.id);
          setLoadError(result.error);
          return;
        }
        setLoadError(null);
        setSheets((map) => ({ ...map, [item.id]: result.data }));
        if (result.data) new Image().src = fileSrc(result.data.fileId);
      });
    }
  }, [items, index]);

  function show(id: string) {
    if (id === current?.id) return;
    setSelected(id);
    setAsking(false);
    marking.clear();
    setError(null);
    setPanelError(null);
  }

  // Arrow keys move through the list, unless a field or a dialog has the keyboard.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (asking || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return;
      }
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (step === 0) return;
      const next = items[index + step];
      if (next) {
        setSelected(next.id);
        setError(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [asking, items, index]);

  /** Marks the current item and shows the next one still waiting for the user. */
  function decided(status: ReviewStatus) {
    if (!current) return;
    const nextItems = items.map((i) => (i.id === current.id ? { ...i, status } : i));
    setItems(nextItems);
    setSheets((map) => {
      const rest = { ...map };
      if (status === "back") rest[current.id] = null;
      return rest;
    });
    setAsking(false);
    marking.clear();
    for (let k = 1; k <= nextItems.length; k++) {
      const candidate = nextItems[(index + k) % nextItems.length];
      if (candidate.status === "todo") {
        setSelected(candidate.id);
        return;
      }
    }
  }

  function accept() {
    if (!current || !sheet) return;
    setError(null);
    startAccepting(async () => {
      const result = await reviewSheetAction(projectId, sheet.sheetId, { decision: "accepted" });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      decided("accepted");
    });
  }

  function sendBack(input: { issueCodes: string[]; note: string }) {
    if (!current || !sheet) return;
    setPanelError(null);
    startSending(async () => {
      const result = await requestSheetChangesAction(sheet.sheetId, input);
      if (!result.ok) {
        setPanelError(result.error);
        return;
      }
      refreshCredits();
      decided("back");
    });
  }

  const todo = items.filter((i) => i.status === "todo").length;
  const back = items.filter((i) => i.status === "back").length;
  const left = leftWords(todo, back, notReady);
  const allAccepted = todo === 0 && back === 0 && notReady === 0;

  const groups: { label: string; rows: { item: ReviewItem; i: number }[] }[] = [];
  items.forEach((item, i) => {
    const group = groups.find((g) => g.label === item.group);
    if (group) group.rows.push({ item, i });
    else groups.push({ label: item.group, rows: [{ item, i }] });
  });

  return (
    <div className={FILL_PAGE}>
      <PageHeader
        title="Review Sheets"
        description={
          <StatusLine tone={left.tone} className="tabular-nums">
            <span aria-live="polite">{left.text}</span>
          </StatusLine>
        }
        actions={
          moved ? (
            <Button
              variant="primary"
              size="large"
              render={<Link href={stageHref(projectId, "production")} />}
            >
              Continue to Production
            </Button>
          ) : (
            <ContinueToProduction projectId={projectId} disabled={!allAccepted} />
          )
        }
      />

      {items.length === 0 ? (
        <div className="flex max-w-(--measure) in-2 flex-col gap-2">
          <h2 className="text-heading-sm text-balance">No sheets to review yet</h2>
          <p className="text-body text-pretty text-label-2">
            A sheet appears here once its image is accepted.
          </p>
        </div>
      ) : (
        <FocusLayout
          listLabel="Sheets"
          fill
          list={groups.map((group) => (
            <div key={group.label} className="flex flex-col gap-0.5 not-first:mt-8">
              <h3 className="px-3.5 pb-1.5 text-meta text-label-2">{group.label}</h3>
              {group.rows.map(({ item, i }) => (
                <SelectRow
                  key={item.id}
                  size="regular"
                  label={item.name}
                  active={item.id === current?.id}
                  onClick={() => show(item.id)}
                  trailing={
                    item.status === "accepted" ? (
                      <span className="flex text-done">
                        <DrawnTick />
                        <span className="sr-only">{WORDS.accepted}</span>
                      </span>
                    ) : item.status === "back" ? (
                      <span>{WORDS.back}</span>
                    ) : (
                      <span className="flex items-center">
                        <StatusDot tone={TONES[item.status]} />
                        <span className="sr-only">{WORDS[item.status]}</span>
                      </span>
                    )
                  }
                  className="enter"
                  style={stagger(Math.min(i, 12))}
                />
              ))}
            </div>
          ))}
        >
          {current ? (
            <SwapFade swapKey={current.id} as="article" className="flex flex-col gap-6">
              <div
                className={cn(
                  "relative aspect-video w-full overflow-hidden rounded-card bg-elevated",
                  PICTURE_MAX_H,
                )}
              >
                {sheet ? (
                  // eslint-disable-next-line @next/next/no-img-element -- user media from object storage, sized by the frame
                  <img
                    ref={imageRef}
                    src={fileSrc(sheet.fileId)}
                    alt={`Reference sheet of ${current.name}`}
                    decoding="async"
                    className="absolute inset-0 size-full object-contain"
                  />
                ) : current.status === "back" || sheet === null ? (
                  <div className="flex size-full items-center justify-center p-6 text-center text-meta text-label-2">
                    {current.status === "back" ? "A new sheet is being built" : "No sheet to show"}
                  </div>
                ) : loadError ? (
                  <p
                    role="alert"
                    className="flex size-full items-center justify-center p-6 text-secondary text-red"
                  >
                    {loadError}
                  </p>
                ) : (
                  <Skeleton className="size-full rounded-none" />
                )}
                {sheet && asking ? (
                  <FitToImage imageRef={imageRef}>
                    <MarkLayer marking={marking} subject="sheet" disabled={sending} />
                  </FitToImage>
                ) : null}
              </div>

              {asking ? (
                <RequestChangesPanel
                  subject="sheet"
                  issues={issues[current.kind] ?? []}
                  maxNote={maxNote}
                  sending={sending}
                  serverError={panelError}
                  marking={marking}
                  onSubmit={sendBack}
                  onCancel={() => {
                    marking.clear();
                    setAsking(false);
                    setPanelError(null);
                  }}
                />
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
                    <div className="flex min-w-0 flex-col gap-1">
                      <h2 className="text-heading-sm text-balance break-words">
                        {current.status === "todo" ? `Is this ${current.name}?` : current.name}
                      </h2>
                      {current.status === "todo" ? null : (
                        <StatusLine tone={TONES[current.status]}>
                          {WORDS[current.status]}
                        </StatusLine>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {current.status !== "back" && sheet ? (
                        <Button
                          variant="outlined"
                          size="large"
                          disabled={accepting}
                          onClick={() => setAsking(true)}
                        >
                          Send Back
                        </Button>
                      ) : null}
                      {current.status === "todo" && sheet ? (
                        <Button variant="primary" size="large" loading={accepting} onClick={accept}>
                          Accept
                        </Button>
                      ) : null}
                      {current.status === "back" || sheet === null ? (
                        <Button
                          variant="outlined"
                          size="large"
                          render={<Link href={assetHref(projectId, current.id)} />}
                          className="max-w-full"
                        >
                          <span className="truncate">Open {current.name}</span>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {current.status === "back" ? (
                    <p className="text-secondary text-pretty text-label-2">
                      It returns here when the new one is made.
                    </p>
                  ) : null}
                  {error ? (
                    <p role="alert" className="text-secondary text-red">
                      {error}
                    </p>
                  ) : null}
                </>
              )}
            </SwapFade>
          ) : null}
        </FocusLayout>
      )}
    </div>
  );
}
