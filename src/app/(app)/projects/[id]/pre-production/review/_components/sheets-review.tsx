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
import { assetHref, type AssetKindKey } from "../../../_lib/asset-kinds";
import { reviewSheetAction } from "../../assets/[assetId]/actions";
import type { IssueChoice } from "../../assets/[assetId]/_components/shared";
import { ContinueToProduction } from "../../_components/continue-to-production";
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
  issues: IssueChoice[];
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
        description="A last look at every sheet."
        actions={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <StatusLine as="span" tone={left.tone}>
              <span aria-live="polite">{left.text}</span>
            </StatusLine>
            {moved ? (
              <Button variant="primary" render={<Link href={stageHref(projectId, "production")} />}>
                Continue to Production
              </Button>
            ) : (
              <ContinueToProduction projectId={projectId} size="regular" disabled={!allAccepted} />
            )}
          </div>
        }
      />

      {items.length === 0 ? (
        <p className="max-w-(--measure) in-2 text-body text-label-2">
          No sheet is ready to look at yet. Sheets appear here once their images are accepted.
        </p>
      ) : (
        <FocusLayout
          listLabel="Sheets"
          fill
          list={groups.map((group) => (
            <div key={group.label} className="flex flex-col gap-0.5 not-first:mt-5">
              <div className="px-3.5 pb-1.5 text-meta text-label-2">{group.label}</div>
              {group.rows.map(({ item, i }) => (
                <SelectRow
                  key={item.id}
                  size="regular"
                  label={item.name}
                  active={item.id === current?.id}
                  onClick={() => show(item.id)}
                  trailing={
                    <span className="flex items-center gap-2">
                      {item.status === "back" ? <span>Sent back</span> : null}
                      <StatusDot tone={TONES[item.status]} className="size-2" />
                      <span className="sr-only">{WORDS[item.status]}</span>
                    </span>
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
                    src={fileSrc(sheet.fileId)}
                    alt={`Reference sheet of ${current.name}`}
                    decoding="async"
                    className="absolute inset-0 size-full object-contain"
                  />
                ) : current.status === "back" || sheet === null ? (
                  <div className="flex size-full items-center justify-center p-6 text-center text-meta text-label-3">
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
              </div>

              {asking ? (
                <RequestChangesPanel
                  subject="sheet"
                  issues={issues}
                  maxNote={maxNote}
                  sending={sending}
                  serverError={panelError}
                  onSubmit={sendBack}
                  onCancel={() => {
                    setAsking(false);
                    setPanelError(null);
                  }}
                />
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
                    <div className="flex min-w-0 flex-col gap-1">
                      <h2 className="text-heading-sm break-words">{current.name}</h2>
                      <StatusLine tone={TONES[current.status]}>
                        {current.group} · {WORDS[current.status]}
                      </StatusLine>
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
                        >
                          Open {current.name}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {current.status === "back" ? (
                    <p className="text-secondary text-label-2">
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
