import { useEffect, useMemo, useState } from "react";
import { sceneInView } from "../../_lib/review-ranges";
import { sceneIndexAt, splitScenes } from "../../_lib/scenes";
import { SceneList } from "../scene-list";
import { isSendable } from "../review-comments";
import { VersionNotes } from "../version-notes";
import type { VersionView } from "../version-types";
import { WriterNotes } from "../writer-notes";
import { placeFindings } from "./note-card";
import { prefersReducedMotion, sceneDomId } from "./review-dom";
import { ReviewSheet } from "./review-sheet";
import type { CommentApi } from "./review-types";

/** The scene outline (wide screens) beside one long sheet, for one version. */
export function ReviewBody({
  version,
  fallbackTitle,
  comments,
  onRejectAssumption,
}: {
  version: VersionView;
  fallbackTitle: string;
  comments: CommentApi | null;
  onRejectAssumption: ((assumption: VersionView["assumptions"][number]) => void) | null;
}) {
  const content = version.content ?? "";
  const scenes = useMemo(() => splitScenes(content), [content]);
  const { placed, loose } = useMemo(
    () => placeFindings(content, version.findings),
    [content, version.findings],
  );
  const [current, setCurrent] = useState(0);

  // The scene in view: the first one crossing a band just under the toolbar.
  useEffect(() => {
    if (scenes.length < 2) return;
    const elements = scenes
      .map((s) => document.getElementById(sceneDomId(s)))
      .filter((el): el is HTMLElement => el !== null);
    const flags = elements.map(() => false);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const i = elements.indexOf(entry.target as HTMLElement);
          if (i !== -1) flags[i] = entry.isIntersecting;
        }
        setCurrent((prev) => sceneInView(flags, prev));
      },
      { rootMargin: "-96px 0px -70% 0px" },
    );
    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, [scenes]);

  function jump(index: number) {
    const scene = scenes[index];
    const el = scene ? document.getElementById(sceneDomId(scene)) : null;
    if (!el) return;
    setCurrent(index);
    el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    el.focus({ preventScroll: true });
  }

  const counts = scenes.map((_, i) => {
    const checks = placed.filter((f) => sceneIndexAt(scenes, f.start) === i).length;
    const notes =
      comments?.comments.filter((c) => isSendable(c) && sceneIndexAt(scenes, c.start) === i)
        .length ?? 0;
    return checks + notes;
  });

  return (
    <div className="flex flex-1 in-3 gap-12">
      {scenes.length > 1 ? (
        <aside className="hidden w-44 shrink-0 xl:block 2xl:w-60">
          <div className="sticky top-[calc(var(--toolbar-h)+1.5rem)] -m-1 max-h-[calc(100dvh-var(--toolbar-h)-3rem)] overflow-y-auto p-1">
            <SceneList scenes={scenes} index={current} onSelect={jump} counts={counts} />
          </div>
        </aside>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        {scenes.length > 0 ? (
          <ReviewSheet
            scenes={scenes}
            content={content}
            titlePage={{ title: version.title ?? fallbackTitle, logline: version.logline }}
            findings={placed}
            comments={comments}
          />
        ) : (
          <p className="text-body text-label-2">This version has no text.</p>
        )}
        <WriterNotes version={version} onRejectAssumption={onRejectAssumption} />
        <VersionNotes version={version} looseFindings={loose} />
      </div>
    </div>
  );
}
