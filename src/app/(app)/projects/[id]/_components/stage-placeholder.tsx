import { PROJECT_STAGES, type ProjectStageKey } from "@/lib/stages";

/** A stage screen that is not built yet: its title and purpose. */
export function StagePlaceholder({ stage }: { stage: ProjectStageKey }) {
  const info = PROJECT_STAGES.find((s) => s.key === stage);
  return (
    <section aria-labelledby="stage-title" className="flex max-w-(--measure) flex-col gap-2">
      <h2 id="stage-title" className="text-large-title">
        {info?.label}
      </h2>
      <p className="text-reading text-label-2">{info?.summary}</p>
      <p className="pt-6 text-body text-label-2">This stage is not available yet.</p>
    </section>
  );
}
