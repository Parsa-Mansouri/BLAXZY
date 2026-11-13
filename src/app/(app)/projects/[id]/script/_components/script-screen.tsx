"use client";

import { useState } from "react";
import type { BackgroundStatus } from "../../_lib/background-status";
import { OutlineReview } from "./outline-review";
import { ScriptAccepted } from "./script-accepted";
import { ScriptReview } from "./script-review";
import { ScriptStart } from "./script-start";
import { ScriptFailed, ScriptWorking } from "./script-status";
import type { VersionSummary, VersionView } from "./version-types";

export interface ScriptScreenProps {
  projectId: string;
  projectTitle: string;
  current: VersionView | null;
  previous: VersionView | null;
  versions: VersionSummary[];
  background: BackgroundStatus | null;
  maxBriefChars: number;
  sample: boolean;
}

/** One route, five states: start, working, failed, review and accepted. Each has its own header. */
export function ScriptScreen(props: ScriptScreenProps) {
  const { projectId, current } = props;
  // "Change the Description" after a failure shows the opening again without touching the failed
  // version.
  const [startingOver, setStartingOver] = useState<string | null>(null);

  if (!current || (current.status === "failed" && startingOver === current.id)) {
    return (
      <ScriptStart
        projectId={projectId}
        maxBriefChars={props.maxBriefChars}
        initialBrief={current?.source === "generated" ? (current.brief ?? "") : ""}
        initialIdea={current?.source === "enhanced" ? (current.brief ?? "") : ""}
      />
    );
  }

  if (current.status === "pending") {
    return <ScriptWorking projectId={projectId} version={current} previous={props.previous} />;
  }

  if (current.status === "failed") {
    return (
      <ScriptFailed
        projectId={projectId}
        version={current}
        onStartOver={() => setStartingOver(current.id)}
      />
    );
  }

  if (current.status === "in_review" && current.outline) {
    return (
      <OutlineReview
        key={current.id}
        projectId={projectId}
        version={current}
        outline={current.outline}
        sample={props.sample}
      />
    );
  }

  if (current.status === "in_review") {
    return (
      <ScriptReview
        key={current.id}
        projectId={projectId}
        fallbackTitle={props.projectTitle}
        version={current}
        versions={props.versions}
        sample={props.sample}
      />
    );
  }

  return (
    <ScriptAccepted
      key={current.id}
      projectId={projectId}
      fallbackTitle={props.projectTitle}
      version={current}
      versions={props.versions}
      background={props.background}
      sample={props.sample}
    />
  );
}
