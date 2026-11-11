"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { stageHref } from "@/lib/stages";
import { Button, PageHeader, StatusLine, SwapFade, cn } from "@/ui";
import type { BackgroundStatus } from "../../_lib/background-status";
import { splitScenes } from "../_lib/scenes";
import { editAcceptedAction } from "../actions";
import { BackgroundFailure, useBackgroundStatus } from "./background-status";
import { ON_PAPER, PaperLayers, ReadingSheet, SHEET_X, TitlePage } from "./screenplay-sheet";
import {
  SAMPLE_LINE,
  SceneList,
  ScenesLayout,
  VersionNotes,
  VersionTabs,
  sceneName,
  statusLabel,
  useVersionViewer,
  type VersionSummary,
  type VersionView,
} from "./shared";

/** The accepted script (or an older version) read one scene at a time, on paper. */
function AcceptedBody({
  version,
  fallbackTitle,
  side,
}: {
  version: VersionView;
  fallbackTitle: string;
  side: ReactNode;
}) {
  const content = version.content ?? "";
  const scenes = useMemo(() => splitScenes(content), [content]);
  const [index, setIndex] = useState(0);
  const scene = scenes[Math.min(index, scenes.length - 1)];

  return (
    <ScenesLayout
      side={
        <>
          {side}
          {scenes.length > 1 ? (
            <SceneList scenes={scenes} index={index} onSelect={setIndex} />
          ) : null}
        </>
      }
    >
      {scene ? (
        <SwapFade swapKey={scene.key}>
          <ReadingSheet
            aria-label={sceneName(scene)}
            scenes={[scene]}
            top={
              index === 0 ? (
                <TitlePage title={version.title ?? fallbackTitle} logline={version.logline} />
              ) : null
            }
          />
        </SwapFade>
      ) : (
        <p className="text-body text-label-2">This version has no text.</p>
      )}
      <VersionNotes version={version} />
    </ScenesLayout>
  );
}

export function ScriptAccepted({
  projectId,
  fallbackTitle,
  version,
  versions,
  background,
  sample,
}: {
  projectId: string;
  fallbackTitle: string;
  version: VersionView;
  versions: VersionSummary[];
  background: BackgroundStatus | null;
  sample: boolean;
}) {
  const router = useRouter();
  const viewer = useVersionViewer(projectId, version.id);
  const [status, setStatus] = useBackgroundStatus(projectId, version.id, background);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(version.content ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const shown = viewer.viewing ?? version;
  const readOnly = viewer.viewing !== null;

  function startEditing() {
    viewer.back();
    setDraft(version.content ?? "");
    setError(null);
    setEditing(true);
  }

  function save() {
    if (!draft.trim()) {
      setError("The script cannot be empty.");
      return;
    }
    setError(null);
    startSaving(async () => {
      const result = await editAcceptedAction(projectId, draft);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  const unchanged = draft.replace(/\r\n?/g, "\n").trim() === (version.content ?? "").trim();

  const side = (
    <div className="flex flex-col gap-4 px-3.5 pb-6 hairline-b">
      <StatusLine tone={shown.status === "accepted" ? "done" : "none"} srPrefix="Status">
        {statusLabel(shown.status)}
      </StatusLine>
      {!readOnly && status?.state === "failed" ? (
        <BackgroundFailure
          projectId={projectId}
          status={status}
          onRetried={() => {
            setStatus({ ...status, state: "running", failure: null, detected: false });
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );

  return (
    <>
      <PageHeader
        title="Script"
        description={
          editing
            ? "After you save, characters, places and shots are found again, and changed shots are marked to be made again."
            : "This is the version the film is built from."
        }
        actions={
          editing ? (
            <>
              <Button variant="plain" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
              <Button variant="primary" onClick={save} loading={saving} disabled={unchanged}>
                Save Changes
              </Button>
            </>
          ) : (
            <>
              <Button variant="outlined" onClick={startEditing}>
                Edit Script
              </Button>
              <Button
                variant="primary"
                render={<Link href={stageHref(projectId, "pre_production")} />}
              >
                Continue to Pre-production
              </Button>
            </>
          )
        }
      />
      {(sample || shown.isSample) && !readOnly && shown.source !== "edited" ? (
        <StatusLine className="mb-6 in-1">{SAMPLE_LINE}</StatusLine>
      ) : null}

      {editing ? (
        <div className="flex max-w-170 swap-in flex-col gap-3">
          <div className="relative isolate">
            <PaperLayers className="right-0" />
            <textarea
              aria-label="Script text"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (error) setError(null);
              }}
              autoFocus
              spellCheck
              className={cn(
                "block field-sizing-content min-h-[60dvh] w-full resize-none rounded-paper bg-transparent py-11 font-script text-script text-ink outline-none",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--focus)",
                SHEET_X,
                ON_PAPER,
              )}
            />
          </div>
          {error ? (
            <p role="alert" className="text-secondary text-red">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <VersionTabs versions={versions} shownId={shown.id} viewer={viewer} />
          <AcceptedBody key={shown.id} version={shown} fallbackTitle={fallbackTitle} side={side} />
        </>
      )}
    </>
  );
}
