"use client";

import { useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fileSrc } from "@/lib/file-src";
import {
  ActionMenuButton,
  ActionMenuTarget,
  Button,
  cn,
  imageExtras,
  linkExtras,
  PictureTile,
  StatusLine,
  StoredImage,
  useToast,
  type ActionGroups,
  type ActionItem,
} from "@/ui";
import { ASSET_STATUS_LABELS } from "../../../_lib/asset-status";
import { DrawnTick } from "../../_components/drawn-tick";
import { StageStatus, isWorking } from "../../_components/asset-stage";
import { KIND_ASPECTS, type GalleryItem } from "../../_components/gallery-item";
import { assetIntentHref, type AssetIntent } from "../../assets/[assetId]/_lib/intent";
import { acceptSheetAction } from "../actions";

/** What the picture area shows when there is no image: never a fake one. */
function placeholderFor(item: GalleryItem): string {
  if (item.stage === "needs_image") return "No image yet";
  if (item.stage === "needs_recording") return "No recording yet";
  if (item.kind === "voice") return "Recording";
  if (isWorking(item.stage)) return ASSET_STATUS_LABELS[item.stage];
  return "No image";
}

/** One of the card's stage actions: a link to the asset page at the right place, or a command. */
type StageAction =
  | { kind: "link"; label: string; intent?: AssetIntent; primary?: boolean }
  | { kind: "accept" }
  | { kind: "skip" };

/** What the card offers for the asset's stage, the main one first. */
function stageActions(item: GalleryItem, skipped: boolean): StageAction[] {
  const link = (label: string, intent?: AssetIntent, primary = false): StageAction => ({
    kind: "link",
    label,
    intent,
    primary,
  });
  switch (skipped ? "skipped" : item.stage) {
    case "skipped":
      return [link("Open")];
    case "sheet_review":
      return [{ kind: "accept" }, link("Request Changes", "changes"), link("Look Closer")];
    case "look_review":
      return [link("Review Image", undefined, true), link("Request Changes", "changes")];
    case "needs_image":
      return [
        link("Answer Questions", "questions", true),
        link("Write a Prompt", "prompt"),
        link("Use Photos", "upload"),
      ];
    case "needs_answer":
      return [link("Answer the Question", undefined, true)];
    case "needs_recording":
      return [link("Upload a Recording", undefined, true)];
    case "ready":
      return item.kind === "voice"
        ? [link("Listen"), link("Replace Recording", "change")]
        : [link("View Sheet"), link("Change Image", "change")];
    default:
      return [link("Open")];
  }
}

/**
 * One asset of a category as a picture card. Its actions sit on a panel that slides up over the
 * whole picture on hover and keyboard focus; each one either acts here or opens the asset page
 * at the right place. The same actions, the category's `menu` items, Open in New Tab and Copy
 * Link are on right-click, a long press and the "…" button (always shown on touch screens).
 */
export function AssetCard({
  projectId,
  item,
  menu,
  onSkip,
  skipping = false,
  className,
  style,
}: {
  projectId: string;
  item: GalleryItem;
  /** The card's menu groups (fixes to the detected list, Rename, Remove). */
  menu?: ActionGroups;
  /** Skips an optional asset (it is not designed). */
  onSkip?: () => void;
  skipping?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const router = useRouter();
  const toast = useToast();
  const [accepting, startAccepting] = useTransition();
  const [accepted, setAccepted] = useState(false);
  const skipped = item.priority === "skipped";
  const optional = item.priority === "optional";

  function accept() {
    startAccepting(async () => {
      const result = await acceptSheetAction(projectId, item.id);
      if (!result.ok) {
        toast.danger(result.error);
        return;
      }
      setAccepted(true);
      router.refresh();
    });
  }

  const stage = [
    ...stageActions(item, skipped),
    ...(optional && onSkip ? [{ kind: "skip" as const }] : []),
  ];
  const href = assetIntentHref(projectId, item.id);

  const actions = stage.map((action) => {
    if (action.kind === "accept") {
      return (
        <Button key="accept" variant="primary" loading={accepting} onClick={accept}>
          Accept Sheet
        </Button>
      );
    }
    if (action.kind === "skip") {
      return (
        <Button key="skip" variant="dark" loading={skipping} onClick={onSkip}>
          Skip It
        </Button>
      );
    }
    return (
      <Button
        key={action.label}
        variant={action.primary ? "primary" : "dark"}
        render={<Link href={assetIntentHref(projectId, item.id, action.intent)} />}
      >
        {action.label}
      </Button>
    );
  });

  const stageItems = stage.map((action): ActionItem => {
    if (action.kind === "accept") {
      return { id: "accept", label: "Accept Sheet", disabled: accepting, onSelect: accept };
    }
    if (action.kind === "skip") {
      return { id: "skip", label: "Skip It", disabled: skipping, onSelect: () => onSkip?.() };
    }
    return {
      id: `link-${action.label}`,
      label: action.label,
      href: assetIntentHref(projectId, item.id, action.intent),
    };
  });
  const menuGroups: ActionGroups = [
    stageItems,
    [
      ...linkExtras(href),
      ...(item.thumbnailFileId ? imageExtras(fileSrc(item.thumbnailFileId)) : []),
    ],
    ...(menu ?? []),
  ];

  const placeholder = skipped ? "Not designed" : placeholderFor(item);
  const caption = (
    <span className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 flex-1 truncate">{item.name}</span>
      {optional ? (
        <span className="font-normal shrink-0 font-mono text-meta tracking-caps text-label-3 uppercase">
          Optional
        </span>
      ) : null}
      <ActionMenuButton
        actions={menuGroups}
        label={`More for ${item.name}`}
        className="-my-1.5 shrink-0"
      />
    </span>
  );
  return (
    <ActionMenuTarget
      actions={menuGroups}
      label={`Actions for ${item.name}`}
      className={cn("min-w-0", className)}
      style={style}
    >
      <PictureTile
        label={`${item.name}, ${skipped ? "Skipped" : ASSET_STATUS_LABELS[item.stage]}`}
        aspect={KIND_ASPECTS[item.kind]}
        picture={
          item.thumbnailFileId ? (
            <StoredImage
              src={fileSrc(item.thumbnailFileId)}
              alt=""
              className={KIND_ASPECTS[item.kind] === "portrait" ? "object-top" : undefined}
            />
          ) : undefined
        }
        placeholder={placeholder}
        actions={actions}
        caption={caption}
        status={
          skipped ? undefined : accepted &&
            (item.stage === "sheet_review" || item.stage === "ready") ? (
            <StatusLine tone="none" className="text-done">
              <span className="inline-flex items-center gap-1.5">
                <DrawnTick />
                Accepted
              </span>
            </StatusLine>
          ) : item.stage === "ready" ? undefined : (
            <StageStatus stage={item.stage} />
          )
        }
        className={cn(
          skipped && "opacity-55 transition-opacity focus-within:opacity-100 hover:opacity-100",
        )}
      />
    </ActionMenuTarget>
  );
}
