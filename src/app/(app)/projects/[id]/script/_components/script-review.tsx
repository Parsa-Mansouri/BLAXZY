"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquarePlus } from "lucide-react";
import { Button, PageHeader, StatusLine, SwapFade, cn } from "@/ui";
import { blockIndexAt, sceneIndexAt, splitScenes, type Scene } from "../_lib/scenes";
import { findQuote } from "../_lib/screenplay";
import { submitReviewAction } from "../actions";
import { RequestChangesSheet } from "./request-changes-sheet";
import { LineComment, isSendable, useDraftComments, type DraftComment } from "./review-comments";
import { BlockText, ON_PAPER, PaperLayers, SHEET_X, TitlePage } from "./screenplay-sheet";
import {
  FindingNote,
  SAMPLE_LINE,
  SceneList,
  ScenesLayout,
  VersionNotes,
  VersionTabs,
  sceneName,
  useVersionViewer,
  type Finding,
  type IssueChoice,
  type VersionSummary,
  type VersionView,
} from "./shared";

interface PlacedFinding {
  finding: Finding;
  scene: number;
  block: number;
}

/** Findings that quote a line go beside it; the rest are about the whole script. */
function placeFindings(content: string, scenes: Scene[], findings: Finding[] | null) {
  const placed: PlacedFinding[] = [];
  const loose: Finding[] = [];
  for (const finding of findings ?? []) {
    const range = finding.quote ? findQuote(content, finding.quote) : null;
    if (!range || scenes.length === 0) {
      loose.push(finding);
      continue;
    }
    const scene = sceneIndexAt(scenes, range.start);
    const blocks = scenes[scene]?.blocks ?? [];
    placed.push({ finding, scene, block: blockIndexAt(blocks, range.start) });
  }
  return { placed, loose };
}

interface CommentApi {
  comments: DraftComment[];
  add: (range: { start: number; end: number; quote: string }) => DraftComment;
  update: (id: string, note: string) => void;
  remove: (id: string) => void;
}

/**
 * One scene on the paper with the margin beside it. With room (about 800px), each line's
 * comments and script checks sit in a 224px column on the black beside the line; with less, they
 * sit under their line on the sheet, in a dark card. Point at a line (or tab to it) to comment.
 */
function ReviewSheet({
  scene,
  sceneIndex,
  content,
  titlePage,
  findings,
  comments,
}: {
  scene: Scene;
  sceneIndex: number;
  content: string;
  titlePage: { title: string; logline: string | null } | null;
  findings: PlacedFinding[];
  /** Null on an older version: read only. */
  comments: CommentApi | null;
}) {
  const [focusId, setFocusId] = useState<string | null>(null);

  function focusAdd(start: number) {
    requestAnimationFrame(() => document.getElementById(`comment-on-${start}`)?.focus());
  }

  return (
    <div className="@container">
      <article
        aria-label={sceneName(scene)}
        className={cn(
          "relative isolate flex flex-col gap-6 py-11 font-script text-script text-ink",
          "[--sheet-w:100%] @min-[50rem]:[--sheet-w:min(42.5rem,100%_-_15.5rem)]",
        )}
      >
        <PaperLayers className="w-(--sheet-w)" />
        {titlePage ? (
          <div className={cn("w-(--sheet-w)", SHEET_X, ON_PAPER)}>
            <TitlePage title={titlePage.title} logline={titlePage.logline} />
          </div>
        ) : null}
        {scene.blocks.map((block, b) => {
          const lineId = `line-${block.start}`;
          const own =
            comments?.comments.filter((c) => blockIndexAt(scene.blocks, c.start) === b) ?? [];
          const checks = findings.filter((f) => f.scene === sceneIndex && f.block === b);
          const marked = own.length > 0;
          const canAdd = comments !== null && own.length === 0;
          const hasSide = own.length > 0 || checks.length > 0;
          return (
            <div
              key={block.start}
              className="group/line relative flex flex-col @min-[50rem]:flex-row @min-[50rem]:items-start @min-[50rem]:gap-6"
            >
              <div className={cn("w-(--sheet-w) shrink-0", SHEET_X, ON_PAPER)}>
                <div
                  className={cn(
                    "-mx-2 rounded-[4px] px-2 py-0.5 transition-colors duration-(--dur-press)",
                    marked ? "bg-ink/10" : "group-hover/line:bg-ink/5",
                  )}
                >
                  <BlockText block={block} id={lineId} />
                </div>
              </div>

              <div
                className={cn(
                  "flex shrink-0 flex-col gap-3 font-sans text-body text-label",
                  "@min-[50rem]:w-56",
                )}
              >
                {hasSide ? (
                  <div
                    className={cn(
                      "mx-[clamp(20px,4vw,48px)] mt-3 flex flex-col gap-3 rounded-tile bg-elevated p-3",
                      "@min-[50rem]:mx-0 @min-[50rem]:mt-0 @min-[50rem]:bg-transparent @min-[50rem]:p-0",
                    )}
                  >
                    {checks.map((c, i) => (
                      <FindingNote key={i} finding={c.finding} />
                    ))}
                    {comments
                      ? own.map((c) => (
                          <LineComment
                            key={c.id}
                            comment={c}
                            autoFocus={c.id === focusId}
                            describedBy={lineId}
                            onChange={(note) => comments.update(c.id, note)}
                            onRemove={() => {
                              comments.remove(c.id);
                              focusAdd(block.start);
                            }}
                          />
                        ))
                      : null}
                  </div>
                ) : null}

                {canAdd ? (
                  <div
                    className={cn(
                      "absolute top-full right-[clamp(20px,4vw,48px)] z-10 -translate-y-1",
                      "@min-[50rem]:static @min-[50rem]:translate-y-0",
                    )}
                  >
                    <button
                      type="button"
                      id={`comment-on-${block.start}`}
                      aria-label="Comment on this line"
                      aria-describedby={lineId}
                      onClick={() => {
                        if (!comments) return;
                        const comment = comments.add({
                          start: block.start,
                          end: block.end,
                          quote: content.slice(block.start, block.end),
                        });
                        setFocusId(comment.id);
                      }}
                      className={cn(
                        "flex press items-center justify-center rounded-capsule text-meta focus-ring",
                        "opacity-0 transition-opacity duration-(--dur-press) group-hover/line:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
                        // Narrow: a round icon on the paper, in the gap under the line.
                        "size-7 border border-ink/30 bg-paper text-ink focus-visible:outline-ink",
                        // Wide: the outlined "Comment" pill on the black beside the line.
                        "@min-[50rem]:h-7 @min-[50rem]:w-auto @min-[50rem]:border-outline @min-[50rem]:bg-transparent @min-[50rem]:px-3 @min-[50rem]:text-label-2 @min-[50rem]:hover:text-label @min-[50rem]:focus-visible:outline-(--focus)",
                      )}
                    >
                      <MessageSquarePlus
                        aria-hidden="true"
                        className="size-3.5 @min-[50rem]:hidden"
                        strokeWidth={1.75}
                      />
                      <span aria-hidden="true" className="hidden @min-[50rem]:inline">
                        Comment
                      </span>
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </article>
    </div>
  );
}

/** The scene list and the sheet for one version (keyed by version, so the scene resets). */
function ReviewBody({
  version,
  fallbackTitle,
  comments,
}: {
  version: VersionView;
  fallbackTitle: string;
  comments: CommentApi | null;
}) {
  const content = version.content ?? "";
  const scenes = useMemo(() => splitScenes(content), [content]);
  const [index, setIndex] = useState(0);
  const { placed, loose } = useMemo(
    () => placeFindings(content, scenes, version.findings),
    [content, scenes, version.findings],
  );

  const counts = scenes.map(
    (_, i) =>
      placed.filter((f) => f.scene === i).length +
      (comments?.comments.filter((c) => c.note.trim() !== "" && sceneIndexAt(scenes, c.start) === i)
        .length ?? 0),
  );
  const scene = scenes[Math.min(index, scenes.length - 1)];
  const title = version.title ?? fallbackTitle;

  return (
    <ScenesLayout
      side={
        scenes.length > 1 ? (
          <SceneList scenes={scenes} index={index} onSelect={setIndex} counts={counts} />
        ) : null
      }
    >
      {scene ? (
        <SwapFade swapKey={scene.key}>
          <ReviewSheet
            scene={scene}
            sceneIndex={index}
            content={content}
            titlePage={index === 0 ? { title, logline: version.logline } : null}
            findings={placed}
            comments={comments}
          />
        </SwapFade>
      ) : (
        <p className="text-body text-label-2">This version has no text.</p>
      )}
      <VersionNotes version={version} looseFindings={loose} />
    </ScenesLayout>
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
  const drafts = useDraftComments(version.id, content);
  const viewer = useVersionViewer(projectId, version.id);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sending, startSending] = useTransition();
  const [accepting, startAccepting] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);

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
      router.refresh();
    });
  }

  function requestChanges(input: { issueCodes: string[]; note: string }) {
    setSheetError(null);
    if (drafts.comments.some((c) => c.note.trim().length > 4000)) {
      setSheetError("One of your comments is over 4,000 characters. Shorten it first.");
      return;
    }
    startSending(async () => {
      const result = await submitReviewAction(projectId, version.id, {
        decision: "rejected",
        issueCodes: input.issueCodes,
        note: input.note || undefined,
        comments: sendable.map(({ quote, start, end, note }) => ({
          quote,
          start,
          end,
          note: note.trim(),
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

  return (
    <>
      <PageHeader
        title="Script"
        description="Comment on any line, then accept it or ask for changes."
        actions={
          <>
            <Button
              variant="outlined"
              onClick={() => {
                setSheetError(null);
                setSheetOpen(true);
              }}
              disabled={readOnly || accepting}
            >
              Request Changes
            </Button>
            <Button
              variant="primary"
              onClick={accept}
              loading={accepting}
              disabled={readOnly || sending}
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

      <ReviewBody
        key={shown.id}
        version={shown}
        fallbackTitle={fallbackTitle}
        comments={readOnly ? null : drafts}
      />

      <RequestChangesSheet
        open={sheetOpen}
        onOpenChange={(open) => {
          if (!sending) setSheetOpen(open);
        }}
        issues={issues}
        commentCount={sendable.length}
        sending={sending}
        serverError={sheetError}
        onSubmit={requestChanges}
      />
    </>
  );
}
