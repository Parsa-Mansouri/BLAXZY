"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { stageHref } from "@/lib/stages";
import { Badge, Button, Hint, Textarea, cn } from "@/ui";
import type { BackgroundStatus } from "../../_lib/background-status";
import { editAcceptedAction } from "../actions";
import { BackgroundStatusView, useBackgroundStatus } from "./background-status";
import { VersionNotes } from "./script-review";
import { ScriptDocument } from "./script-document";
import {
  InspectorSection,
  ReadOnlyBar,
  TitleBlock,
  VersionList,
  useVersionViewer,
  type VersionSummary,
  type VersionView,
} from "./shared";

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

  return (
    <div className="flex flex-col gap-8">
      <div className="sticky top-(--toolbar-h) z-(--z-toolbar) -mx-(--content-x) flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-ground px-(--content-x) py-3 hairline-b">
        <p className="text-callout text-label-2">
          {editing
            ? "Editing the accepted script"
            : readOnly
              ? `Reading version ${shown.versionNumber}`
              : "The script is accepted"}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <Button variant="plain" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
              <Button variant="prominent" onClick={save} loading={saving} disabled={unchanged}>
                Save Changes
              </Button>
            </>
          ) : (
            <>
              <Button onClick={startEditing}>Edit Script</Button>
              <Button
                variant="prominent"
                trailingIcon={<ArrowRight aria-hidden="true" />}
                render={<Link href={stageHref(projectId, "pre_production")} />}
              >
                Continue to Pre-production
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid items-start gap-x-14 gap-y-12 @4xl:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)]">
        <article aria-labelledby="script-title" className="flex min-w-0 flex-col gap-10">
          {readOnly ? <ReadOnlyBar version={shown} onBack={viewer.back} /> : null}
          <TitleBlock
            version={shown}
            fallbackTitle={fallbackTitle}
            sample={sample && !readOnly && shown.source !== "edited"}
            status={
              shown.status === "accepted" ? <Badge tone="success">Accepted</Badge> : undefined
            }
          />
          {editing ? (
            <div className="flex max-w-[72ch] flex-col gap-3">
              <Hint id="edit-hint">
                After you save, characters, places and shots are detected again. Shots whose part of
                the script changed are marked to be made again.
              </Hint>
              <Textarea
                aria-describedby="edit-hint"
                aria-label="Script text"
                textStyle="script"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (error) setError(null);
                }}
                minRows={16}
                maxRows={40}
                autoFocus
                spellCheck
              />
              {error ? (
                <p role="alert" className="text-callout text-red">
                  {error}
                </p>
              ) : null}
            </div>
          ) : (
            <ScriptDocument
              content={shown.content ?? ""}
              className="max-w-[72ch]"
              aria-label="Script"
            />
          )}
        </article>

        <aside
          aria-label="Script details"
          className={cn(
            "flex min-w-0 flex-col gap-5",
            "@4xl:sticky @4xl:top-[calc(var(--toolbar-h)+4.5rem)] @4xl:-mx-2 @4xl:max-h-[calc(100dvh-var(--toolbar-h)-6rem)] @4xl:overflow-x-hidden @4xl:overflow-y-auto @4xl:px-2",
          )}
        >
          {status ? (
            <InspectorSection title="Pre-production">
              <BackgroundStatusView
                projectId={projectId}
                status={status}
                onRetried={() => {
                  setStatus({ ...status, state: "running", failure: null, detected: false });
                  router.refresh();
                }}
              />
            </InspectorSection>
          ) : null}
          <VersionNotes version={shown} />
          {versions.length > 1 ? (
            <VersionList
              versions={versions}
              selectedId={shown.id}
              loadingId={viewer.loadingId}
              error={viewer.error}
              onSelect={(id) => {
                setEditing(false);
                viewer.open(id);
              }}
            />
          ) : null}
        </aside>
      </div>
    </div>
  );
}
