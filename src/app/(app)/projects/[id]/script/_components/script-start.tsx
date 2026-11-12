"use client";

import { useId, useRef, useState, useTransition, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";
import {
  AnimatedPlaceholder,
  Button,
  PageHeader,
  ProgressBar,
  Spinner,
  StatusDot,
  StatusLine,
  cn,
} from "@/ui";
import {
  createScriptUploadAction,
  finishScriptUploadAction,
  startFromBriefAction,
  startFromIdeaAction,
} from "../actions";
import { shake } from "../_lib/feedback";

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

/** Premises the empty brief writes, one after another; it rests on the first. */
const EXAMPLE_BRIEFS = [
  "An old lighthouse keeper refuses to leave her post the night the lamp finally fails.",
  "Two estranged brothers drive their father's ashes across the desert. Neither wants to arrive.",
  "A night-shift translator hears her own name in a wiretap she was never meant to hear.",
] as const;

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

/** A problem shown on the white block: ink text after a red dot (red text fails contrast on white). */
function ErrorOnWhite({ id, children }: { id?: string; children: string }) {
  return (
    <p
      id={id}
      role="alert"
      className="flex swap-in items-baseline gap-2 text-secondary text-pretty text-on-accent"
    >
      <StatusDot tone="failed" className="shrink-0 -translate-y-px" />
      <span>{children}</span>
    </p>
  );
}

/**
 * The opening of the Script stage: describing the story is the main road (the white block); an
 * upload stays beside it as the quieter alternative.
 */
export function ScriptStart({
  projectId,
  maxBriefChars,
  initialBrief,
  initialIdea = "",
}: {
  projectId: string;
  maxBriefChars: number;
  initialBrief: string;
  /** The quick idea of a failed enhanced version, to try again. */
  initialIdea?: string;
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
  const ideaField = useRef<HTMLTextAreaElement>(null);
  const [idea, setIdea] = useState(initialIdea);
  const [ideaError, setIdeaError] = useState<string | null>(null);
  const [expanding, startExpanding] = useTransition();

  const length = brief.trim().length;
  const over = brief.length > maxBriefChars;
  // The count only shows once it matters.
  const nearLimit = brief.length > maxBriefChars * 0.8;
  const busy = writing || expanding || upload.kind !== "idle";

  function expand() {
    if (idea.trim().length === 0) {
      setIdeaError("Write your idea first. A line is enough.");
      ideaField.current?.focus();
      shake(ideaField.current);
      return;
    }
    if (idea.length > maxBriefChars) {
      setIdeaError(`Shorten the idea to ${numberFormat.format(maxBriefChars)} characters.`);
      shake(ideaField.current);
      return;
    }
    setIdeaError(null);
    startExpanding(async () => {
      const result = await startFromIdeaAction(projectId, idea);
      if (!result.ok) {
        setIdeaError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function write() {
    if (length === 0) {
      setBriefError("Describe your story first. One sentence is enough.");
      area.current?.focus();
      shake(area.current);
      return;
    }
    if (over) {
      setBriefError(`Shorten the description to ${numberFormat.format(maxBriefChars)} characters.`);
      shake(area.current);
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

  const describedBy = [nearLimit ? `${id}-count` : null, briefError ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <PageHeader
        title="Script"
        description="Describe your story, grow a quick idea, or bring a script you already have."
      />

      {/* Both roads fill the page: the white block grows, the upload tile beside it. */}
      <div className="flex flex-1 flex-wrap gap-3">
        <section
          aria-labelledby={`${id}-describe`}
          className="flex min-h-105 min-w-0 flex-[2_1_420px] in-2 flex-col gap-6 rounded-block bg-accent p-8 text-on-accent max-sm:p-6"
        >
          <div className="flex flex-col gap-2.5">
            <h2 id={`${id}-describe`} className="text-heading text-balance">
              Describe Your Story
            </h2>
            <p className="max-w-(--measure) text-body text-pretty text-on-accent-2">
              A few sentences are enough.
            </p>
          </div>

          <label htmlFor={`${id}-brief`} className="sr-only">
            Your story
          </label>
          {/* The wrapper takes the field's bleed; the overlay sits inside its 2px rule, 16px top
              and 12px side padding, in its type and placeholder colour. */}
          <AnimatedPlaceholder
            lines={EXAMPLE_BRIEFS}
            empty={brief.length === 0}
            disabled={busy}
            variant="custom"
            multiline
            className="-mx-3 flex w-[calc(100%+1.5rem)] flex-1 flex-col"
            overlayClassName="inset-x-3 top-[calc(1rem+2px)] bottom-0 text-section font-regular text-on-accent-2"
          >
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
              placeholder={EXAMPLE_BRIEFS[0]}
              aria-invalid={briefError ? true : undefined}
              aria-describedby={describedBy || undefined}
              disabled={busy}
              className={cn(
                // A line field on the white block (the kit has no field for a white surface): a
                // black caret, and focus shown by its own underline turning solid black and the
                // field taking a faint grey fill (no outline ring).
                // The placeholder colour needs `!`: the global ::placeholder rule is unlayered.
                "field-sizing-content max-h-[60dvh] min-h-36 w-full flex-1 resize-none rounded-t-paper border-t-2 border-on-accent/25 bg-transparent px-3 pt-4 text-section font-regular text-on-accent caret-on-accent outline-none",
                "transition-colors duration-(--dur-press) placeholder:text-on-accent-2! focus:border-on-accent focus:bg-on-accent/5",
                "selection:bg-on-accent/15 disabled:opacity-60",
              )}
            />
          </AnimatedPlaceholder>

          {nearLimit || briefError ? (
            <div className="flex flex-col gap-2">
              {nearLimit ? (
                <p
                  id={`${id}-count`}
                  className={cn(
                    "text-meta tabular-nums",
                    over ? "font-semibold text-on-accent" : "text-on-accent-2",
                  )}
                >
                  {numberFormat.format(brief.length)} characters, up to{" "}
                  {numberFormat.format(maxBriefChars)}
                </p>
              ) : null}
              {briefError ? <ErrorOnWhite id={`${id}-error`}>{briefError}</ErrorOnWhite> : null}
            </div>
          ) : null}

          <div className="mt-auto">
            {/*
              The screen's one primary action. On the white block it is the inverse capsule (the
              kit Button has no variant for a white surface); same size as a large Button.
            */}
            <button
              type="button"
              onClick={write}
              disabled={busy}
              aria-busy={writing || undefined}
              className={cn(
                "relative inline-flex h-(--btn-lg) press items-center justify-center rounded-capsule bg-on-accent px-7 text-row font-semibold text-accent",
                "hover:bg-on-accent/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-accent",
                "disabled:pointer-events-none disabled:opacity-60",
              )}
            >
              {/* The label keeps its width while the spinner shows, like the kit Button. */}
              <span className={cn(writing && "invisible")}>Write the Script</span>
              {writing ? (
                <span className="absolute inset-0 flex items-center justify-center">
                  <Spinner size="sm" label="Writing" />
                </span>
              ) : null}
            </button>
          </div>
        </section>

        <div className="flex min-h-105 min-w-0 flex-[1_1_280px] flex-col gap-3">
          <section
            aria-labelledby={`${id}-idea`}
            className="flex in-3 flex-col gap-4 rounded-block bg-elevated p-6"
          >
            <div className="flex flex-col gap-1.5">
              <h2 id={`${id}-idea`} className="text-section text-balance">
                Quick Idea
              </h2>
              <p className="text-secondary text-pretty text-label-2">
                One line is enough. We grow it into a fuller story in your genre and look, then you
                review it like any script.
              </p>
            </div>
            <label htmlFor={`${id}-idea-field`} className="sr-only">
              Your idea
            </label>
            <textarea
              ref={ideaField}
              id={`${id}-idea-field`}
              value={idea}
              onChange={(e) => {
                setIdea(e.target.value);
                if (ideaError) setIdeaError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  expand();
                }
              }}
              placeholder="A night porter finds a guest who checked in fifty years ago."
              aria-invalid={ideaError ? true : undefined}
              aria-describedby={ideaError ? `${id}-idea-error` : undefined}
              disabled={busy}
              className={cn(
                "field-sizing-content max-h-48 min-h-16 w-full resize-none border-b border-outline bg-transparent pb-2 text-body text-label caret-label outline-none",
                "transition-colors duration-(--dur-press) placeholder:text-label-3 focus:border-label disabled:opacity-60",
              )}
            />
            {ideaError ? (
              <p
                id={`${id}-idea-error`}
                role="alert"
                className="swap-in text-secondary text-pretty text-red"
              >
                {ideaError}
              </p>
            ) : null}
            <div>
              <Button
                variant="outlined"
                onClick={expand}
                loading={expanding}
                disabled={busy && !expanding}
              >
                Expand My Idea
              </Button>
            </div>
          </section>
          <section
            aria-labelledby={`${id}-upload`}
            // Padding 10 round the drop area so its 10px corners sit concentric in the 20px block;
            // the heading keeps the block's 24px inset.
            className="flex min-w-0 flex-1 in-3 flex-col gap-5 rounded-block bg-elevated p-2.5"
          >
            <div className="flex flex-col gap-1.5 px-3.5 pt-3.5">
              <h2 id={`${id}-upload`} className="text-section text-balance">
                Upload a Script
              </h2>
              <p className="text-secondary text-pretty text-label-2">
                We check it and get it ready for review.
              </p>
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                if (!busy) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                "flex min-h-40 flex-1 flex-col items-center justify-center gap-3 rounded-row border border-dashed p-4 text-center",
                "transition-colors duration-(--dur-press)",
                dragging ? "border-label bg-fill-4" : "border-outline",
              )}
            >
              {upload.kind === "idle" ? (
                <>
                  <p className="text-secondary text-label-3">
                    Drop a file here
                    <span className="block">Text, Markdown, Word or PDF, up to 10 MB</span>
                  </p>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => fileInput.current?.click()}
                    disabled={busy}
                  >
                    Choose a File
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
                <div
                  className="flex w-full swap-in flex-col items-stretch gap-3 text-left"
                  aria-live="polite"
                >
                  <p className="flex items-center gap-2 text-body text-label">
                    <FileText
                      aria-hidden="true"
                      className="size-(--icon) shrink-0 text-label-2"
                      strokeWidth={1.5}
                    />
                    <span className="min-w-0 truncate font-mono text-secondary">{upload.name}</span>
                  </p>
                  <ProgressBar
                    value={upload.kind === "uploading" ? upload.progress : null}
                    aria-label="Upload progress"
                  />
                  <StatusLine tone="working">
                    {upload.kind === "uploading" ? (
                      <>
                        Uploading{" "}
                        <span className="tabular-nums">{Math.round(upload.progress)}%</span>
                      </>
                    ) : (
                      "Opening the script"
                    )}
                  </StatusLine>
                </div>
              )}
            </div>
            {uploadError ? (
              <p role="alert" className="swap-in px-3.5 pb-3.5 text-secondary text-pretty text-red">
                {uploadError}
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </>
  );
}
