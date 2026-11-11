import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth";
import { getPreProductionOverview, listAssetCards } from "@/server/assets";
import { kindFromSlug, kindPlural } from "../../_lib/asset-kinds";
import { loadProjectForStage } from "../../_lib/load-stage";
import { toGalleryItem } from "../_components/gallery-item";
import { CategoryPanel } from "./_components/category-panel";

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ id: string; kind: string }>;
}) {
  const { id, kind: slug } = await params;
  const kind = kindFromSlug(slug);
  if (!kind) notFound();
  const project = await loadProjectForStage(id, "pre_production");
  const user = await requireUser();
  const [overview, page] = await Promise.all([
    getPreProductionOverview(project.id, user.id),
    listAssetCards(project.id, user.id, { kind }),
  ]);
  if (!overview || !page) notFound();
  const index = overview.kinds.findIndex((k) => k.kind === kind);
  if (index === -1) notFound();
  const counts = overview.kinds[index];
  const previous = overview.kinds[index - 1];
  const next = overview.kinds[index + 1];

  return (
    <CategoryPanel
      projectId={project.id}
      kind={kind}
      plural={kindPlural(kind)}
      initial={page.items.map(toGalleryItem)}
      initialCursor={page.nextCursor}
      total={counts.total}
      ready={counts.ready}
      previous={previous ? { kind: previous.kind, plural: kindPlural(previous.kind) } : null}
      next={next ? { kind: next.kind, plural: kindPlural(next.kind) } : null}
    />
  );
}
