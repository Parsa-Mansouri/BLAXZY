import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth";
import { getDamiMode } from "@/server/damis/light";
import { getScriptState, getScriptVersion, MAX_BRIEF_CHARS } from "@/server/script";
import { loadBackgroundStatus } from "../_lib/background-status";
import { loadProjectForStage } from "../_lib/load-stage";
import { ScriptScreen } from "./_components/script-screen";

export default async function ScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // The project (and its stage gate) and the script state are read side by side; the state is
  // only read once requireUser has resolved, and is scoped to that user.
  const [project, { user, state }] = await Promise.all([
    loadProjectForStage(id, "script"),
    requireUser().then(async (user) => ({ user, state: await getScriptState(id, user.id) })),
  ]);
  if (!state) notFound();

  const current = state.current;
  // While a revision is written, the version it revises stays readable.
  const previousId =
    current?.status === "pending" && current.source === "revised" ? state.versions[1]?.id : null;
  const [previous, background] = await Promise.all([
    previousId ? getScriptVersion(previousId, user.id) : Promise.resolve(null),
    current?.status === "accepted"
      ? loadBackgroundStatus(project.id, user.id, current.id)
      : Promise.resolve(null),
  ]);

  return (
    <ScriptScreen
      projectId={project.id}
      projectTitle={project.title}
      current={current}
      previous={previous}
      versions={state.versions}
      background={background}
      maxBriefChars={MAX_BRIEF_CHARS}
      sample={getDamiMode() === "sample"}
    />
  );
}
