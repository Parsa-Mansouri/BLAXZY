"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, PageHeader, StatusLine, cn, useToast } from "@/ui";
import { submitReviewAction } from "../actions";
import { ApplyCommentsDock } from "./apply-comments-dock";
import { RequestChangesSheet } from "./request-changes-sheet";
import { MAX_COMMENT_CHARS, isSendable, useDraftComments } from "./review-comments";
import { ReviewBody } from "./script-review/review-body";
import { useVersionViewer } from "./use-version-viewer";
import { SAMPLE_LINE, type VersionSummary, type VersionView } from "./version-types";
import { VersionTabs } from "./version-viewer";

export function ScriptReview({
  projectId,
  fallbackTitle,
  version,
  versions,
  sample,
}: {
  projectId: string;
  fallbackTitle: string;
  version: VersionView;
  versions: VersionSummary[];
  sample: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const content = version.content ?? "";
  const drafts = useDraftComments(version.id, content);
  const viewer = useVersionViewer(projectId, version.id);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sending, startSending] = useTransition();
  const [accepting, startAccepting] = useTransition();
  const [applying, startApplying] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  // A prefilled note (turning down one of the writer's assumptions) remounts the sheet.
  const [prefill, setPrefill] = useState<{ key: number; note: string }>({ key: 0, note: "" });

  function openSheet(note = "") {
    setSheetError(null);
    setPrefill((p) => ({ key: p.key + 1, note }));
    setSheetOpen(true);
  }

  const shown = viewer.viewing ?? version;
  const readOnly = viewer.viewing !== null;
  const sendable = drafts.comments.filter(isSendable);

  function accept() {
    setError(null);
    startAccepting(async () => {
      const result = await submitReviewAction(projectId, version.id, { decision: "accepted" });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      drafts.clear();
      toast.success("Script accepted.");
      router.refresh();
    });
  }

  function submitRejection(
    extra: { issueCodes?: string[]; note?: string },
    run: typeof startSending,
    fail: (message: string) => void,
    done: () => void,
    success: string,
  ) {
    if (drafts.comments.some((c) => c.note.trim().length > MAX_COMMENT_CHARS)) {
      fail("One of your comments is over 4,000 characters. Shorten it first.");
      return;
    }
    run(async () => {
      const result = await submitReviewAction(projectId, version.id, {
        decision: "rejected",
        ...extra,
        comments: sendable.map(({ quote, start, end, note }) => ({
          quote,
          start,
          end,
          note: note.trim(),
        })),
      });
      if (!result.ok) {
        fail(result.error);
        return;
      }
      drafts.clear();
      done();
      toast.success(success);
      router.refresh();
    });
  }

  function requestChanges(input: { issueCodes: string[]; note: string }) {
    setSheetError(null);
    submitRejection(
      { issueCodes: input.issueCodes, note: input.note || undefined },
      startSending,
      setSheetError,
      () => setSheetOpen(false),
      "Changes requested.",
    );
  }

  function applyComments() {
    setApplyError(null);
    submitRejection({}, startApplying, setApplyError, () => {}, "Applying your comments.");
  }

  const showDock = !readOnly && sendable.length > 0;

  return (
    <>
      <PageHeader
        title="Script"
        description="Highlight any passage to comment on it and apply your comments, or accept the script or request general changes."
        actions={
          <>
            <Button
              variant="outlined"
              size="large"
              onClick={() => openSheet()}
              disabled={readOnly || accepting || applying}
            >
              Request Changes
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={accept}
              loading={accepting}
              disabled={readOnly || sending || applying}
            >
              Accept Script
            </Button>
          </>
        }
      />
      {error ? (
        <p role="alert" className="-mt-4 mb-6 text-secondary text-red">
          {error}
        </p>
      ) : null}
      {sample || shown.isSample ? (
        <StatusLine className="mb-6 in-1">{SAMPLE_LINE}</StatusLine>
      ) : null}

      <VersionTabs versions={versions} shownId={shown.id} viewer={viewer} />

      <div className={cn("flex flex-1 flex-col", showDock && "pb-28")}>
        <ReviewBody
          key={shown.id}
          version={shown}
          fallbackTitle={fallbackTitle}
          comments={readOnly ? null : drafts}
          onRejectAssumption={
            readOnly
              ? null
              : (a) =>
                  openSheet(
                    `Leave this out and keep the story working without it (scene ${a.sceneNumber}): ${a.text}`,
                  )
          }
        />
      </div>

      {showDock ? (
        <ApplyCommentsDock
          count={sendable.length}
          applying={applying}
          disabled={sending || accepting}
          error={applyError}
          onApply={applyComments}
        />
      ) : null}

      <RequestChangesSheet
        key={prefill.key}
        initialNote={prefill.note}
        open={sheetOpen}
        onOpenChange={(open) => {
          if (!sending) setSheetOpen(open);
        }}
        commentCount={sendable.length}
        sending={sending}
        serverError={sheetError}
        onSubmit={requestChanges}
      />
    </>
  );
}
