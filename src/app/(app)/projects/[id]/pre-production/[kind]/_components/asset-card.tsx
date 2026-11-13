"use client";

import { useState, useTransition, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fileSrc } from "@/lib/file-src";
import { Ellipsis } from "lucide-react";
import { Button, cn, IconButton, Menu, PictureTile, StatusLine, StoredImage, useToast } from "@/ui";
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

/**
 * One asset of a category as a picture card. Its actions sit on a panel that slides up over the
 * whole picture on hover and keyboard focus; each one either acts here or opens the asset page
 * at the right place.
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
  /** The card's menu items (fixes to the detected list, Rename, Remove). */
  menu?: ReactNode;
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
  const voice = item.kind === "voice";
  const skipped = item.priority === "skipped";
  const optional = item.priority === "optional";

  const link = (label: string, intent?: AssetIntent, primary = false) => (
    <Button
      key={label}
      variant={primary ? "primary" : "dark"}
      render={<Link href={assetIntentHref(projectId, item.id, intent)} />}
    >
      {label}
    </Button>
  );

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

  let actions: ReactNode;
  switch (skipped ? "skipped" : item.stage) {
    case "skipped":
      actions = link("Open");
      break;
    case "sheet_review":
      actions = (
        <>
          <Button variant="primary" loading={accepting} onClick={accept}>
            Accept Sheet
          </Button>
          {link("Request Changes", "changes")}
          {link("Look Closer")}
        </>
      );
      break;
    case "look_review":
      actions = (
        <>
          {link("Review Image", undefined, true)}
          {link("Request Changes", "changes")}
        </>
      );
      break;
    case "needs_image":
      actions = (
        <>
          {link("Answer Questions", "questions", true)}
          {link("Write a Prompt", "prompt")}
          {link("Use Photos", "upload")}
        </>
      );
      break;
    case "needs_answer":
      actions = link("Answer the Question", undefined, true);
      break;
    case "needs_recording":
      actions = link("Upload a Recording", undefined, true);
      break;
    case "ready":
      actions = voice ? (
        <>
          {link("Listen")}
          {link("Replace Recording", "change")}
        </>
      ) : (
        <>
          {link("View Sheet")}
          {link("Change Image", "change")}
        </>
      );
      break;
    default:
      actions = link("Open");
  }

  if (optional && onSkip) {
    actions = (
      <>
        {actions}
        <Button key="skip" variant="dark" loading={skipping} onClick={onSkip}>
          Skip It
        </Button>
      </>
    );
  }

  const placeholder = skipped ? "Not designed" : placeholderFor(item);
  const caption = (
    <span className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 flex-1 truncate">{item.name}</span>
      {optional ? (
        <span className="font-normal shrink-0 font-mono text-meta tracking-caps text-label-3 uppercase">
          Optional
        </span>
      ) : null}
      {menu ? (
        <Menu
          align="end"
          trigger={
            <IconButton
              label={`More for ${item.name}`}
              tooltip={false}
              size="small"
              className="-my-1.5 shrink-0"
              icon={<Ellipsis strokeWidth={1.5} />}
            />
          }
        >
          {menu}
        </Menu>
      ) : null}
    </span>
  );
  return (
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
        className,
      )}
      style={style}
    />
  );
}
