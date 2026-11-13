"use client";

import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { ImagePlus, X } from "lucide-react";
import { fileSrc } from "@/lib/file-src";
import { useAbortOnUnmount } from "@/app/(app)/_lib/use-abort-on-unmount";
import {
  Button,
  cn,
  DemoHint,
  DropScene,
  IconButton,
  ProgressBar,
  stagger,
  StoredImage,
  Textarea,
} from "@/ui";
import type { DesignerInfo } from "../_lib/designer-view";
import { IMAGE_ACCEPT, uploadReferencePhoto } from "../_lib/reference-upload";
import { startDesignAction, type ReferencePhoto } from "../actions";
import { StageHeading, useAssetScreen } from "./asset-context";
import { Caps, ChoiceTile } from "./desk";
import { PriceLine, type AssetInfo } from "./shared";
import { useFileDrop } from "./use-file-drop";
import { ErrorLine } from "@/app/(app)/_components/values";
import { canAfford, formatNumber } from "@/app/(app)/_lib/format";

/** Longest note on one photo (the server's limit). */
const MAX_NOTE = 1000;

interface PhotoDraft {
  key: string;
  name: string;
  /** Upload progress in percent; null once the photo is uploaded. */
  progress: number | null;
  fileId: string | null;
  role: string | null;
  note: string;
}

const LEADS: Record<DesignerInfo["key"], string> = {
  character:
    "A face, an outfit or a whole figure: say what each photo is for and the designer takes only that.",
  location:
    "The place itself, its layout, its mood or one detail: say what each photo is for and the designer keeps to it.",
  prop: "The object itself, its material, one detail or its mood: say what each photo is for and the designer keeps to it.",
};

/** The question over a photo's note; null when its role needs none. */
export function notePrompt(designer: DesignerInfo["key"], role: string | null): string | null {
  if (role === "other") return "What should we take from it?";
  if (designer === "character" || role === null) return null;
  return "What must stay from this photo?";
}

/** The role's label, for captions. */
export function roleLabel(designer: Pick<DesignerInfo, "roles">, role: string): string {
  return designer.roles.find((r) => r.value === role)?.label ?? role;
}

/** One photo: the picture, its role as tiles, and what to keep from it. */
function PhotoCard({
  photo,
  index,
  designer,
  disabled,
  highlight,
  onChange,
  onRemove,
}: {
  photo: PhotoDraft;
  index: number;
  designer: DesignerInfo;
  disabled: boolean;
  highlight: boolean;
  onChange: (patch: Partial<PhotoDraft>) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const prompt = notePrompt(designer.key, photo.role);
  const n = index + 1;
  return (
    <li
      style={stagger(index, 50)}
      className={cn(
        "flex enter flex-col gap-4 rounded-tile border bg-ground p-4 sm:flex-row sm:p-5",
        highlight ? "border-red/60" : "border-outline-quiet",
      )}
    >
      <div className="flex shrink-0 items-start justify-between gap-3 sm:flex-col">
        <div className="relative size-28 overflow-hidden rounded-item bg-elevated sm:size-36">
          {photo.fileId ? (
            <StoredImage
              src={fileSrc(photo.fileId)}
              alt={`Photo ${n}`}
              className="absolute inset-0 size-full object-cover"
            />
          ) : (
            <div
              className="absolute inset-0 flex flex-col justify-end gap-2 p-3"
              aria-live="polite"
            >
              <span className="truncate font-mono text-meta text-label-2">{photo.name}</span>
              <ProgressBar value={photo.progress} aria-label={`Uploading ${photo.name}`} />
            </div>
          )}
          <span
            aria-hidden="true"
            className="absolute top-2 left-2 flex size-6 items-center justify-center rounded-inset bg-ground/80 font-mono text-meta text-label tabular-nums"
          >
            {n}
          </span>
        </div>
        <IconButton
          label={`Remove photo ${n}`}
          icon={<X />}
          size="small"
          disabled={disabled}
          onClick={onRemove}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <Caps id={`${id}-role`}>What is this photo for?</Caps>
        <div
          role="radiogroup"
          aria-labelledby={`${id}-role`}
          className="grid grid-cols-2 gap-2 @2xl:grid-cols-3"
        >
          {designer.roles.map((role) => (
            <ChoiceTile
              key={role.value}
              label={role.label}
              line={role.hint}
              on={photo.role === role.value}
              disabled={disabled}
              onPick={() => onChange({ role: role.value })}
            />
          ))}
        </div>
        {prompt ? (
          <label className="flex swap-in flex-col gap-1.5">
            <Caps>
              {prompt}
              {photo.role === "other" ? null : " · Optional"}
            </Caps>
            <Textarea
              value={photo.note}
              onChange={(e) => onChange({ note: e.target.value })}
              disabled={disabled}
              minRows={1}
              maxRows={4}
              maxLength={MAX_NOTE}
              placeholder={
                photo.role === "other"
                  ? "Only the colour of the coat"
                  : "The carved door and the blue tiles"
              }
            />
          </label>
        ) : null}
      </div>
    </li>
  );
}

/**
 * "Use Photos": up to four reference photos, each with its role picked on tiles (what the
 * designer takes from it) and what must stay from it, plus an optional description in words.
 * Photos go straight from the browser to storage; Generate starts the design with them.
 */
export function ReferencePhotos({
  projectId,
  asset,
  designer,
  maxPrompt,
  price,
  balance,
  initialFile,
  back,
}: {
  projectId: string;
  asset: AssetInfo;
  designer: DesignerInfo;
  maxPrompt: number;
  price: number | null;
  balance: number;
  /** A photo dropped on the chooser's tile: uploaded as soon as this view opens. */
  initialFile?: File;
  back: ReactNode;
}) {
  const { moveOn } = useAssetScreen();
  const id = useId();
  const signal = useAbortOnUnmount();
  const input = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<{ text: string; key?: string } | null>(null);
  const [sending, startSending] = useTransition();
  const uploading = photos.some((p) => p.progress !== null);
  const slots = designer.maxReferences - photos.length;
  const affordable = canAfford(price, balance);

  const patch = (key: string, change: Partial<PhotoDraft>) =>
    setPhotos((list) => list.map((p) => (p.key === key ? { ...p, ...change } : p)));

  async function uploadOne(file: File) {
    const key = `${file.name}-${crypto.randomUUID()}`;
    setPhotos((list) => [
      ...list,
      { key, name: file.name, progress: 0, fileId: null, role: null, note: "" },
    ]);
    const result = await uploadReferencePhoto(
      asset.id,
      file,
      (progress) => patch(key, { progress }),
      signal(),
    );
    if (!result.ok) {
      setPhotos((list) => list.filter((p) => p.key !== key));
      if (!result.aborted) setError({ text: result.error });
      return;
    }
    patch(key, { progress: null, fileId: result.fileId });
  }

  function addFiles(files: readonly File[]) {
    setError(null);
    if (files.length > slots) {
      setError({ text: `Use up to ${designer.maxReferences} photos.` });
    }
    for (const file of files.slice(0, Math.max(0, slots))) void uploadOne(file);
  }

  const { dragging, dropProps } = useFileDrop({
    disabled: sending || slots <= 0,
    onFile: (file) => addFiles([file]),
  });

  // The photo handed over from the chooser is uploaded once (Strict Mode runs effects twice).
  const started = useRef<File | null>(null);
  const startInitial = useEffectEvent((file: File) => addFiles([file]));
  useEffect(() => {
    if (!initialFile || started.current === initialFile) return;
    started.current = initialFile;
    startInitial(initialFile);
    // Strict Mode's simulated unmount aborts this upload, so the remount starts it again.
    return () => {
      started.current = null;
    };
  }, [initialFile]);

  function generate() {
    if (uploading) {
      setError({ text: "Wait for the photos to finish uploading." });
      return;
    }
    if (photos.length === 0) {
      setError({ text: "Add a photo first." });
      return;
    }
    const unassigned = photos.find((p) => !p.role);
    if (unassigned) {
      setError({ text: "Choose what each photo is for.", key: unassigned.key });
      return;
    }
    const silent = photos.find((p) => p.role === "other" && !p.note.trim());
    if (silent) {
      setError({ text: "Say what to take from the photo marked Something Else.", key: silent.key });
      return;
    }
    if (designer.key === "location" && photos.filter((p) => p.role === "hero").length > 1) {
      setError({ text: "Only one photo can be the place itself." });
      return;
    }
    const words = description.trim();
    if (words.length > 0 && words.length < 3) {
      setError({ text: "Write a few more words, or leave the description empty." });
      return;
    }
    if (words.length > maxPrompt) {
      setError({ text: `Shorten the description to ${formatNumber(maxPrompt)} characters.` });
      return;
    }
    const references: ReferencePhoto[] = photos.flatMap((p) =>
      p.fileId && p.role
        ? [{ fileId: p.fileId, role: p.role, ...(p.note.trim() ? { note: p.note.trim() } : {}) }]
        : [],
    );
    setError(null);
    startSending(async () => {
      const result = await startDesignAction(projectId, asset.id, {
        references,
        ...(words ? { prompt: words } : {}),
      });
      if (!result.ok) {
        setError({ text: result.error });
        return;
      }
      moveOn(result.data, `Creating ${asset.name}’s image`);
    });
  }

  return (
    <section aria-labelledby={`${id}-title`} className="@container flex flex-1 in-2 flex-col gap-8">
      {back}
      <div className="flex flex-col gap-3">
        <StageHeading id={`${id}-title`} className="text-heading-sm">
          Use Photos
        </StageHeading>
        <p className="max-w-(--measure) text-body text-pretty text-label-2">
          {LEADS[designer.key]}
        </p>
      </div>

      {photos.length > 0 ? (
        <ol className="flex flex-col gap-3">
          {photos.map((photo, i) => (
            <PhotoCard
              key={photo.key}
              photo={photo}
              index={i}
              designer={designer}
              disabled={sending}
              highlight={error?.key === photo.key}
              onChange={(change) => {
                setError(null);
                patch(photo.key, change);
              }}
              onRemove={() => setPhotos((list) => list.filter((p) => p.key !== photo.key))}
            />
          ))}
        </ol>
      ) : null}

      {slots > 0 ? (
        <div
          {...dropProps}
          className={cn(
            "demo-host flex flex-col items-center justify-center gap-3 rounded-block border border-dashed px-5 text-center transition-colors duration-(--dur-press)",
            photos.length === 0 ? "min-h-52 py-8" : "min-h-28 py-5",
            dragging ? "border-brand bg-elevated-2" : "border-separator-opaque bg-elevated",
          )}
        >
          {photos.length === 0 ? (
            <DemoHint delay={600} mask="none" className={cn(dragging && "invisible")}>
              <DropScene variant="image" />
            </DemoHint>
          ) : null}
          <ImagePlus aria-hidden="true" className="size-5 text-label-2" strokeWidth={1.5} />
          <p className="text-body text-label-2">
            {photos.length === 0 ? "Drop photos here, or" : "Drop another photo here, or"}
          </p>
          <Button variant="outlined" onClick={() => input.current?.click()} disabled={sending}>
            {photos.length === 0 ? "Choose Photos" : "Add a Photo"}
          </Button>
          <input
            ref={input}
            type="file"
            multiple
            accept={IMAGE_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              addFiles(files);
            }}
          />
          <p className="text-secondary text-label-3">
            PNG, JPEG or WebP, up to 25 MB each. Up to {designer.maxReferences} photos.
          </p>
        </div>
      ) : null}

      <label className="flex flex-col gap-2">
        <Caps>Anything to add in words · Optional</Caps>
        <Textarea
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setError(null);
          }}
          disabled={sending}
          minRows={2}
          maxRows={8}
          textStyle="script"
          placeholder={`What the photos do not show about ${asset.name}.`}
        />
      </label>

      <div className="mt-auto flex flex-col items-start gap-3">
        <PriceLine price={price} balance={balance} action="image" />
        <Button
          variant="primary"
          size="large"
          loading={sending}
          disabled={!affordable}
          onClick={generate}
        >
          Generate Image
        </Button>
        <ErrorLine>{error?.text}</ErrorLine>
      </div>
    </section>
  );
}
