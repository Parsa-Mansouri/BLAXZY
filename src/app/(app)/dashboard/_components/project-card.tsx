"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { Archive, MoreHorizontal, Pencil } from "lucide-react";
import { formatRelativeTime } from "@/lib/relative-time";
import { stageLabel } from "@/lib/stages";
import { Badge, Button, Card, Dialog, Field, IconButton, Input, Popover, useToast } from "@/ui";
import { archiveProjectAction, renameProjectAction } from "../actions";
import type { ProjectSummary } from "../_lib/summary";

const RENAME_FORM_ID = "rename-project-form";

export function ProjectCard({
  project,
  onRenamed,
  onArchived,
}: {
  project: ProjectSummary;
  onRenamed: (project: ProjectSummary) => void;
  onArchived: (id: string) => void;
}) {
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
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
    setError(undefined);
    startTransition(async () => {
      const result = await renameProjectAction(project.id, title);
      if (result.ok) {
        onRenamed(result.project);
        setDialog(null);
        toast.success("Project renamed");
      } else {
        setError(result.error);
      }
    });
  }

  function archive() {
    setError(undefined);
    startTransition(async () => {
      const result = await archiveProjectAction(project.id);
      if (result.ok) {
        onArchived(project.id);
        setDialog(null);
        toast.success("Project archived", `"${project.title}" is off your dashboard.`);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <>
      <Card interactive className="relative flex h-full flex-col gap-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 text-lg font-semibold tracking-tight">
            <Link
              href={`/projects/${project.id}`}
              className="rounded-xs break-words focus-ring after:absolute after:inset-0 after:rounded-lg"
            >
              {project.title}
            </Link>
          </h3>
          <Popover
            open={menuOpen}
            onOpenChange={setMenuOpen}
            align="end"
            aria-label={`Actions for ${project.title}`}
            trigger={
              <IconButton
                label="Project actions"
                size="sm"
                className="relative z-10 -mt-1 -mr-2"
                icon={<MoreHorizontal />}
              />
            }
          >
            <div className="flex w-44 flex-col gap-0.5">
              <button
                type="button"
                className="flex h-10 items-center gap-2.5 rounded-sm px-2 text-sm focus-ring hover:bg-hover [&_svg]:size-4 [&_svg]:text-fg-subtle"
                onClick={() => {
                  setMenuOpen(false);
                  setTitle(project.title);
                  setDialog("rename");
                }}
              >
                <Pencil aria-hidden="true" />
                Rename
              </button>
              <button
                type="button"
                className="flex h-10 items-center gap-2.5 rounded-sm px-2 text-sm focus-ring hover:bg-hover [&_svg]:size-4 [&_svg]:text-fg-subtle"
                onClick={() => {
                  setMenuOpen(false);
                  setDialog("archive");
                }}
              >
                <Archive aria-hidden="true" />
                Archive
              </button>
            </div>
          </Popover>
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2">
          <Badge tone="accent" dot>
            {stageLabel(project.stage)}
          </Badge>
          <time
            dateTime={project.updatedAt}
            suppressHydrationWarning
            className="text-sm text-fg-subtle"
          >
            Updated {formatRelativeTime(project.updatedAt)}
          </time>
        </div>
      </Card>

      <Dialog
        open={dialog === "rename"}
        onOpenChange={(next) => (next ? undefined : close())}
        title="Rename project"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form={RENAME_FORM_ID} variant="primary" loading={pending}>
              Save name
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
      </Dialog>

      <Dialog
        open={dialog === "archive"}
        onOpenChange={(next) => (next ? undefined : close())}
        title="Archive this project?"
        description={`"${project.title}" will leave your dashboard. Nothing is deleted.`}
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={pending}>
              Keep it
            </Button>
            <Button variant="danger" onClick={archive} loading={pending}>
              Archive
            </Button>
          </>
        }
      >
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </Dialog>
    </>
  );
}
