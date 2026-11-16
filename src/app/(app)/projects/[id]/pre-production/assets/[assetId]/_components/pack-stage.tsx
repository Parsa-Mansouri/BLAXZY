"use client";

import { useSpend, useSpendTransition } from "@/app/(app)/_components/spend-confirm";
import { useState, useTransition, type ReactNode } from "react";
import type { DnaCard, LookView, PackLockGate, PackView, SheetView } from "@/server/assets";
import { Button, ProgressBar, StatusDot, SwapFade, cn, type StatusTone } from "@/ui";
import { lookShape } from "../_lib/asset-view";
import {
  firstToReview,
  lockMissingWords,
  packPictures,
  reviewChecks,
  splitSheetWarnings,
  viewState,
  viewStateWords,
  type PackKind,
  type SheetCatalogInfo,
  type ViewState,
} from "../_lib/sheet-review";
import {
  lockSheetAction,
  retrySheetViewAction,
  reviewSheetViewAction,
  type ViewReviewInput,
} from "../actions";
import { DrawnTick } from "../../../_components/drawn-tick";
import { MarkLayer, useMarking } from "../../../_components/mark-layer";
import { StageHeading, useAssetScreen } from "./asset-context";
import { Caps, CheckMark } from "./desk";
import { DnaCardView } from "./dna-card";
import { PackGallery } from "./pack-gallery";
import { Artwork, PriceLine, type Orientation } from "./shared";
import { SheetChangesPanel, type SheetChangesWords } from "./sheet-changes-panel";
import { ReadyStage } from "./stages/ready-stage";
import { DesignChangeNotice, SheetNotes } from "./stages/sheet-review-stage";
import { SAMPLE_OUTPUT, StageLayout, VersionLine } from "./stages/stage-layout";
import { ErrorLine } from "@/app/(app)/_components/values";
import { canAfford } from "@/app/(app)/_lib/format";

/** A location pack's or prop sheet's state, from `getAssetDetail`. */
export interface PackInfo {
  kind: PackKind;
  views: PackView[];
  lockGate: PackLockGate | null;
  dnaCard: DnaCard | null;
}

const HERO = "hero";

const LOCK_LABEL: Record<PackKind, string> = {
  location: "Lock This Location",
  prop: "Lock This Prop",
};

const VIEW_WORDS: Record<PackKind, SheetChangesWords> = {
  location: {
    subject: "view",
    placeholder: "Show more of the floor, and make the window on the left bigger.",
    designHint:
      "The location goes back to its design step with your words. Once you accept the new Hero, its views are planned again.",
  },
  prop: {
    subject: "view",
    placeholder: "Show the clasp more clearly, and keep the same lighting.",
    designHint:
      "The prop goes back to its design step with your words. Once you accept the new design, its views are planned again.",
  },
};

const STATE_TONES: Record<ViewState, StatusTone> = {
  review: "waiting",
  approved: "done",
  making: "working",
  waiting: "none",
  writing: "working",
  failed: "failed",
  set_aside: "none",
};

/** A checklist the reviewer ticks while looking at the view (an aid: nothing is sent). */
function Checklist({
  title,
  items,
  ticked,
  onToggle,
}: {
  title: string;
  items: readonly string[];
  ticked: readonly string[];
  onToggle: (item: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <Caps as="h3">{title}</Caps>
      <ul className="flex flex-col">
        {items.map((item) => {
          const on = ticked.includes(item);
          return (
            <li key={item}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => onToggle(item)}
                className="flex w-full items-start gap-3 rounded-item py-1.5 text-left focus-ring"
              >
                <span className="pt-0.5">
                  <CheckMark on={on} />
                </span>
                <span
                  className={cn(
                    "text-secondary text-pretty break-words transition-colors",
                    on ? "text-label" : "text-label-2",
                  )}
                >
                  {item}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The parts a view proposes that the design does not show: approved with the view. */
function Hypotheses({
  items,
  approved,
  disabled,
  onApprove,
  onChangeDesign,
}: {
  items: readonly string[];
  approved: boolean;
  disabled: boolean;
  onApprove: (on: boolean) => void;
  onChangeDesign: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <section
      aria-label="Proposed parts"
      className="flex flex-col gap-3 rounded-tile border border-brand/40 bg-brand/5 p-4"
    >
      <Caps as="h3">Proposed, not in the design</Caps>
      <ul className="flex list-disc flex-col gap-1.5 pl-5">
        {items.map((item) => (
          <li key={item} className="text-body text-pretty break-words text-label">
            {item}
          </li>
        ))}
      </ul>
      <p className="text-secondary text-pretty text-label-2">
        This view shows parts the design never defined. Approving the view makes them part of the
        design from now on.
      </p>
      <button
        type="button"
        role="checkbox"
        aria-checked={approved}
        disabled={disabled}
        onClick={() => onApprove(!approved)}
        className="flex items-center gap-3 rounded-item text-left focus-ring"
      >
        <CheckMark on={approved} />
        <span className="text-body text-label">I approve these parts</span>
      </button>
      <Button
        variant="plain"
        className="self-start pl-0"
        disabled={disabled}
        onClick={onChangeDesign}
      >
        Not like this: change the design
      </Button>
    </section>
  );
}

/** One view (or the Hero) large, with what can be done with it. */
export function PackReviewStage({
  projectId,
  assetId,
  assetName,
  pack,
  sheet,
  hero,
  catalog,
  orientation,
  maxNote,
  viewPrice,
  balance,
  initialAsking = false,
}: {
  projectId: string;
  assetId: string;
  assetName: string;
  pack: PackInfo;
  sheet: SheetView;
  /** The accepted look: the pack's Hero. */
  hero: LookView | null;
  /** The pack's per-view catalog. */
  catalog: SheetCatalogInfo;
  orientation: Orientation;
  maxNote: number;
  viewPrice: number | null;
  balance: number;
  initialAsking?: boolean;
}) {
  const { moveOn, refresh } = useAssetScreen();
  const spend = useSpend();
  const { kind, views } = pack;
  const marking = useMarking();
  // The view on screen, by its stable view id (versions change ids); null follows the work.
  const [picked, setPicked] = useState<string | null>(null);
  const auto = firstToReview(views)?.viewId ?? HERO;
  const currentKey =
    picked && (picked === HERO || views.some((v) => v.viewId === picked)) ? picked : auto;
  const view = currentKey === HERO ? null : (views.find((v) => v.viewId === currentKey) ?? null);
  const state = view ? viewState(view) : null;

  const [asking, setAsking] = useState(initialAsking && state === "review");
  const [designText, setDesignText] = useState<string | null>(null);
  const [approvedParts, setApprovedParts] = useState<Record<string, boolean>>({});
  const [ticks, setTicks] = useState<Record<string, string[]>>({});
  const [errors, setErrors] = useState<{ decision?: string; panel?: string; lock?: string }>({});
  const [accepting, startAccepting] = useSpendTransition();
  const [sending, startSending] = useSpendTransition();
  const [locking, startLocking] = useTransition();
  const [retrying, startRetrying] = useSpendTransition();
  const busy = accepting || sending || locking || retrying;

  const gate = pack.lockGate;
  const lockReady = gate?.canLock === true;
  const missing = gate ? lockMissingWords(gate.missing, views) : [];
  const heroInfo = hero ? { fileId: hero.fileId, aspectRatio: hero.aspectRatio } : null;
  const pictures = packPictures(heroInfo, views, ["in_review", "accepted"]);
  const toCome = views.filter((v) => !v.fileId || v.status === "planned" || v.status === "pending");
  const fixes = sheet.spec?.appliedFixes ?? [];

  function select(key: string) {
    setPicked(key);
    setAsking(false);
    setDesignText(null);
    marking.clear();
    setErrors({});
  }

  function openPanel(text: string | null) {
    marking.clear();
    setDesignText(text);
    setErrors({});
    setAsking(true);
  }

  function closePanel() {
    marking.clear();
    setDesignText(null);
    setErrors((e) => ({ ...e, panel: undefined }));
    setAsking(false);
  }

  function review(target: PackView, input: ViewReviewInput, words: string) {
    const start = input.decision === "accepted" ? startAccepting : startSending;
    const place = input.decision === "accepted" ? "decision" : "panel";
    setErrors({});
    start(async () => {
      const result = await spend.run({
        target: {
          kind: "asset_review",
          assetId,
          subject: "view",
          decision: input.decision,
          designChange: input.designChange,
        },
        title: "Make a new version of this view?",
        confirmLabel: "Make it",
        submit: (expectedCredits) =>
          reviewSheetViewAction(projectId, target.id, input, assetId, expectedCredits),
      });
      if (result === null) return;
      if (!result.ok) {
        setErrors({ [place]: result.error });
        return;
      }
      setAsking(false);
      setDesignText(null);
      marking.clear();
      // After an approval, the next view to review comes up.
      if (input.decision === "accepted") setPicked(null);
      moveOn(result.data, words);
    });
  }

  function lock() {
    if (!lockReady) return;
    setErrors({});
    startLocking(async () => {
      const result = await lockSheetAction(projectId, sheet.id, assetId);
      if (!result.ok) {
        setErrors({ lock: result.error });
        return;
      }
      moveOn(result.data, `${assetName} is locked`);
    });
  }

  function retry(target: PackView) {
    setErrors({});
    startRetrying(async () => {
      const result = await spend.run({
        target: { kind: "asset", assetId, step: "sheet" },
        title: "Try this view again?",
        confirmLabel: "Try again",
        submit: (expectedCredits) => retrySheetViewAction(projectId, target.id, expectedCredits),
      });
      if (result === null) return;
      if (!result.ok) {
        setErrors({ decision: result.error });
        return;
      }
      refresh();
    });
  }

  /* The picture: the view, or the Hero while the view has none (never an empty frame). */
  let frame: ReactNode = null;
  if (view?.fileId) {
    frame = (
      <Artwork
        fileId={view.fileId}
        alt={`${assetName}, ${view.label}`}
        shape={view.aspectRatio}
        overlay={asking ? <MarkLayer marking={marking} subject="image" disabled={sending} /> : null}
      />
    );
  } else if (hero?.fileId) {
    frame = (
      <figure className="flex flex-col gap-2">
        <Artwork
          fileId={hero.fileId}
          alt={`${assetName}, Hero`}
          shape={lookShape(hero.aspectRatio, orientation)}
          dimmed={view !== null}
        />
        <figcaption className="text-meta text-label-2">
          {view
            ? `The Hero, shown until ${view.label} is made.`
            : "The approved Hero. Every view is built from it and checked against it."}
        </figcaption>
      </figure>
    );
  }

  const primaryHere = !lockReady;

  function viewRail(v: PackView, s: ViewState): ReactNode {
    const warnings = splitSheetWarnings(v.warnings);
    const partsOk = approvedParts[v.id] === true;
    const ticked = ticks[v.id] ?? [];
    const toggleTick = (item: string) =>
      setTicks((t) => {
        const list = t[v.id] ?? [];
        return {
          ...t,
          [v.id]: list.includes(item) ? list.filter((i) => i !== item) : [...list, item],
        };
      });
    const acceptReason =
      v.newHypotheses.length > 0 && !partsOk
        ? "Approve the proposed parts first, or change the design."
        : null;
    return (
      <>
        <div className="flex flex-col gap-3">
          <StageHeading className="text-heading text-balance break-words">{v.label}</StageHeading>
          {v.purpose ? (
            <p className="text-body text-pretty break-words text-label-2">{v.purpose}</p>
          ) : null}
          {v.fileId ? (
            <VersionLine
              label={`Version ${v.versionNumber}`}
              origin={
                v.editMode === "edit_previous_view"
                  ? "Edited from the last version"
                  : v.parentId
                    ? "Revised after review"
                    : undefined
              }
              date={v.createdAt}
            />
          ) : null}
          {v.isSample && v.fileId ? (
            <p className="text-meta text-label-2">{SAMPLE_OUTPUT}</p>
          ) : null}
        </div>

        {s === "review" ? (
          <>
            <Checklist
              title="Check that it shows"
              items={v.mustShow}
              ticked={ticked}
              onToggle={toggleTick}
            />
            <Checklist
              title={kind === "prop" ? "Quality checks" : "Also check"}
              items={reviewChecks(kind, v.reviewFocus)}
              ticked={ticked}
              onToggle={toggleTick}
            />
            {v.mustNotShow.length > 0 ? (
              <div className="flex flex-col gap-2">
                <Caps as="h3">Must not show</Caps>
                <ul className="flex list-disc flex-col gap-1 pl-5">
                  {v.mustNotShow.map((item) => (
                    <li key={item} className="text-secondary text-pretty text-label-2">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <Hypotheses
              items={v.newHypotheses}
              approved={partsOk}
              disabled={busy}
              onApprove={(on) => setApprovedParts((p) => ({ ...p, [v.id]: on }))}
              onChangeDesign={() =>
                openPanel(`Not as this view proposes: ${v.newHypotheses.join("; ")}. Instead: `)
              }
            />
            <DesignChangeNotice
              requests={warnings.designChanges}
              message={catalog.designChangeMessage}
              disabled={busy}
              onChange={(text) => openPanel(text)}
            />
            <SheetNotes
              warnings={warnings.others}
              appliedFixes={fixes.filter((f) => f.viewId === v.viewId)}
            />
            <div className="flex flex-col gap-3">
              <Button
                variant={primaryHere ? "primary" : "outlined"}
                size="large"
                loading={accepting}
                disabled={busy || acceptReason !== null}
                onClick={() =>
                  review(
                    v,
                    {
                      decision: "accepted",
                      ...(v.newHypotheses.length > 0 ? { hypothesesApproved: true } : {}),
                    },
                    `${v.label} approved`,
                  )
                }
              >
                Approve View
              </Button>
              {acceptReason ? (
                <p className="text-secondary text-pretty text-label-2">{acceptReason}</p>
              ) : null}
              <Button
                variant="outlined"
                size="large"
                disabled={busy}
                onClick={() => openPanel(null)}
              >
                Request Changes
              </Button>
              <ErrorLine>{errors.decision}</ErrorLine>
            </div>
          </>
        ) : s === "approved" ? (
          <p className="flex items-center gap-2 text-body text-done">
            <DrawnTick />
            Approved
          </p>
        ) : s === "making" || s === "writing" ? (
          <div className="flex flex-col gap-3">
            <ProgressBar value={null} aria-label={`Making ${v.label}`} />
            <p className="text-body text-pretty text-label-2">
              {s === "making"
                ? "This view is being made. It appears here to review when it is ready."
                : "This view starts by itself in a moment."}
            </p>
          </div>
        ) : s === "waiting" ? (
          <p className="text-body text-pretty text-label-2">
            {viewStateWords(v)}. It is made once{" "}
            {v.waitingFor.length === 1 ? "that view is" : "those views are"} approved, so it matches{" "}
            {v.waitingFor.length === 1 ? "it" : "them"}.
          </p>
        ) : s === "failed" ? (
          <div role="alert" className="flex flex-col gap-3">
            <p className="text-body text-pretty text-label-2">
              {v.failure ?? "Something went wrong while this view was being made."}
            </p>
            <Button
              variant={primaryHere ? "primary" : "outlined"}
              size="large"
              loading={retrying}
              disabled={busy || !canAfford(viewPrice, balance)}
              onClick={() => retry(v)}
              className="self-start"
            >
              Try Again
            </Button>
            <PriceLine price={viewPrice} balance={balance} action="view" />
            <ErrorLine>{errors.decision}</ErrorLine>
          </div>
        ) : (
          <p className="text-body text-pretty text-label-2">{viewStateWords(v)}.</p>
        )}
      </>
    );
  }

  const heroRail = (
    <div className="flex flex-col gap-3">
      <StageHeading className="text-heading text-balance break-words">
        {assetName}’s Hero
      </StageHeading>
      <p className="text-body text-pretty text-label-2">
        The approved design. Every view is built from it, and it is part of the{" "}
        {kind === "location" ? "pack" : "sheet"} as it is.
      </p>
      {hero ? (
        <VersionLine
          label={`Image ${hero.versionNumber}`}
          origin="Approved"
          date={hero.decidedAt ?? hero.createdAt}
        />
      ) : null}
      {firstToReview(views) ? null : toCome.length > 0 ? (
        <p className="text-secondary text-pretty text-label-2">
          The views appear below as they are made.
        </p>
      ) : null}
    </div>
  );

  const lockBlock = gate ? (
    <section
      aria-labelledby="lock-title"
      className="flex flex-col gap-3 border-t border-outline-quiet pt-6"
    >
      <h3 id="lock-title" className="text-section">
        {lockReady ? "Ready to lock" : "Before it locks"}
      </h3>
      {lockReady ? (
        <p className="text-secondary text-pretty text-label-2">
          Locking keeps the approved views for every shot. Views not approved by then are set aside.
        </p>
      ) : (
        missing.map((line) => (
          <p key={line} className="text-secondary text-pretty text-label-2">
            {line}
          </p>
        ))
      )}
      <Button
        variant={lockReady ? "primary" : "dark"}
        size="large"
        loading={locking}
        disabled={!lockReady || busy}
        onClick={lock}
        className="self-start"
      >
        {LOCK_LABEL[kind]}
      </Button>
      <ErrorLine>{errors.lock}</ErrorLine>
    </section>
  ) : null;

  const rail = (
    <SwapFade
      swapKey={asking && view ? `asking:${view.id}` : `view:${currentKey}`}
      className="flex flex-col gap-8"
    >
      {asking && view ? (
        <SheetChangesPanel
          catalog={catalog}
          words={VIEW_WORDS[kind]}
          initialDesignText={designText}
          rejectedInARow={0}
          maxNote={maxNote}
          sending={sending}
          serverError={errors.panel ?? null}
          price={viewPrice}
          priceAction="view"
          balance={balance}
          marking={marking}
          markSubject="image"
          headingAs={StageHeading}
          onSubmit={(input) =>
            review(
              view,
              {
                decision: "rejected",
                ...(input.note ? { note: input.note } : {}),
                ...(input.designChange ? { designChange: true } : {}),
              },
              input.designChange
                ? `${assetName} goes back to its design`
                : `Making ${view.label} again`,
            )
          }
          onReroll={() =>
            review(view, { decision: "rejected", regenerate: true }, `Making ${view.label} again`)
          }
          onCancel={closePanel}
        />
      ) : (
        <>
          {view && state ? viewRail(view, state) : heroRail}
          {lockBlock}
        </>
      )}
    </SwapFade>
  );

  return (
    <div className="flex flex-col gap-14">
      {frame ? (
        <StageLayout frame={frame} rail={rail} />
      ) : (
        <div className="flex max-w-105 in-2 flex-col">{rail}</div>
      )}

      <section aria-labelledby="pack-title" className="flex in-3 flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h3 id="pack-title" className="text-section">
            {kind === "location" ? "The Pack" : "The Sheet"}
          </h3>
          <p className="max-w-(--measure) text-secondary text-pretty text-label-2">
            {kind === "location"
              ? `The views that keep ${assetName} the same from every angle. Choose one to review it.`
              : `The views that keep ${assetName} the same from every side. Choose one to review it.`}
          </p>
        </div>
        <PackGallery
          pictures={pictures}
          assetName={assetName}
          selectedKey={view ? view.id : HERO}
          onSelect={(key) =>
            select(key === HERO ? HERO : (views.find((v) => v.id === key)?.viewId ?? HERO))
          }
        />
        {toCome.length > 0 ? (
          <div className="flex flex-col gap-2">
            <Caps as="h4">Still to come</Caps>
            <ul className="flex flex-col border-t border-outline-quiet">
              {toCome.map((v) => {
                const s = viewState(v);
                const on = view?.id === v.id;
                return (
                  <li key={v.id} className="border-b border-outline-quiet">
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => select(v.viewId)}
                      className={cn(
                        "flex w-full flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-1 py-3 text-left focus-ring",
                        on ? "text-label" : "text-label-2 hover:text-label",
                      )}
                    >
                      <span className="text-body break-words">{v.label}</span>
                      <span className="flex items-center gap-2 text-secondary">
                        <StatusDot tone={STATE_TONES[s]} />
                        {viewStateWords(v)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </section>

      <div className="in-3">
        <DnaCardView kind={kind} card={pack.dnaCard} spec={sheet.spec} />
      </div>
    </div>
  );
}

/** A locked pack: the contact sheet (or the Hero while it is put together) and its views. */
export function PackReadyStage({
  projectId,
  assetId,
  assetName,
  pack,
  sheet,
  hero,
  orientation,
  initialConfirming = false,
}: {
  projectId: string;
  assetId: string;
  assetName: string;
  pack: PackInfo;
  sheet: SheetView | null;
  hero: LookView | null;
  orientation: Orientation;
  initialConfirming?: boolean;
}) {
  const { kind, views } = pack;
  const pictures = packPictures(
    hero ? { fileId: hero.fileId, aspectRatio: hero.aspectRatio } : null,
    views,
    ["accepted"],
  );
  // The contact sheet is stored a few seconds after the lock: the Hero stands in until then.
  const frame = sheet?.fileId ? (
    <figure className="flex flex-col gap-2">
      <Artwork fileId={sheet.fileId} alt={`${assetName}, contact sheet`} shape="sheet" />
      <figcaption className="text-meta text-label-2">
        The contact sheet: every approved view with the{" "}
        {kind === "prop" ? "DNA and scale cards" : "location’s DNA"}, for people to read.
      </figcaption>
    </figure>
  ) : hero?.fileId ? (
    <Artwork
      fileId={hero.fileId}
      alt={`${assetName}, Hero`}
      shape={lookShape(hero.aspectRatio, orientation)}
    />
  ) : null;
  return (
    <div className="flex flex-col gap-14">
      <ReadyStage
        projectId={projectId}
        assetId={assetId}
        assetName={assetName}
        sheet={sheet}
        look={sheet?.fileId ? hero : null}
        orientation={orientation}
        initialConfirming={initialConfirming}
        frame={frame}
        line={
          kind === "location"
            ? `This pack keeps ${assetName} the same from every angle.`
            : `These views keep ${assetName} the same from every side.`
        }
      />
      {pictures.length > 1 ? (
        <section aria-labelledby="approved-title" className="flex in-3 flex-col gap-5">
          <h3 id="approved-title" className="text-section">
            Approved Views
          </h3>
          <PackGallery pictures={pictures} assetName={assetName} />
        </section>
      ) : null}
      <div className="in-3">
        <DnaCardView kind={kind} card={pack.dnaCard} spec={sheet?.spec ?? null} />
      </div>
    </div>
  );
}
