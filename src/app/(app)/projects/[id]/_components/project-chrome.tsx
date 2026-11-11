"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { STAGE_SLUGS, PROJECT_STAGES } from "@/lib/stages";
import { BackControl, StageStrip, Toolbar, type StageStripItem } from "@/ui";
import { useActiveStages } from "@/app/(app)/_lib/use-active-stages";

interface BackTarget {
  href: string;
  label: string;
}

const PRODUCTION_SECTIONS: Record<string, string> = {
  blocks: "Shots",
  clips: "Clips",
  finished: "Finished",
};

const BackContext = createContext<((target: BackTarget | null) => void) | null>(null);

/** Stage label for a URL slug ("pre-production" is "Pre-production"). */
function stageLabelForSlug(slug: string): string | undefined {
  const stage = PROJECT_STAGES.find((s) => STAGE_SLUGS[s.key] === slug);
  return stage?.label;
}

/**
 * The project's chrome: the toolbar with the project name (on a stage's own page) or a back
 * control (on any page below a stage), and the four-stage strip on the trailing side.
 *
 * The back control leads to the stage's page by default. A deeper page can point it elsewhere
 * by rendering `<ToolbarBack href=".." label="Characters" />` anywhere in its tree.
 */
export function ProjectChrome({
  projectId,
  title,
  stages,
  children,
}: {
  projectId: string;
  title: string;
  stages: StageStripItem[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const items = useActiveStages(stages);
  const [override, setOverride] = useState<BackTarget | null>(null);

  const base = `/projects/${projectId}`;
  const segments = pathname.startsWith(`${base}/`)
    ? pathname
        .slice(base.length + 1)
        .split("/")
        .filter(Boolean)
    : [];
  const stageSlug = segments[0];
  const stageLabel = stageSlug ? stageLabelForSlug(stageSlug) : undefined;
  // Production has no page of its own: its shots, clips and finished screens are the stage pages,
  // so only the pages below them get a back control.
  const section = stageSlug === "production" ? segments[1] : undefined;
  const sectionLabel = section ? PRODUCTION_SECTIONS[section] : undefined;
  const deeper = stageLabel !== undefined && segments.length > (sectionLabel ? 2 : 1);
  const back: BackTarget | null = deeper
    ? (override ??
      (sectionLabel
        ? { href: `${base}/${stageSlug}/${section}`, label: sectionLabel }
        : { href: `${base}/${stageSlug}`, label: stageLabel }))
    : null;

  return (
    <BackContext.Provider value={setOverride}>
      <Toolbar
        titleAs="div"
        title={
          back ? <BackControl render={<Link href={back.href} />}>{back.label}</BackControl> : title
        }
        trailing={<StageStrip stages={items} linkAs={Link} aria-label="Stages" />}
      />
      {children}
    </BackContext.Provider>
  );
}

/**
 * Points the toolbar's back control at a page other than the stage's own, e.g. an asset page
 * backing up to its category. Renders nothing.
 */
export function ToolbarBack({ href, label }: BackTarget) {
  const set = useContext(BackContext);
  const target = useMemo(() => ({ href, label }), [href, label]);
  useEffect(() => {
    if (!set) return;
    set(target);
    return () => set(null);
  }, [set, target]);
  return null;
}
