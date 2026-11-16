"use client";

import Link from "next/link";
import { stageLabel } from "@/lib/stages";
import { ActionMenu, Button, PictureTile, StatusLine, stagger } from "@/ui";
import { projectHref, stageLine, stageTone, type ProjectSummary } from "../_lib/summary";
import { useProjectActions } from "./project-actions";

/**
 * A film on the shelf (Home.dc.html, Projects.dc.html): its title on a flat tile, and on hover or
 * keyboard focus a panel slides up over the whole tile with Continue, Rename and Archive. The
 * same actions (and Open Script, Open in New Tab, Copy Link) are on right-click, a long press
 * and the "…" button, and on Enter, R and Delete while the tile is hovered or focused.
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
  const { verb, actions, openRename, openArchive, dialogs } = useProjectActions(project, {
    onRenamed,
    onArchived,
    formId: `rename-project-${project.id}`,
  });
  const tone = stageTone(project.stage);

  return (
    <li className="min-w-0">
      <ActionMenu
        actions={actions}
        button="overlay"
        label={`Actions for ${project.title}`}
        buttonLabel={`More for ${project.title}`}
        className="enter"
        style={stagger(index, baseDelay)}
      >
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
              <Button variant="dark" onClick={openRename} aria-label={`Rename ${project.title}`}>
                Rename
              </Button>
              <Button variant="plain" onClick={openArchive} aria-label={`Archive ${project.title}`}>
                Archive
              </Button>
            </>
          }
          status={<StatusLine tone={tone}>{stageLabel(project.stage)}</StatusLine>}
        />
      </ActionMenu>
      {dialogs}
    </li>
  );
}
