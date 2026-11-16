"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Alert, Button, Field, Input, linkExtras, Sheet, useToast, type ActionGroups } from "@/ui";
import { archiveProjectAction, renameProjectAction } from "../actions";
import { projectHref, scriptHref, type ProjectSummary } from "../_lib/summary";

/**
 * A film's actions (Continue or Open, Open Script, Open in New Tab, Copy Link, Rename…,
 * Archive…) with the Rename sheet and the Archive alert they open. Shared by the film tile and
 * the Continue hero; render `dialogs` outside the action menu's target.
 */
export function useProjectActions(
  project: ProjectSummary,
  {
    onRenamed,
    onArchived,
    formId,
  }: {
    onRenamed: (project: ProjectSummary) => void;
    onArchived: (id: string) => void;
    /** Unique per page: the rename form's id (its submit button sits in the sheet's footer). */
    formId: string;
  },
): {
  verb: "Open" | "Continue";
  actions: ActionGroups;
  openRename: () => void;
  openArchive: () => void;
  dialogs: ReactNode;
} {
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

  function openRename() {
    setTitle(project.title);
    setDialog("rename");
  }

  function openArchive() {
    setDialog("archive");
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

  const verb = project.stage === "done" ? "Open" : "Continue";
  const href = projectHref(project);
  const script = scriptHref(project);
  const actions: ActionGroups = [
    [
      { id: "open", label: verb, href },
      script ? { id: "script", label: "Open Script", href: script } : null,
    ],
    linkExtras(href),
    [{ id: "rename", label: "Rename…", disabled: pending, onSelect: openRename }],
    [
      {
        id: "archive",
        label: "Archive…",
        destructive: true,
        disabled: pending,
        onSelect: openArchive,
      },
    ],
  ];

  const dialogs = (
    <>
      <Sheet
        open={dialog === "rename"}
        onOpenChange={(next) => (next ? undefined : close())}
        title="Rename Project"
        footer={
          <>
            <Button variant="outlined" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form={formId} variant="primary" loading={pending}>
              Rename
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={rename} noValidate>
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
    </>
  );

  return { verb, actions, openRename, openArchive, dialogs };
}
