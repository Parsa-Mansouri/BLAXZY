"use client";

import { useTransition, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fileSrc } from "@/lib/file-src";
import { Button, PictureTile, useToast } from "@/ui";
import { ASSET_STATUS_LABELS } from "../../../_lib/asset-status";
import { StageStatus, isWorking } from "../../_components/asset-stage";
import { KIND_ASPECTS, type GalleryItem } from "../../_components/gallery-item";
import { assetIntentHref, type AssetIntent } from "../../assets/[assetId]/_lib/intent";
import { acceptSheetAction } from "../actions";

/** What the picture area shows when there is no image: never a fake one. */
function placeholderFor(item: GalleryItem): { label: string; dashed: boolean } {
  if (item.stage === "needs_image") return { label: "No image yet", dashed: true };
  if (item.stage === "needs_recording") return { label: "No recording yet", dashed: true };
  if (item.kind === "voice") return { label: "Recording", dashed: false };
  if (isWorking(item.stage)) return { label: ASSET_STATUS_LABELS[item.stage], dashed: false };
  return { label: "No image", dashed: false };
}

/**
 * One asset of a category as a picture card. Its actions sit on a panel that slides up over the
 * whole picture on hover and keyboard focus; each one either acts here or opens the asset page
 * at the right place.
 */
export function AssetCard({
  projectId,
  item,
  className,
  style,
}: {
  projectId: string;
  item: GalleryItem;
  className?: string;
  style?: CSSProperties;
}) {
  const router = useRouter();
  const toast = useToast();
  const [accepting, startAccepting] = useTransition();
  const voice = item.kind === "voice";

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
      toast.success(`${item.name} is ready.`);
      router.refresh();
    });
  }

  let actions: ReactNode;
  switch (item.stage) {
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
          {link("Upload an Image", "upload")}
        </>
      );
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

  const placeholder = placeholderFor(item);
  return (
    <PictureTile
      label={`${item.name}, ${ASSET_STATUS_LABELS[item.stage]}`}
      aspect={KIND_ASPECTS[item.kind]}
      picture={
        item.thumbnailFileId ? (
          // eslint-disable-next-line @next/next/no-img-element -- user media from object storage, sized by the frame
          <img
            src={fileSrc(item.thumbnailFileId)}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            className={KIND_ASPECTS[item.kind] === "portrait" ? "object-top" : undefined}
          />
        ) : undefined
      }
      placeholder={placeholder.label}
      dashed={placeholder.dashed}
      coverHeading={item.name}
      actions={actions}
      caption={item.name}
      status={<StageStatus stage={item.stage} />}
      className={className}
      style={style}
    />
  );
}
