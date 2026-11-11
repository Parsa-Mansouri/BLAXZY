"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { Ellipsis } from "lucide-react";
import { formatRelativeTime } from "@/lib/relative-time";
import { stageLabel } from "@/lib/stages";
import {
  Alert,
  Button,
  GroupedList,
  GroupedListField,
  IconButton,
  Input,
  Menu,
  MenuItem,
  MenuSeparator,
  Sheet,
  TitleCard,
  cn,
  useToast,
} from "@/ui";
import { archiveProjectAction, renameProjectAction } from "../actions";
import { projectHref, type ProjectSummary } from "../_lib/summary";

const RENAME_FORM_ID = "rename-project-form";

/** A project on the shelf: title-card artwork, caption beneath, and an actions menu. */
export function ProjectTile({
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
        toast.success("Project archived", `“${project.title}” is no longer in your library.`);
      } else {
        setError(result.error);
      }
    });
  }

  const label = stageLabel(project.stage);

  return (
    <li className="group/tile relative">
      <Link href={projectHref(project)} className="group/link flex flex-col gap-2 outline-none">
        <TitleCard
          title={project.title}
          className="group-hover/tile:bg-elevated-2 group-focus-visible/link:outline-2 group-focus-visible/link:outline-offset-2 group-focus-visible/link:outline-focus"
        />
        <span className="truncate px-0.5 text-callout text-label-2">
          {label} ·{" "}
          <time dateTime={project.updatedAt} suppressHydrationWarning>
            {formatRelativeTime(project.updatedAt)}
          </time>
        </span>
      </Link>

      <div
        className={cn(
          "absolute top-2 right-2 opacity-0 transition-opacity duration-(--dur-fast)",
          "group-focus-within/tile:opacity-100 group-hover/tile:opacity-100 pointer-coarse:opacity-100",
          menuOpen && "opacity-100",
        )}
      >
        <Menu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          align="end"
          trigger={
            <IconButton
              label={`Actions for ${project.title}`}
              tooltip={false}
              variant="standard"
              icon={<Ellipsis />}
              className="rounded-full bg-elevated-3 hover:bg-elevated-3"
            />
          }
        >
          <MenuItem
            onClick={() => {
              setTitle(project.title);
              setDialog("rename");
            }}
          >
            Rename…
          </MenuItem>
          <MenuSeparator />
          <MenuItem onClick={() => setDialog("archive")}>Archive…</MenuItem>
        </Menu>
      </div>

      <Sheet
        open={dialog === "rename"}
        onOpenChange={(next) => (next ? undefined : close())}
        title="Rename Project"
        footer={
          <>
            <Button variant="standard" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form={RENAME_FORM_ID} variant="prominent" loading={pending}>
              Rename
            </Button>
          </>
        }
      >
        <form id={RENAME_FORM_ID} onSubmit={rename} noValidate>
          <GroupedList>
            <GroupedListField label="Title" required error={error}>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                autoFocus
                autoComplete="off"
              />
            </GroupedListField>
          </GroupedList>
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
