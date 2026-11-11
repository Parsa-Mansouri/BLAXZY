"use client";

import { useId, useRef, useState, useTransition, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { FileText, Upload } from "lucide-react";
import { Button, Hint, ProgressBar, cn } from "@/ui";
import {
  createScriptUploadAction,
  finishScriptUploadAction,
  startFromBriefAction,
} from "../actions";

const EXAMPLES = [
  "A lighthouse keeper on a remote island finds a stranger washed ashore the night before the last ferry of the season.",
  "Two rival street musicians in Lisbon are forced to share one corner for a summer, until one of them disappears.",
  "A retired astronaut teaches her grandson to read the stars in the week before the family sells her house.",
];

const MB = 1024 * 1024;
const MAX_UPLOAD_BYTES = 10 * MB;

/** The file types the script upload accepts, by extension. */
const UPLOAD_TYPES: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
};

const numberFormat = new Intl.NumberFormat("en-US");

type UploadPhase =
  | { kind: "idle" }
  | { kind: "uploading"; name: string; progress: number }
  | { kind: "starting"; name: string };

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

export function ScriptStart({
  projectId,
  maxBriefChars,
  initialBrief,
}: {
  projectId: string;
  maxBriefChars: number;
  initialBrief: string;
}) {
  const router = useRouter();
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [brief, setBrief] = useState(initialBrief);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [writing, startWriting] = useTransition();
  const [upload, setUpload] = useState<UploadPhase>({ kind: "idle" });
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const length = brief.trim().length;
  const over = brief.length > maxBriefChars;
  const busy = writing || upload.kind !== "idle";

  function write() {
    if (length === 0) {
      setBriefError("Describe your story first. One sentence is enough.");
      area.current?.focus();
      return;
    }
    if (over) {
      setBriefError(`Shorten the description to ${numberFormat.format(maxBriefChars)} characters.`);
      return;
    }
    setBriefError(null);
    startWriting(async () => {
      const result = await startFromBriefAction(projectId, brief);
      if (!result.ok) {
        setBriefError(result.error);
        return;
      }
      router.refresh();
    });
  }

  async function uploadFile(file: File) {
    setUploadError(null);
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const type = UPLOAD_TYPES[extension];
    if (!type) {
      setUploadError("This file type cannot be read. Choose a .txt, .md, .docx or .pdf file.");
      return;
    }
    if (file.size === 0) {
      setUploadError("This file is empty. Choose the file that holds your script.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError(
        "This file is larger than 10 MB. Save the script without images and try again.",
      );
      return;
    }
    setUpload({ kind: "uploading", name: file.name, progress: 0 });
    const ticket = await createScriptUploadAction(projectId, {
      name: file.name,
      type,
      size: file.size,
    });
    if (!ticket.ok) {
      setUpload({ kind: "idle" });
      setUploadError(ticket.error);
      return;
    }
    try {
      await putFile(ticket.data.uploadUrl, ticket.data.headers, file, (progress) =>
        setUpload({ kind: "uploading", name: file.name, progress }),
      );
    } catch {
      setUpload({ kind: "idle" });
      setUploadError("The upload failed. Check your connection and choose the file again.");
      return;
    }
    setUpload({ kind: "starting", name: file.name });
    const started = await finishScriptUploadAction(projectId, ticket.data.fileId);
    if (!started.ok) {
      setUpload({ kind: "idle" });
      setUploadError(started.error);
      return;
    }
    router.refresh();
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    const file = event.dataTransfer.files[0];
    if (file) void uploadFile(file);
  }

  return (
    <div className="grid gap-x-14 gap-y-12 @4xl:grid-cols-[minmax(0,1fr)_minmax(15rem,19rem)]">
      <section aria-labelledby={`${id}-describe`} className="flex min-w-0 flex-col gap-5">
        <h3 id={`${id}-describe`} className="text-title-1">
          Describe Your Story
        </h3>

        <div className="flex flex-col">
          <label htmlFor={`${id}-brief`} className="sr-only">
            Your story
          </label>
          <textarea
            ref={area}
            id={`${id}-brief`}
            value={brief}
            onChange={(e) => {
              setBrief(e.target.value);
              if (briefError) setBriefError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                write();
              }
            }}
            rows={7}
            placeholder="Who is it about, where are they, and what do they want?"
            aria-invalid={briefError ? true : undefined}
            aria-describedby={`${id}-count ${id}-hint${briefError ? ` ${id}-error` : ""}`}
            disabled={busy}
            className={cn(
              "field-sizing-content max-h-[60dvh] min-h-[calc(var(--ts-script-lh)*7+2.5rem)] w-full resize-none bg-transparent py-5 text-script text-label outline-none",
              "[box-shadow:inset_0_var(--hairline)_0_var(--separator),inset_0_calc(var(--hairline)*-1)_0_var(--separator)]",
              "focus-visible:[box-shadow:inset_0_var(--hairline)_0_var(--label-2),inset_0_calc(var(--hairline)*-1)_0_var(--label-2)]",
              "disabled:text-label-2",
            )}
          />
          <div className="flex items-baseline justify-between gap-4 pt-2">
            <p id={`${id}-hint`} className="text-callout text-label-2">
              One sentence is enough. Names, a place and an ending help.
            </p>
            <p
              id={`${id}-count`}
              className={cn(
                "shrink-0 text-callout tabular-nums",
                over ? "text-red" : "text-label-2",
              )}
            >
              <span className="sr-only">Characters used: </span>
              {numberFormat.format(brief.length)} / {numberFormat.format(maxBriefChars)}
            </p>
          </div>
          {briefError ? (
            <p id={`${id}-error`} role="alert" className="pt-2 text-callout text-red">
              {briefError}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <p className="text-callout text-label-2">Or begin from an idea:</p>
          <ul className="flex flex-col">
            {EXAMPLES.map((example) => (
              <li key={example}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setBrief(example);
                    setBriefError(null);
                    area.current?.focus();
                  }}
                  className="-mx-2 w-[calc(100%+1rem)] rounded-control px-2 py-1.5 text-left text-reading text-label-2 focus-ring transition-colors duration-(--dur-fast) hover:bg-fill-4 hover:text-label disabled:pointer-events-none"
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="pt-2">
          <Button variant="prominent" size="large" loading={writing} onClick={write}>
            Write Script
          </Button>
        </div>
      </section>

      <section aria-labelledby={`${id}-upload`} className="flex min-w-0 flex-col gap-3">
        <h3 id={`${id}-upload`} className="text-title-3">
          Upload a Script
        </h3>
        <p className="text-body text-label-2">
          Already written one? It is checked for format, length and anything hard to film.
        </p>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex min-h-44 flex-col items-center justify-center gap-3 rounded-group px-4 py-6 text-center transition-colors duration-(--dur-fast)",
            dragging ? "bg-fill-2 outline-2 outline-offset-2 outline-focus" : "bg-elevated",
          )}
        >
          {upload.kind === "idle" ? (
            <>
              <Upload aria-hidden="true" className="size-6 text-label-2" />
              <p className="text-body text-label-2">Drop a script file here, or</p>
              <Button onClick={() => fileInput.current?.click()} disabled={busy}>
                Choose File
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".txt,.md,.docx,.pdf"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void uploadFile(file);
                }}
              />
            </>
          ) : (
            <div className="flex w-full flex-col items-stretch gap-3 text-left" aria-live="polite">
              <p className="flex items-center gap-2 text-body text-label">
                <FileText aria-hidden="true" className="size-(--icon) shrink-0 text-label-2" />
                <span className="min-w-0 truncate">{upload.name}</span>
              </p>
              <ProgressBar
                value={upload.kind === "uploading" ? upload.progress : null}
                aria-label="Upload progress"
              />
              <p className="text-callout text-label-2">
                {upload.kind === "uploading"
                  ? `Uploading… ${Math.round(upload.progress)}%`
                  : "Opening the script…"}
              </p>
            </div>
          )}
        </div>
        {uploadError ? (
          <p role="alert" className="text-callout text-red">
            {uploadError}
          </p>
        ) : null}
        <Hint>Text, Markdown, Word or PDF, up to 10 MB.</Hint>
      </section>
    </div>
  );
}
