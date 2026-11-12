"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { stageLabel } from "@/lib/stages";
import {
  Alert,
  Button,
  Field,
  Input,
  PictureTile,
  Sheet,
  StatusLine,
  stagger,
  useToast,
} from "@/ui";
import { archiveProjectAction, renameProjectAction } from "../actions";
import { projectHref, stageLine, stageTone, type ProjectSummary } from "../_lib/summary";

const RENAME_FORM_ID = "rename-project-form";

/**
 * A film on the shelf (Home.dc.html, Projects.dc.html): its title on a flat tile, and on hover or
 * keyboard focus a panel slides up over the whole tile with Continue, Rename and Archive.
 */
export function ProjectTile({
  project,
  index,
  baseDelay,
  onRenamed,
  onArchived,
}: {
  project: ProjectSummary;
  /** Position in the grid, for the staggered entrance. */
  index: number;
  baseDelay: number;
  onRenamed: (project: ProjectSummary) => void;
  onArchived: (id: string) => void;
}) {
  const toast = useToast();
  const [dialog, setDialog] = useState<"rename" | "archive" | null>(null);
  const [title, setTitle] = useState(project.title);
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  function close() {
    if (pending) return;
    setDialog(null);
    setError(undefined);
  }

  function rename(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError(undefined);
    startTransition(async () => {
      const result = await renameProjectAction(project.id, title);
      if (result.ok) {
        onRenamed(result.project);
        setDialog(null);
        toast.success("Project renamed", `Now called “${result.project.title}”.`);
      } else {
        setError(result.error);
      }
    });
  }

  function archive() {
    if (pending) return;
    setError(undefined);
    startTransition(async () => {
      const result = await archiveProjectAction(project.id);
      if (result.ok) {
        onArchived(project.id);
        setDialog(null);
        toast.success("Project archived", `“${project.title}” is no longer in your library.`);
      } else {
        setError(result.error);
      }
    });
  }

  const tone = stageTone(project.stage);
  const verb = project.stage === "done" ? "Open" : "Continue";

  return (
    <li className="min-w-0">
      <PictureTile
        label={project.title}
        overlay={project.title}
        actionsInline
        coverLine={<StatusLine tone={tone}>{stageLine(project)}</StatusLine>}
        actions={
          <>
            <Button
              variant="primary"
              render={<Link href={projectHref(project)} />}
              aria-label={`${verb} ${project.title}`}
            >
              {verb}
            </Button>
            <Button
              variant="dark"
              onClick={() => {
                setTitle(project.title);
                setDialog("rename");
              }}
              aria-label={`Rename ${project.title}`}
            >
              Rename
            </Button>
            <Button
              variant="plain"
              onClick={() => setDialog("archive")}
              aria-label={`Archive ${project.title}`}
            >
              Archive
            </Button>
          </>
        }
        status={<StatusLine tone={tone}>{stageLabel(project.stage)}</StatusLine>}
        className="enter"
        style={stagger(index, baseDelay)}
      />

      <Sheet
        open={dialog === "rename"}
        onOpenChange={(next) => (next ? undefined : close())}
        title="Rename Project"
        footer={
          <>
            <Button variant="outlined" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form={RENAME_FORM_ID} variant="primary" loading={pending}>
              Rename
            </Button>
          </>
        }
      >
        <form id={RENAME_FORM_ID} onSubmit={rename} noValidate>
          <Field label="Title" required error={error}>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              autoFocus
              autoComplete="off"
            />
          </Field>
        </form>
      </Sheet>

      <Alert
        open={dialog === "archive"}
        onOpenChange={(next) => (next ? undefined : close())}
        title={`Archive “${project.title}”?`}
        message="The project leaves your library. Nothing is deleted."
        confirmLabel="Archive"
        onConfirm={archive}
        loading={pending}
        error={error}
      />
    </li>
  );
}
