"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { fileSrc } from "@/lib/file-src";
import { stageHref } from "@/lib/stages";
import type { FixSelection } from "@/server/damis";
import type { ClientReviewOption } from "@/lib/review-option";
import {
  Button,
  cn,
  FocusLayout,
  PageHeader,
  SelectRow,
  Skeleton,
  stagger,
  StatusDot,
  StatusLine,
  StoredImage,
  SwapFade,
  type StatusTone,
} from "@/ui";
import { assetHref, type AssetKindKey } from "../../../_lib/asset-kinds";
import { reviewSheetAction } from "../../assets/[assetId]/actions";
import { PackGallery } from "../../assets/[assetId]/_components/pack-gallery";
import { FitToImage } from "../../assets/[assetId]/_components/shared";
import { SheetChangesPanel } from "../../assets/[assetId]/_components/sheet-changes-panel";
import {
  CHARACTER_SHEET_WORDS,
  DesignChangeNotice,
  DetailFrames,
} from "../../assets/[assetId]/_components/stage-panels";
import type { PackKind, SheetCatalogInfo } from "../../assets/[assetId]/_lib/sheet-review";
import { ContinueToProduction } from "../../_components/continue-to-production";
import { DrawnTick } from "../../_components/drawn-tick";
import { MarkLayer, useMarking } from "../../_components/mark-layer";
import { FILL_PAGE, PICTURE_MAX_H } from "../../_lib/fill";
import { loadReviewSheetAction, requestSheetChangesAction, type ReviewSheet } from "../actions";
import { reviewPicture } from "../_lib/review-sheet";
import { DesignRoutePanel } from "./design-route-panel";

/** `accepted` green, `todo` waits for the user (amber), `back` is being built again (grey). */
export type ReviewStatus = "accepted" | "todo" | "back";

export interface ReviewItem {
  id: string;
  name: string;
  kind: AssetKindKey;
  /** The category's name: "Characters". */
  group: string;
  status: ReviewStatus;
  /** A location pack or prop sheet: reviewed view by view and locked on the asset's page. */
  pack: boolean;
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

/** The status of a list row: a pack waiting for the user is reviewed and locked, not accepted. */
const rowWords = (item: ReviewItem) =>
  item.pack && item.status === "todo" ? "To review and lock" : WORDS[item.status];

/** The review's own heading, for the request-changes panel. */
function PanelHeading({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <h2 id={id} className={className}>
      {children}
    </h2>
  );
}

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
  characterCatalog,
  packRoutes,
  maxNote,
  moved,
}: {
  projectId: string;
  items: ReviewItem[];
  initialId: string | null;
  initialSheet: ReviewSheet | null;
  notReady: number;
  /** The character sheet maker's catalog (characters' sheets are sent back with it). */
  characterCatalog: SheetCatalogInfo;
  /** The design route of each pack kind (a locked pack goes back to its design step). */
  packRoutes: Record<PackKind, ClientReviewOption | null>;
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
  // A refused design change opens the panel on the design step, with the request written.
  const [designText, setDesignText] = useState<string | null>(null);
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
        const picture = result.data ? reviewPicture(result.data) : null;
        if (picture) new Image().src = fileSrc(picture);
      });
    }
  }, [items, index]);

  function show(id: string) {
    if (id === current?.id) return;
    setSelected(id);
    setAsking(false);
    setDesignText(null);
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
    setDesignText(null);
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

  function sendBack(input: { selections: FixSelection[]; note: string }) {
    if (!current || !sheet) return;
    setPanelError(null);
    startSending(async () => {
      const result = await requestSheetChangesAction(projectId, sheet.sheetId, input);
      if (!result.ok) {
        setPanelError(result.error);
        return;
      }
      decided("back");
    });
  }

  function cancel() {
    marking.clear();
    setAsking(false);
    setDesignText(null);
    setPanelError(null);
  }

  const picture = sheet ? reviewPicture(sheet) : null;
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
                        <span className="sr-only">{rowWords(item)}</span>
                      </span>
                    ) : item.status === "back" ? (
                      <span>{rowWords(item)}</span>
                    ) : (
                      <span className="flex items-center">
                        <StatusDot tone={TONES[item.status]} />
                        <span className="sr-only">{rowWords(item)}</span>
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
                {picture ? (
                  <StoredImage
                    ref={imageRef}
                    src={fileSrc(picture)}
                    loading="eager"
                    alt={
                      sheet?.kind === "pack"
                        ? sheet.contactFileId
                          ? `Contact sheet of ${current.name}`
                          : `${current.name}, Hero`
                        : `Reference sheet of ${current.name}`
                    }
                    className="absolute inset-0 size-full object-contain"
                  />
                ) : current.status === "back" || sheet === null || (sheet && !picture) ? (
                  <div className="flex size-full items-center justify-center p-6 text-center text-meta text-label-2">
                    {current.status === "back"
                      ? "A new sheet is being built"
                      : sheet
                        ? "No view is made yet"
                        : "No sheet to show"}
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
                {sheet?.kind === "character" && asking ? (
                  <FitToImage imageRef={imageRef}>
                    <MarkLayer marking={marking} subject="sheet" disabled={sending} />
                  </FitToImage>
                ) : null}
              </div>

              {asking && sheet?.kind === "character" ? (
                <SheetChangesPanel
                  catalog={characterCatalog}
                  cells={sheet.cells}
                  words={CHARACTER_SHEET_WORDS}
                  initialDesignText={designText}
                  rejectedInARow={sheet.rejectedInARow}
                  maxNote={maxNote}
                  sending={sending}
                  serverError={panelError}
                  price={null}
                  priceAction="sheet"
                  balance={0}
                  marking={marking}
                  markSubject="sheet"
                  headingAs={PanelHeading}
                  onSubmit={sendBack}
                  onReroll={(code) => sendBack({ selections: [{ code }], note: "" })}
                  onCancel={cancel}
                />
              ) : asking && sheet?.kind === "pack" ? (
                <DesignRoutePanel
                  kind={sheet.pack}
                  route={packRoutes[sheet.pack]}
                  maxText={maxNote}
                  sending={sending}
                  serverError={panelError}
                  onSubmit={sendBack}
                  onCancel={cancel}
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
                      {current.status !== "back" &&
                      sheet &&
                      !(sheet.kind === "pack" && sheet.status === "in_review") ? (
                        <Button
                          variant="outlined"
                          size="large"
                          disabled={accepting}
                          onClick={() => setAsking(true)}
                        >
                          Send Back
                        </Button>
                      ) : null}
                      {sheet?.kind === "pack" && sheet.status === "in_review" ? (
                        <Button
                          variant="primary"
                          size="large"
                          render={<Link href={assetHref(projectId, current.id)} />}
                          className="max-w-full"
                        >
                          Review and Lock
                        </Button>
                      ) : null}
                      {current.status === "todo" && sheet?.kind === "character" ? (
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
                  {sheet?.kind === "character" ? (
                    <>
                      <DesignChangeNotice
                        requests={sheet.designChanges}
                        message={characterCatalog.designChangeMessage}
                        disabled={accepting || sending}
                        onChange={(text) => {
                          marking.clear();
                          setDesignText(text);
                          setAsking(true);
                        }}
                      />
                      <DetailFrames cells={sheet.cells} />
                    </>
                  ) : null}
                  {sheet?.kind === "pack" ? (
                    <div className="flex flex-col gap-4">
                      <p className="max-w-(--measure) text-secondary text-pretty text-label-2">
                        {sheet.status === "in_review"
                          ? `${current.name}’s views are approved one by one on its page, then locked.`
                          : "Locked with these approved views."}
                      </p>
                      <PackGallery pictures={sheet.pictures} assetName={current.name} />
                    </div>
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
