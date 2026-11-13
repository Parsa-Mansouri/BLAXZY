"use client";

import { useAbortOnUnmount } from "@/app/(app)/_lib/use-abort-on-unmount";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ToolbarBack } from "@/app/(app)/projects/[id]/_components/project-chrome";
import { pollAsset } from "@/app/(app)/_lib/poll-client";
import { FAST_POLL_MS, SETTLED_POLL_MS, usePolling } from "@/app/(app)/_lib/use-polling";
import type { AssetStage } from "@/server/assets";
import { stageHref } from "@/lib/stages";
import { useToast } from "@/ui";
import { assetHref } from "../../../../_lib/asset-kinds";
import {
  acceptedLook,
  failedVersion,
  heldImage,
  historyItems,
  parentLook,
  versionsKey,
  type DetailVersions,
} from "../_lib/asset-view";
import type { DesignerInfo } from "../_lib/designer-view";
import { packWorking, sheetRejectedInARow, type SheetCatalogInfo } from "../_lib/sheet-review";
import type { AssetIntent } from "../_lib/intent";
import { FILL_PAGE } from "../../../_lib/fill";
import type { MoveOn } from "../actions";
import { AddImage, type AddMethod } from "./add-image";
import { AssetScreenProvider } from "./asset-context";
import { AssetHeader } from "./asset-header";
import { HistoryStrip, HistoryViewer } from "./history";
import { NeedsAnswerStage } from "./needs-answer";
import { PackReadyStage, PackReviewStage, type PackInfo } from "./pack-stage";
import { FailedStage } from "./stages/failed-stage";
import { LookReviewStage } from "./stages/look-review-stage";
import { ReadyStage } from "./stages/ready-stage";
import { SheetReviewStage } from "./stages/sheet-review-stage";
import { WaitingStage } from "./stages/waiting-stage";
import type { AssetInfo, GuidedQuestion, Limits, Orientation } from "./shared";

/** What the asset's designer said about its current design. */
export interface DesignState {
  /** A prop waiting for these locations' Heroes before it is designed (by name). */
  waitingFor: string[];
  /** Images sent back in a row since the last accepted one. */
  rejectedInARow: number;
  /** The look in review's critical inferred spec fields, checked before Accept. */
  toConfirm: string[];
}
import { VoiceStage } from "./voice";

export interface AssetScreenProps {
  projectId: string;
  asset: AssetInfo;
  kindName: string;
  category: { href: string; label: string };
  versions: DetailVersions;
  design: DesignState;
  /** The designer that draws the asset; null for voices. */
  designer: DesignerInfo | null;
  orientation: Orientation;
  prices: { look: number | null; sheet: number | null };
  balance: number;
  /** The guided questions still to ask (the designer's skip logic applied). */
  questions: GuidedQuestion[];
  /** The sheet maker's review catalog: the character sheet's, or a pack's per-view one. */
  sheetCatalog: SheetCatalogInfo | null;
  /** Locations and props: the pack's views, lock rules and DNA card; null for characters. */
  pack: PackInfo | null;
  limits: Limits;
  /** Where a card action asked the page to open (`?open=...`), read once. */
  intent: AssetIntent | null;
}

const INTENT_METHODS: Partial<Record<AssetIntent, AddMethod>> = {
  questions: "guided",
  prompt: "prompt",
  upload: "photos",
};

/** Stages that end by themselves: the worker is (or is about to be) producing something. */
const WORKING_STAGES: readonly AssetStage[] = ["generating", "building_sheet"];

/** When to check again after an action: its own refresh may have raced the server. */
const RECHECK_MS = [1000, 3500];

/**
 * Keeps the page in step with the server. It polls while a stage is not settled (even when no job
 * is recorded yet: the sheet row appears a moment after an image is accepted) and slowly when it is,
 * so a refresh that was lost never leaves an old stage on screen. `refresh` is for after an action:
 * it refreshes at once, then checks again shortly after.
 */
function useAssetSync(assetId: string, versions: DetailVersions, working: boolean) {
  const router = useRouter();
  const key = versionsKey(versions);
  const keyRef = useRef(key);
  const alive = useRef(true);
  const signalOf = useAbortOnUnmount();
  // One set for the component's life, so the unmount cleanup clears the timers set last.
  const timers = useRef(new Set<number>());
  useEffect(() => {
    keyRef.current = key;
  });
  useEffect(() => {
    alive.current = true;
    const pending = timers.current;
    return () => {
      alive.current = false;
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  const check = useCallback(
    async (isActive: () => boolean, signal: AbortSignal) => {
      // Never after the page was left: the request would be sent from another page.
      if (!isActive() || !alive.current) return;
      const next = await pollAsset(assetId, { signal });
      // null: signed out, rate limited or the poll failed. Not a change, so nothing to refresh.
      if (isActive() && alive.current && next !== null && next !== keyRef.current) router.refresh();
    },
    [assetId, router],
  );

  const unsettled = working || versions.busy || WORKING_STAGES.includes(versions.stage);
  usePolling(check, true, unsettled ? FAST_POLL_MS : SETTLED_POLL_MS);

  const refresh = useCallback(() => {
    if (!alive.current) return;
    router.refresh();
    const pending = timers.current;
    pending.forEach(clearTimeout);
    pending.clear();
    for (const ms of RECHECK_MS) {
      const timer = window.setTimeout(() => {
        pending.delete(timer);
        void check(() => alive.current, signalOf()).catch(() => {});
      }, ms);
      pending.add(timer);
    }
  }, [check, router, signalOf]);

  return refresh;
}

/** How long the "Next: ..." line stays: long enough to read, short of the result toasts. */
const MOVE_ON_TOAST_MS = 5000;

/**
 * Sends the user on once a job has everything it needs: a short line says what started and where
 * they are going, then the next asset that waits for them opens (the overview when none does). The
 * job's page keeps polling whenever the user comes back to it.
 */
function useMoveOn(projectId: string, refresh: () => void) {
  const router = useRouter();
  const toast = useToast();
  return useCallback(
    (data: MoveOn | null, started: string) => {
      if (!data) {
        refresh();
        return;
      }
      const next = data.next;
      toast.show({
        kind: "success",
        title: started,
        description: next ? `Next: ${next.name}` : "Nothing else needs you right now.",
        duration: MOVE_ON_TOAST_MS,
      });
      router.push(
        next ? assetHref(projectId, next.assetId) : stageHref(projectId, "pre_production"),
      );
    },
    [projectId, refresh, router, toast],
  );
}

/** What a screen reader hears when the stage moves on (the visible panel is not a live region). */
const ANNOUNCEMENTS: Record<AssetStage, string> = {
  needs_image: "Add an image.",
  needs_recording: "Add a recording.",
  generating: "Creating the image.",
  needs_answer: "The designer has a question.",
  look_review: "The image is ready to review.",
  building_sheet: "Building the sheet.",
  sheet_review: "The sheet is ready to review.",
  ready: "The asset is ready.",
  failed: "Something went wrong. The details are on the page.",
};

/** One asset of pre-production: its image leads, its state decides what can be done. */
export function AssetScreen(props: AssetScreenProps) {
  const { projectId, asset, versions, orientation, prices, balance, designer, design } = props;
  const { stage, looks, sheets } = versions;
  const pack = props.pack;
  // A pack's views are made one by one, and its contact sheet a moment after the lock.
  const packBusy =
    pack !== null &&
    (packWorking(pack.views) ||
      (stage === "ready" && sheets[0] !== undefined && !sheets[0].fileId));
  const refresh = useAssetSync(asset.id, versions, packBusy);
  const moveOn = useMoveOn(projectId, refresh);
  // The intent applies to the panel first shown; it is then dropped from the address, so a reload
  // or a later stage does not reopen it.
  const [intent] = useState(props.intent);
  useEffect(() => {
    if (!props.intent) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("open");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, [props.intent]);
  // False while the page is first shown; panels that mount later take focus (see StageHeading).
  const shown = useRef(false);
  // Set after a tick, not in the effect itself: development double-runs effects on mount.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      shown.current = true;
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const context = useMemo(() => ({ refresh, moveOn, shown }), [refresh, moveOn]);
  // Announce a stage change, but not the stage the page opened on.
  const [announcement, setAnnouncement] = useState("");
  const [announcedStage, setAnnouncedStage] = useState(stage);
  if (announcedStage !== stage) {
    setAnnouncedStage(stage);
    setAnnouncement(ANNOUNCEMENTS[stage]);
  }

  const voice = asset.kind === "voice";
  const items = useMemo(() => historyItems(looks, sheets), [looks, sheets]);
  const [viewingKey, setViewingKey] = useState<string | null>(null);
  // After a failed image, "Add Image Another Way" opens the chooser for that failure.
  const [anotherWayFor, setAnotherWayFor] = useState<string | null>(null);
  const viewing = items.find((item) => item.key === viewingKey) ?? null;
  const failed = failedVersion(versions);
  const held = heldImage(versions);

  function stageView() {
    if (asset.removed) {
      return (
        <p className="max-w-(--measure) in-2 text-body text-pretty text-label-2">
          This asset was removed from the project. Its images and sheets are kept below.
        </p>
      );
    }
    if (voice) {
      return (
        <VoiceStage
          projectId={projectId}
          assetId={asset.id}
          assetName={asset.name}
          recording={acceptedLook(looks)}
          busy={versions.busy}
          initialReplacing={intent === "change"}
        />
      );
    }
    // Every image asset has a designer; only voices (handled above) have none.
    if (!designer) return null;
    switch (stage) {
      case "needs_image":
      case "needs_recording":
        return (
          <AddImage
            projectId={projectId}
            asset={asset}
            questions={props.questions}
            designer={designer}
            limits={props.limits}
            price={prices.look}
            balance={balance}
            initialMethod={intent ? INTENT_METHODS[intent] : undefined}
          />
        );
      case "generating":
        return (
          <WaitingStage
            projectId={projectId}
            assetId={asset.id}
            assetName={asset.name}
            kind="look"
            held={held}
            orientation={orientation}
            waitingFor={design.waitingFor}
            references={looks[0]?.references ?? []}
            designer={designer}
          />
        );
      case "needs_answer": {
        const look = looks[0];
        if (!look) return null;
        return (
          <NeedsAnswerStage
            key={look.id}
            projectId={projectId}
            assetId={asset.id}
            assetName={asset.name}
            look={look}
            aiDecides={designer.aiDecides}
            maxAnswer={props.limits.answer}
          />
        );
      }
      case "building_sheet":
        return (
          <WaitingStage
            projectId={projectId}
            assetId={asset.id}
            assetName={asset.name}
            kind="sheet"
            held={held}
            orientation={orientation}
            pack={pack !== null}
          />
        );
      case "look_review": {
        const look = looks[0];
        if (!look) return null;
        return (
          <LookReviewStage
            projectId={projectId}
            assetId={asset.id}
            assetName={asset.name}
            key={look.id}
            look={look}
            parent={parentLook(looks, look)}
            orientation={orientation}
            designer={designer}
            toConfirm={design.toConfirm}
            rejectedInARow={design.rejectedInARow}
            maxNote={props.limits.note}
            prices={prices}
            balance={balance}
            initialAsking={intent === "changes"}
          />
        );
      }
      case "sheet_review": {
        const sheet = sheets[0];
        if (!sheet || !props.sheetCatalog) return null;
        if (pack) {
          return (
            <PackReviewStage
              key={sheet.id}
              projectId={projectId}
              assetId={asset.id}
              assetName={asset.name}
              pack={pack}
              sheet={sheet}
              hero={acceptedLook(looks)}
              catalog={props.sheetCatalog}
              orientation={orientation}
              maxNote={props.limits.note}
              viewPrice={prices.sheet}
              balance={balance}
              initialAsking={intent === "changes"}
            />
          );
        }
        return (
          <SheetReviewStage
            projectId={projectId}
            assetId={asset.id}
            assetName={asset.name}
            sheet={sheet}
            look={acceptedLook(looks)}
            orientation={orientation}
            key={sheet.id}
            catalog={props.sheetCatalog}
            rejectedInARow={sheetRejectedInARow(sheets)}
            maxNote={props.limits.note}
            sheetPrice={prices.sheet}
            balance={balance}
            initialAsking={intent === "changes"}
          />
        );
      }
      case "ready":
        if (pack) {
          return (
            <PackReadyStage
              projectId={projectId}
              assetId={asset.id}
              assetName={asset.name}
              pack={pack}
              sheet={sheets[0] ?? null}
              hero={acceptedLook(looks)}
              orientation={orientation}
              initialConfirming={intent === "change"}
            />
          );
        }
        return (
          <ReadyStage
            projectId={projectId}
            assetId={asset.id}
            assetName={asset.name}
            sheet={sheets[0] ?? null}
            look={acceptedLook(looks)}
            orientation={orientation}
            initialConfirming={intent === "change"}
          />
        );
      case "failed": {
        if (!failed) return null;
        if (failed.kind === "look" && anotherWayFor === failed.id) {
          return (
            <AddImage
              projectId={projectId}
              asset={asset}
              questions={props.questions}
              designer={designer}
              limits={props.limits}
              price={prices.look}
              balance={balance}
              title="Add Image Another Way"
              onCancel={() => setAnotherWayFor(null)}
            />
          );
        }
        return (
          <FailedStage
            projectId={projectId}
            assetId={asset.id}
            assetName={asset.name}
            failed={failed}
            held={held}
            orientation={orientation}
            price={failed.kind === "look" ? prices.look : prices.sheet}
            balance={balance}
            onAnotherWay={failed.kind === "look" ? () => setAnotherWayFor(failed.id) : null}
          />
        );
      }
    }
  }

  return (
    <AssetScreenProvider value={context}>
      <div className="flex flex-col">
        <ToolbarBack href={props.category.href} label={props.category.label} />
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
        {/* The header and the stage fill the screen; History follows below the fold. */}
        {/* `group/asset`: the header folds to its menu while the casting sheet shows the name. */}
        <div className={`${FILL_PAGE} group/asset`}>
          <AssetHeader
            projectId={projectId}
            asset={asset}
            kindName={props.kindName}
            category={props.category}
            busy={versions.busy}
            limits={props.limits}
          />
          <div className="flex flex-1 flex-col *:flex-1">
            {viewing ? (
              <HistoryViewer
                item={viewing}
                assetName={asset.name}
                voice={voice}
                orientation={orientation}
                questions={props.questions}
                designer={designer}
                looks={looks}
                onBack={() => setViewingKey(null)}
              />
            ) : (
              stageView()
            )}
          </div>
        </div>
        <HistoryStrip
          className="mt-24"
          items={items}
          voice={voice}
          selectedKey={viewing?.key ?? null}
          onSelect={(key) => {
            setViewingKey(key);
            if (!key) return;
            const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
          }}
        />
      </div>
    </AssetScreenProvider>
  );
}
