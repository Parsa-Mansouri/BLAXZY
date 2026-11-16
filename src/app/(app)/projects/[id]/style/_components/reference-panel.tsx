"use client";

import { useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import { ImagePlus, X } from "lucide-react";
import { fileSrc } from "@/lib/file-src";
import { fileMime, fileProblem, uploadViaTicket } from "@/lib/upload";
import { useAbortOnUnmount } from "@/app/(app)/_lib/use-abort-on-unmount";
import {
  MAX_REFERENCE_DESCRIPTION_CHARS,
  MAX_REFERENCE_IMAGE_MB,
  MAX_REFERENCE_IMAGES,
  MAX_REFERENCE_TITLE_CHARS,
  MAX_REFERENCE_TITLES,
  REFERENCE_IMAGE_TYPES,
  cleanTitles,
  type StyleReferenceInput,
} from "@/lib/style-references";
import {
  ActionMenu,
  AnimatedPlaceholder,
  Button,
  cn,
  DemoHint,
  DropScene,
  IconButton,
  Input,
  ProgressBar,
  stagger,
  StoredImage,
  Textarea,
} from "@/ui";
import { createStyleReferenceUploadAction, finishStyleReferenceUploadAction } from "../actions";

interface Uploading {
  key: string;
  name: string;
  progress: number;
}

/** Titles the empty "Films or Shows Like It" field writes, by subject; it rests on the first. */
const EXAMPLE_TITLES: Record<"look" | "genre", readonly string[]> = {
  look: ["Blade Runner 2049", "In the Mood for Love", "The Grand Budapest Hotel", "Chernobyl"],
  genre: ["Blade Runner 2049", "No Country for Old Men", "Arrival", "Severance"],
};

const ACCEPT = Object.keys(REFERENCE_IMAGE_TYPES)
  .map((ext) => `.${ext}`)
  .join(",");

function Section({
  title,
  id,
  className,
  index,
  children,
}: {
  title: string;
  id: string;
  className?: string;
  index: number;
  children: ReactNode;
}) {
  // No box round each group: space keeps the three apart (16px inside a group, 48px between).
  return (
    <section
      aria-labelledby={id}
      style={stagger(index, 40)}
      className={cn("flex min-w-0 enter flex-col gap-4", className)}
    >
      <h3 id={id} className="text-section text-balance">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * "Not what you have in mind?": film or show names (removable chips), reference images and a
 * description, any mix. Images go straight from the browser to object storage; only their ids
 * are kept in the answer.
 */
export function ReferencePanel({
  projectId,
  subject,
  value,
  onChange,
}: {
  projectId: string;
  /** "look" or "genre", for labels. */
  subject: string;
  value: StyleReferenceInput;
  /** Receives an update of the latest answer (uploads finish after other edits). */
  onChange: (update: (prev: StyleReferenceInput) => StyleReferenceInput) => void;
}) {
  const id = useId();
  const signal = useAbortOnUnmount();
  const fileInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [uploads, setUploads] = useState<Uploading[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const titlesFull = value.titles.length >= MAX_REFERENCE_TITLES;
  const exampleTitles = subject === "genre" ? EXAMPLE_TITLES.genre : EXAMPLE_TITLES.look;
  const imageSlots = MAX_REFERENCE_IMAGES - value.fileIds.length - uploads.length;

  function addTitle() {
    if (cleanTitles([...value.titles, title]).length > MAX_REFERENCE_TITLES) return;
    const added = title;
    onChange((prev) => ({ ...prev, titles: cleanTitles([...prev.titles, added]) }));
    setTitle("");
  }

  function removeTitle(name: string) {
    onChange((prev) => ({ ...prev, titles: prev.titles.filter((t) => t !== name) }));
  }

  async function uploadOne(file: File) {
    const problem = fileProblem(file, {
      types: REFERENCE_IMAGE_TYPES,
      maxBytes: MAX_REFERENCE_IMAGE_MB * 1024 * 1024,
      messages: {
        type: "Choose a .png, .jpg or .webp image.",
        empty: `Choose an image up to ${MAX_REFERENCE_IMAGE_MB} MB.`,
        size: `Choose an image up to ${MAX_REFERENCE_IMAGE_MB} MB.`,
      },
    });
    if (problem) {
      setImageError(problem);
      return;
    }
    const key = `${file.name}-${crypto.randomUUID()}`;
    setUploads((list) => [...list, { key, name: file.name, progress: 0 }]);
    const result = await uploadViaTicket({
      createTicket: () =>
        createStyleReferenceUploadAction(projectId, {
          name: file.name,
          type: fileMime(file, REFERENCE_IMAGE_TYPES),
          size: file.size,
        }),
      file,
      confirm: (fileId) => finishStyleReferenceUploadAction(fileId),
      onProgress: (progress) =>
        setUploads((list) => list.map((u) => (u.key === key ? { ...u, progress } : u))),
      signal: signal(),
      uploadFailedMessage: "The upload failed. Check your connection and add the image again.",
    });
    setUploads((list) => list.filter((u) => u.key !== key));
    if (!result.ok) {
      if (!result.aborted) setImageError(result.error);
      return;
    }
    const fileId = result.fileId;
    onChange((prev) => ({ ...prev, fileIds: [...prev.fileIds, fileId] }));
  }

  async function addFiles(files: FileList | null) {
    setImageError(null);
    const list = Array.from(files ?? []);
    if (list.length > imageSlots) {
      setImageError(`Add up to ${MAX_REFERENCE_IMAGES} images.`);
    }
    // One at a time, so each finished id is added to the latest answer.
    for (const file of list.slice(0, Math.max(0, imageSlots))) {
      if (signal().aborted) return;
      await uploadOne(file);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void addFiles(event.dataTransfer.files);
  }

  return (
    <div className="grid min-h-0 flex-1 swap-in auto-rows-[minmax(0,auto)] gap-x-16 gap-y-12 lg:grid-cols-2 lg:grid-rows-[auto_1fr]">
      <Section title="Films or Shows Like It" id={`${id}-films`} index={0}>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            addTitle();
          }}
        >
          <AnimatedPlaceholder
            lines={exampleTitles}
            empty={title.length === 0}
            disabled={titlesFull}
            className="min-w-0 flex-1"
          >
            <Input
              aria-label={`A film or show with the ${subject} you want`}
              placeholder={exampleTitles[0]}
              value={title}
              maxLength={MAX_REFERENCE_TITLE_CHARS}
              onChange={(e) => setTitle(e.target.value)}
              disabled={titlesFull}
              autoComplete="off"
            />
          </AnimatedPlaceholder>
          <Button type="submit" variant="outlined" disabled={titlesFull || !title.trim()}>
            Add
          </Button>
        </form>
        {value.titles.length > 0 ? (
          <ul aria-label="Films and shows" className="flex flex-wrap gap-2">
            {value.titles.map((t) => (
              // A removable chip (the kit has none yet): a capsule round a capsule button, so
              // the corners stay concentric.
              <ActionMenu
                key={t}
                render={<li />}
                label={`Actions for ${t}`}
                actions={[
                  [
                    {
                      id: "remove",
                      label: "Remove",
                      destructive: true,
                      onSelect: () => removeTitle(t),
                    },
                  ],
                ]}
                className="flex max-w-full swap-in items-center gap-1 rounded-capsule bg-elevated-2 py-0.5 pr-0.5 pl-4 text-body text-label"
              >
                <span className="min-w-0 break-words">{t}</span>
                <IconButton
                  label={`Remove ${t}`}
                  tooltip={false}
                  size="small"
                  className="hover:bg-fill"
                  icon={<X aria-hidden="true" strokeWidth={1.5} />}
                  onClick={() => removeTitle(t)}
                />
              </ActionMenu>
            ))}
          </ul>
        ) : null}
      </Section>

      <Section title="Reference Images" id={`${id}-images`} index={1} className="lg:row-span-2">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (imageSlots > 0) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "grid min-h-40 flex-1 auto-rows-[minmax(120px,1fr)] grid-cols-[repeat(auto-fit,minmax(min(100%,160px),1fr))] gap-3 rounded-tile",
            // A drop area, not a field: a white edge while images are dragged over it.
            dragging && "outline-2 outline-offset-4 outline-label",
          )}
        >
          {value.fileIds.map((fileId, i) => (
            <ActionMenu
              key={fileId}
              label={`Actions for reference image ${i + 1}`}
              buttonLabel={`More for reference image ${i + 1}`}
              button="overlay"
              buttonClassName="top-2 right-11"
              actions={[
                [
                  {
                    id: "open-image",
                    label: "Open Image in New Tab",
                    href: fileSrc(fileId),
                    newTab: true,
                  },
                ],
                [
                  {
                    id: "remove",
                    label: "Remove",
                    destructive: true,
                    onSelect: () =>
                      onChange((prev) => ({
                        ...prev,
                        fileIds: prev.fileIds.filter((f) => f !== fileId),
                      })),
                  },
                ],
              ]}
              className="group/ref relative swap-in overflow-hidden rounded-tile bg-elevated"
            >
              {/* Stored images are served through /api/files; next/image is not needed here. */}
              <StoredImage
                src={fileSrc(fileId)}
                alt={`Reference image ${i + 1}`}
                className="absolute inset-0 size-full object-cover"
              />
              <IconButton
                label={`Remove reference image ${i + 1}`}
                tooltip={false}
                variant="dark"
                size="small"
                className="absolute top-2 right-2"
                icon={<X aria-hidden="true" strokeWidth={1.5} />}
                onClick={() =>
                  onChange((prev) => ({
                    ...prev,
                    fileIds: prev.fileIds.filter((f) => f !== fileId),
                  }))
                }
              />
            </ActionMenu>
          ))}
          {uploads.map((u) => (
            <div
              key={u.key}
              aria-live="polite"
              className="flex flex-col justify-end gap-2 rounded-tile bg-elevated p-3"
            >
              <span className="truncate font-mono text-meta text-label-2">{u.name}</span>
              <ProgressBar value={u.progress} showValue aria-label={`Uploading ${u.name}`} />
            </div>
          ))}
          {imageSlots > 0 ? (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="demo-host flex press flex-col items-center justify-center gap-2 rounded-tile border border-dashed border-outline p-4 text-center text-secondary text-label-2 focus-ring [--demo-pad:1rem] [--demo-radius:var(--radius-tile)] [--demo-strength:0.5] hover:bg-fill-4 hover:text-label"
            >
              {/* An image dropped on the tile; the zone flashes the grid's real drag edge (white,
                  not brand). Faint, so the icon and words stay first. */}
              <DemoHint mask="none" delay={900} className="[&_.demo-drop-zone]:border-label">
                <DropScene variant="image" />
              </DemoHint>
              <ImagePlus aria-hidden="true" className="size-5" strokeWidth={1.5} />
              <span>
                Add a Screenshot
                <span className="block text-meta text-label-3">
                  Or drop images here. PNG, JPG or WebP.
                </span>
              </span>
            </button>
          ) : null}
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const files = e.target.files;
            void addFiles(files).finally(() => {
              if (fileInput.current) fileInput.current.value = "";
            });
          }}
        />
        {imageError ? (
          <p role="alert" className="swap-in text-secondary text-pretty text-red">
            {imageError}
          </p>
        ) : null}
      </Section>

      <Section title="In Your Own Words" id={`${id}-words`} index={2}>
        <Textarea
          textStyle="script"
          minRows={3}
          maxRows={10}
          maxLength={MAX_REFERENCE_DESCRIPTION_CHARS}
          value={value.description ?? ""}
          onChange={(e) => {
            const description = e.target.value;
            onChange((prev) => ({ ...prev, description }));
          }}
          placeholder={
            subject === "look"
              ? "Grainy and warm, like an old home movie."
              : "A quiet character study that turns into a heist."
          }
          aria-label={`Describe the ${subject} in your own words`}
        />
      </Section>
    </div>
  );
}
