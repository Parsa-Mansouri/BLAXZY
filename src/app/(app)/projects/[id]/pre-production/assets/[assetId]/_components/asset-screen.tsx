"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { usePolling } from "../../../../_lib/use-polling";
import {
  acceptedLook,
  failedVersion,
  heldImage,
  historyItems,
  versionsKey,
  type DetailVersions,
} from "../_lib/asset-view";
import { pollAssetAction } from "../actions";
import { AddImage } from "./add-image";
import { AssetHeader } from "./asset-header";
import { HistoryStrip, HistoryViewer } from "./history";
import {
  FailedStage,
  LookReviewStage,
  ReadyStage,
  SheetReviewStage,
  WaitingStage,
} from "./stage-panels";
import type { AssetInfo, GuidedQuestion, IssueChoice, Limits, Orientation } from "./shared";
import { VoiceStage } from "./voice";

export interface AssetScreenProps {
  projectId: string;
  asset: AssetInfo;
  kindName: string;
  category: { href: string; label: string };
  versions: DetailVersions;
  orientation: Orientation;
  prices: { look: number | null; sheet: number | null };
  balance: number;
  questions: GuidedQuestion[];
  lookIssues: IssueChoice[];
  sheetIssues: IssueChoice[];
  limits: Limits;
}

/** Refreshes the page when the asset's state moves on, polling while something is produced. */
function useRefreshOnChange(assetId: string, versions: DetailVersions) {
  const router = useRouter();
  const key = versionsKey(versions);
  usePolling(async () => {
    const next = await pollAssetAction(assetId);
    if (next !== key) router.refresh();
  }, versions.busy);
}

/** One asset of pre-production: its image leads, its state decides what can be done. */
export function AssetScreen(props: AssetScreenProps) {
  const { projectId, asset, versions, orientation, prices, balance } = props;
  const { stage, looks, sheets } = versions;
  useRefreshOnChange(asset.id, versions);

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
        <p className="max-w-(--measure) text-reading text-label-2">
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
        />
      );
    }
    switch (stage) {
      case "needs_image":
      case "needs_recording":
        return (
          <AddImage
            projectId={projectId}
            asset={asset}
            questions={props.questions}
            limits={props.limits}
            price={prices.look}
            balance={balance}
            orientation={orientation}
          />
        );
      case "generating":
        return (
          <WaitingStage assetName={asset.name} kind="look" held={held} orientation={orientation} />
        );
      case "building_sheet":
        return (
          <WaitingStage assetName={asset.name} kind="sheet" held={held} orientation={orientation} />
        );
      case "look_review": {
        const look = looks[0];
        if (!look) return null;
        return (
          <LookReviewStage
            projectId={projectId}
            assetName={asset.name}
            look={look}
            orientation={orientation}
            issues={props.lookIssues}
            maxNote={props.limits.note}
            prices={prices}
            balance={balance}
          />
        );
      }
      case "sheet_review": {
        const sheet = sheets[0];
        if (!sheet) return null;
        return (
          <SheetReviewStage
            projectId={projectId}
            assetName={asset.name}
            sheet={sheet}
            look={acceptedLook(looks)}
            orientation={orientation}
            issues={props.sheetIssues}
            maxNote={props.limits.note}
            sheetPrice={prices.sheet}
            balance={balance}
          />
        );
      }
      case "ready":
        return (
          <ReadyStage
            projectId={projectId}
            assetId={asset.id}
            assetName={asset.name}
            sheet={sheets[0] ?? null}
            look={acceptedLook(looks)}
            orientation={orientation}
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
              limits={props.limits}
              price={prices.look}
              balance={balance}
              orientation={orientation}
              title="Add Image Another Way"
              onCancel={() => setAnotherWayFor(null)}
            />
          );
        }
        return (
          <FailedStage
            projectId={projectId}
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
    <div className="@container flex flex-col gap-10">
      <AssetHeader
        projectId={projectId}
        asset={asset}
        kindName={props.kindName}
        category={props.category}
        stage={stage}
        busy={versions.busy}
        limits={props.limits}
      />
      {viewing ? (
        <HistoryViewer
          item={viewing}
          assetName={asset.name}
          voice={voice}
          orientation={orientation}
          questions={props.questions}
          onBack={() => setViewingKey(null)}
        />
      ) : (
        stageView()
      )}
      <HistoryStrip
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
  );
}
