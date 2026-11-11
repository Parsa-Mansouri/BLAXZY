"use client";

import { useState } from "react";
import Link from "next/link";
import { stageHref } from "@/lib/stages";
import type { BackgroundStatus } from "../../_lib/background-status";
import { ScriptAccepted } from "./script-accepted";
import { ScriptReview } from "./script-review";
import { ScriptStart } from "./script-start";
import { ScriptFailed, ScriptWorking } from "./script-status";
import type { IssueChoice, VersionSummary, VersionView } from "./shared";

export interface ScriptScreenProps {
  projectId: string;
  projectTitle: string;
  styleLine: string;
  current: VersionView | null;
  previous: VersionView | null;
  versions: VersionSummary[];
  background: BackgroundStatus | null;
  issues: IssueChoice[];
  maxBriefChars: number;
  sample: boolean;
}

/** Stage title and the project's style in one quiet line, for the screens before review. */
function StageHeader({ projectId, styleLine }: { projectId: string; styleLine: string }) {
  return (
    <header className="flex flex-col gap-1.5">
      <h2 className="text-large-title">Script</h2>
      <p className="text-body text-label-2">
        {styleLine}
        <span aria-hidden="true"> · </span>
        <Link
          href={stageHref(projectId, "style")}
          className="text-label underline-offset-4 focus-ring hover:underline"
        >
          Change Style
        </Link>
      </p>
    </header>
  );
}

/** One route, five states: start, working, failed, review and accepted. */
export function ScriptScreen(props: ScriptScreenProps) {
  const { projectId, current } = props;
  // "Start Over" after a failure shows the opening again without touching the failed version.
  const [startingOver, setStartingOver] = useState<string | null>(null);

  const showStart = !current || (current.status === "failed" && startingOver === current.id);

  if (showStart || current.status === "pending" || current.status === "failed") {
    return (
      <div className="@container flex flex-col gap-10">
        <StageHeader projectId={projectId} styleLine={props.styleLine} />
        {showStart ? (
          <ScriptStart
            projectId={projectId}
            maxBriefChars={props.maxBriefChars}
            initialBrief={current?.source === "generated" ? (current.brief ?? "") : ""}
          />
        ) : current.status === "pending" ? (
          <ScriptWorking projectId={projectId} version={current} previous={props.previous} />
        ) : (
          <ScriptFailed
            projectId={projectId}
            version={current}
            onStartOver={() => setStartingOver(current.id)}
          />
        )}
      </div>
    );
  }

  if (current.status === "in_review") {
    return (
      <div className="@container">
        <ScriptReview
          key={current.id}
          projectId={projectId}
          fallbackTitle={props.projectTitle}
          version={current}
          versions={props.versions}
          issues={props.issues}
          sample={props.sample}
        />
      </div>
    );
  }

  return (
    <div className="@container">
      <ScriptAccepted
        key={current.id}
        projectId={projectId}
        fallbackTitle={props.projectTitle}
        version={current}
        versions={props.versions}
        background={props.background}
        sample={props.sample}
      />
    </div>
  );
}
