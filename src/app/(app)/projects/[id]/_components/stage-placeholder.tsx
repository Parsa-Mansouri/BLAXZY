import { PROJECT_STAGES, type ProjectStageKey } from "@/lib/stages";
import { PageHeader } from "@/ui";

/** A stage screen that is not built yet: its title and purpose. */
export function StagePlaceholder({ stage }: { stage: ProjectStageKey }) {
  const info = PROJECT_STAGES.find((s) => s.key === stage);
  return (
    <section>
      <PageHeader title={info?.label} description={info?.summary} />
      <p className="in-2 text-body text-label-2">This stage is not available yet.</p>
    </section>
  );
}
