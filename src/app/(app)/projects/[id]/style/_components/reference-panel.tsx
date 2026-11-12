"use client";

import { useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import { ImagePlus, X } from "lucide-react";
import { fileSrc } from "@/lib/file-src";
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
import { Button, IconButton, Input, ProgressBar, Textarea, cn, stagger } from "@/ui";
import { createStyleReferenceUploadAction, finishStyleReferenceUploadAction } from "../actions";

/** PUTs the file to the presigned URL, reporting progress. */
function putFile(
  url: string,
  headers: Record<string, string>,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress((event.loaded / event.total) * 100);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error()));
    xhr.onerror = () => reject(new Error());
    xhr.onabort = () => reject(new Error());
    xhr.send(file);
  });
}

interface Uploading {
  key: string;
  name: string;
  progress: number;
}

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
  const fileInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [uploads, setUploads] = useState<Uploading[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const titlesFull = value.titles.length >= MAX_REFERENCE_TITLES;
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
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const type = REFERENCE_IMAGE_TYPES[extension];
    if (!type) {
      setImageError("Choose a .png, .jpg or .webp image.");
      return;
    }
    if (file.size === 0 || file.size > MAX_REFERENCE_IMAGE_MB * 1024 * 1024) {
      setImageError(`Choose an image up to ${MAX_REFERENCE_IMAGE_MB} MB.`);
      return;
    }
    const key = `${file.name}-${crypto.randomUUID()}`;
    setUploads((list) => [...list, { key, name: file.name, progress: 0 }]);
    const done = () => setUploads((list) => list.filter((u) => u.key !== key));
    const ticket = await createStyleReferenceUploadAction(projectId, {
      name: file.name,
      type,
      size: file.size,
    });
    if (!ticket.ok) {
      done();
      setImageError(ticket.error);
      return;
    }
    try {
      await putFile(ticket.data.uploadUrl, ticket.data.headers, file, (progress) =>
        setUploads((list) => list.map((u) => (u.key === key ? { ...u, progress } : u))),
      );
    } catch {
      done();
      setImageError("The upload failed. Check your connection and add the image again.");
      return;
    }
    const finished = await finishStyleReferenceUploadAction(ticket.data.fileId);
    done();
    if (!finished.ok) {
      setImageError(finished.error);
      return;
    }
    const fileId = ticket.data.fileId;
    onChange((prev) => ({ ...prev, fileIds: [...prev.fileIds, fileId] }));
  }

  async function addFiles(files: FileList | null) {
    setImageError(null);
    const list = Array.from(files ?? []);
    if (list.length > imageSlots) {
      setImageError(`Add up to ${MAX_REFERENCE_IMAGES} images.`);
    }
    // One at a time, so each finished id is added to the latest answer.
    for (const file of list.slice(0, Math.max(0, imageSlots))) await uploadOne(file);
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
          <Input
            className="min-w-0 flex-1"
            aria-label={`A film or show with the ${subject} you want`}
            placeholder="Blade Runner 2049"
            value={title}
            maxLength={MAX_REFERENCE_TITLE_CHARS}
            onChange={(e) => setTitle(e.target.value)}
            disabled={titlesFull}
            autoComplete="off"
          />
          <Button type="submit" variant="outlined" disabled={titlesFull || !title.trim()}>
            Add
          </Button>
        </form>
        {value.titles.length > 0 ? (
          <ul aria-label="Films and shows" className="flex flex-wrap gap-2">
            {value.titles.map((t) => (
              // A removable chip (the kit has none yet): a capsule round a capsule button, so
              // the corners stay concentric.
              <li
                key={t}
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
              </li>
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
            <div
              key={fileId}
              className="group/ref relative swap-in overflow-hidden rounded-tile bg-elevated"
            >
              {/* Stored images are served through /api/files; next/image is not needed here. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
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
            </div>
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
              className="flex press flex-col items-center justify-center gap-2 rounded-tile border border-dashed border-outline p-4 text-center text-secondary text-label-2 focus-ring hover:bg-fill-4 hover:text-label"
            >
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
