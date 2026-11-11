"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, cn, type BadgeTone } from "@/ui";
import { findQuote } from "../_lib/screenplay";
import { submitReviewAction } from "../actions";
import { RequestChangesSheet } from "./request-changes-sheet";
import {
  CommentComposer,
  CommentEditor,
  useDraftComments,
  type DraftComment,
} from "./review-comments";
import {
  ScriptDocument,
  type DocumentHighlight,
  type PassagePick,
  type ScriptDocumentHandle,
} from "./script-document";
import {
  InspectorSection,
  ReadOnlyBar,
  TitleBlock,
  VersionList,
  useVersionViewer,
  type IssueChoice,
  type VersionSummary,
  type VersionView,
} from "./shared";

type Finding = NonNullable<VersionView["findings"]>[number];

const SEVERITY: Record<Finding["severity"], { label: string; tone: BadgeTone }> = {
  blocker: { label: "Must Fix", tone: "danger" },
  major: { label: "Important", tone: "warning" },
  minor: { label: "Minor", tone: "neutral" },
};

const CATEGORY: Record<Finding["category"], string> = {
  duration: "Length",
  filmability: "Hard to Film",
  format: "Format",
  continuity: "Continuity",
  structure: "Structure",
  character: "Characters",
  dialogue: "Dialogue",
  project_fit: "Fit with the Style",
  safety: "Content",
  other: "Other",
};

/** The notes that came with a version, titled by where it came from. */
export function VersionNotes({ version }: { version: VersionView }) {
  if (version.notes.length === 0) return null;
  const title =
    version.source === "revised"
      ? "What Changed"
      : version.source === "uploaded"
        ? "Script Check"
        : "Writer’s Notes";
  const verdict =
    version.checkVerdict === "ready" ? (
      <Badge tone="success">Ready to Film</Badge>
    ) : version.checkVerdict === "needs_attention" ? (
      <Badge tone="warning">Needs Attention</Badge>
    ) : null;
  return (
    <InspectorSection title={title} accessory={verdict}>
      <ul className="flex flex-col gap-2.5">
        {version.notes.map((note, i) => (
          <li key={i} className="text-body text-pretty text-label-2">
            {note}
          </li>
        ))}
      </ul>
    </InspectorSection>
  );
}

function FindingsList({
  findings,
  content,
  activeIndex,
  onChoose,
}: {
  findings: Finding[];
  content: string;
  activeIndex: number | null;
  onChoose: (index: number, range: { start: number; end: number }) => void;
}) {
  return (
    <InspectorSection
      title="Findings"
      accessory={<span className="text-callout text-label-2 tabular-nums">{findings.length}</span>}
    >
      {findings.length === 0 ? (
        <p className="text-body text-label-2">Nothing to fix was found.</p>
      ) : (
        <ul className="-mx-2 flex flex-col gap-1">
          {findings.map((finding, index) => {
            const range = finding.quote ? findQuote(content, finding.quote) : null;
            const severity = SEVERITY[finding.severity];
            const body = (
              <>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={severity.tone}>{severity.label}</Badge>
                  <span className="text-callout text-label-2">{CATEGORY[finding.category]}</span>
                </span>
                {finding.quote ? (
                  <span className="line-clamp-2 text-callout text-label-2 italic">
                    “{finding.quote}”
                  </span>
                ) : null}
                <span className="text-body text-label">{finding.explanation}</span>
                {finding.suggestion ? (
                  <span className="text-body text-label-2">{finding.suggestion}</span>
                ) : null}
                {!range ? (
                  <span className="text-callout text-label-2">
                    {finding.quote
                      ? "The quoted line is not in the text."
                      : "About the whole script."}
                  </span>
                ) : null}
              </>
            );
            return (
              <li key={index}>
                {range ? (
                  <button
                    type="button"
                    aria-pressed={activeIndex === index}
                    onClick={() => onChoose(index, range)}
                    className={cn(
                      "flex w-full flex-col items-start gap-1.5 rounded-control px-2 py-2.5 text-left focus-ring",
                      "transition-colors duration-(--dur-fast) hover:bg-fill-4",
                      activeIndex === index && "bg-selection hover:bg-selection",
                    )}
                  >
                    {body}
                  </button>
                ) : (
                  <div className="flex flex-col items-start gap-1.5 px-2 py-2.5">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </InspectorSection>
  );
}

function CommentsList({
  comments,
  activeId,
  onChoose,
  onUpdate,
  onRemove,
}: {
  comments: DraftComment[];
  activeId: string | null;
  onChoose: (comment: DraftComment) => void;
  onUpdate: (id: string, note: string) => void;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <InspectorSection
      title="Comments"
      accessory={
        comments.length > 0 ? (
          <span className="text-callout text-label-2 tabular-nums">{comments.length}</span>
        ) : null
      }
    >
      {comments.length === 0 ? (
        <p className="text-body text-label-2">
          Select text in the script to comment on it. With the keyboard, move to a line and press
          Enter.
        </p>
      ) : (
        <ul className="-mx-2 flex flex-col gap-1">
          {comments.map((comment) => (
            <li
              key={comment.id}
              className={cn(
                "flex flex-col gap-1.5 rounded-control px-2 py-2.5",
                activeId === comment.id && "bg-selection",
              )}
            >
              <button
                type="button"
                onClick={() => onChoose(comment)}
                className="line-clamp-2 rounded-control-inner text-left text-callout text-label-2 italic focus-ring hover:text-label"
              >
                “{comment.quote}”
              </button>
              {editing === comment.id ? (
                <CommentEditor
                  initial={comment.note}
                  confirmLabel="Save"
                  onConfirm={(note) => {
                    onUpdate(comment.id, note);
                    setEditing(null);
                  }}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <>
                  <p className="text-body whitespace-pre-wrap text-label">{comment.note}</p>
                  <div className="-ml-2 flex gap-1">
                    <Button variant="plain" onClick={() => setEditing(comment.id)}>
                      Edit
                    </Button>
                    <Button variant="plain" onClick={() => onRemove(comment.id)}>
                      Remove
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </InspectorSection>
  );
}

export function ScriptReview({
  projectId,
  fallbackTitle,
  version,
  versions,
  issues,
  sample,
}: {
  projectId: string;
  fallbackTitle: string;
  version: VersionView;
  versions: VersionSummary[];
  issues: IssueChoice[];
  sample: boolean;
}) {
  const router = useRouter();
  const content = version.content ?? "";
  const doc = useRef<ScriptDocumentHandle>(null);
  const drafts = useDraftComments(version.id, content);
  const viewer = useVersionViewer(projectId, version.id);
  const [pick, setPick] = useState<PassagePick | null>(null);
  const [focus, setFocus] = useState<{ key: string; start: number; end: number } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sending, startSending] = useTransition();
  const [accepting, startAccepting] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const shown = viewer.viewing ?? version;
  const readOnly = viewer.viewing !== null;
  const shownContent = shown.content ?? "";

  const highlights = useMemo<DocumentHighlight[]>(() => {
    const list: DocumentHighlight[] = readOnly
      ? []
      : drafts.comments.map((c) => ({ id: c.id, start: c.start, end: c.end, kind: "comment" }));
    if (focus) list.push({ id: focus.key, start: focus.start, end: focus.end, kind: "focus" });
    return list;
  }, [drafts.comments, focus, readOnly]);

  function reveal(key: string, range: { start: number; end: number }) {
    setFocus({ key, ...range });
    doc.current?.reveal(range.start);
  }

  function accept() {
    setError(null);
    startAccepting(async () => {
      const result = await submitReviewAction(projectId, version.id, { decision: "accepted" });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      drafts.clear();
      router.refresh();
    });
  }

  function requestChanges(input: { issueCodes: string[]; note: string }) {
    setSheetError(null);
    startSending(async () => {
      const result = await submitReviewAction(projectId, version.id, {
        decision: "rejected",
        issueCodes: input.issueCodes,
        note: input.note || undefined,
        comments: drafts.comments.map(({ quote, start, end, note }) => ({
          quote,
          start,
          end,
          note,
        })),
      });
      if (!result.ok) {
        setSheetError(result.error);
        return;
      }
      drafts.clear();
      setSheetOpen(false);
      router.refresh();
    });
  }

  const findings = shown.findings;
  const focusedFinding = focus?.key.startsWith("finding-") ? Number(focus.key.slice(8)) : null;
  const focusedComment = focus && !focus.key.startsWith("finding-") ? focus.key : null;

  return (
    <div className="flex flex-col gap-8">
      <div className="sticky top-(--toolbar-h) z-(--z-toolbar) -mx-(--content-x) flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-ground px-(--content-x) py-3 hairline-b">
        <p className="text-callout text-label-2">
          {readOnly ? (
            <>Reading version {shown.versionNumber}</>
          ) : (
            <>
              Version {version.versionNumber} is ready for review
              {drafts.comments.length > 0
                ? ` · ${drafts.comments.length} ${drafts.comments.length === 1 ? "comment" : "comments"}`
                : ""}
            </>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => {
              setSheetError(null);
              setSheetOpen(true);
            }}
            disabled={readOnly || accepting}
          >
            Request Changes
          </Button>
          <Button
            variant="prominent"
            onClick={accept}
            loading={accepting}
            disabled={readOnly || sending}
          >
            Accept
          </Button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="-mt-4 text-callout text-red">
          {error}
        </p>
      ) : null}

      <div className="grid items-start gap-x-14 gap-y-12 @4xl:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)]">
        <article aria-labelledby="script-title" className="flex min-w-0 flex-col gap-10">
          {readOnly ? <ReadOnlyBar version={shown} onBack={viewer.back} /> : null}
          <TitleBlock version={shown} fallbackTitle={fallbackTitle} sample={sample} />
          <ScriptDocument
            ref={doc}
            content={shownContent}
            highlights={highlights}
            onPick={
              readOnly
                ? undefined
                : (p) => {
                    setFocus(null);
                    setPick(p);
                  }
            }
            overlay={
              pick && !readOnly ? (
                <CommentComposer
                  pick={pick}
                  onCancel={() => {
                    setPick(null);
                    doc.current?.focusAt(pick.start);
                  }}
                  onAdd={(note) => {
                    drafts.add(pick, note);
                    setPick(null);
                    window.getSelection()?.removeAllRanges();
                    doc.current?.focusAt(pick.start);
                  }}
                />
              ) : null
            }
            className="max-w-[72ch]"
            aria-label="Script. Select text to comment on it."
          />
        </article>

        <aside
          aria-label="Review"
          className={cn(
            "flex min-w-0 flex-col gap-5",
            "@4xl:sticky @4xl:top-[calc(var(--toolbar-h)+4.5rem)] @4xl:-mx-2 @4xl:max-h-[calc(100dvh-var(--toolbar-h)-6rem)] @4xl:overflow-x-hidden @4xl:overflow-y-auto @4xl:px-2",
          )}
        >
          <VersionNotes version={shown} />
          {findings ? (
            <FindingsList
              findings={findings}
              content={shownContent}
              activeIndex={focusedFinding}
              onChoose={(index, range) => reveal(`finding-${index}`, range)}
            />
          ) : null}
          {!readOnly ? (
            <CommentsList
              comments={drafts.comments}
              activeId={focusedComment}
              onChoose={(c) => reveal(c.id, c)}
              onUpdate={drafts.update}
              onRemove={(id) => {
                drafts.remove(id);
                if (focus?.key === id) setFocus(null);
              }}
            />
          ) : null}
          {versions.length > 1 ? (
            <VersionList
              versions={versions}
              selectedId={shown.id}
              loadingId={viewer.loadingId}
              error={viewer.error}
              onSelect={viewer.open}
            />
          ) : null}
        </aside>
      </div>

      <RequestChangesSheet
        open={sheetOpen}
        onOpenChange={(open) => {
          if (!sending) setSheetOpen(open);
        }}
        issues={issues}
        commentCount={drafts.comments.length}
        sending={sending}
        serverError={sheetError}
        onSubmit={requestChanges}
      />
    </div>
  );
}
