"use client";

import { Fragment, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, ChevronLeft, Lock } from "lucide-react";
import type { ProjectStageKey } from "@/lib/stages";
import {
  ActionMenuTarget,
  cn,
  SidebarBody,
  SidebarFooter,
  SidebarHeader,
  SidebarItem,
  SidebarSection,
  StatusDot,
} from "@/ui";
import { navActions } from "../_lib/nav-actions";
import { Wordmark } from "@/app/_components/wordmark";
import { pollNavigator } from "../_lib/poll-client";
import { usePolling } from "../_lib/use-polling";
import {
  ASSET_KIND_LABELS,
  type AssetKindKey,
  categoryHref,
  kindSlug,
  reviewHref,
} from "../projects/[id]/_lib/asset-kinds";
import type {
  NavigatorStage,
  NavigatorStatus,
  NavigatorView,
} from "../projects/[id]/_lib/load-navigator";
import { blocksHref, clipsHref, finishedHref } from "../projects/[id]/_lib/production-routes";
import { SidebarAccount } from "./sidebar-account";

/** Poll gap while something is being made, and while nothing is. */
const BUSY_POLL_MS = 4000;
const IDLE_POLL_MS = 20_000;

const NO_STATUS: NavigatorStatus = { failed: 0, toReview: 0, rendering: false };

/** The row's one trailing status: failed, then what waits for the user, then a quiet pulse. */
function RowStatus({ status }: { status: NavigatorStatus }) {
  const words = "flex items-center gap-1.5 text-meta font-normal normal-case tracking-normal";
  if (status.failed > 0) {
    return (
      <span className={cn(words, "text-label-2")}>
        <StatusDot tone="failed" />
        {status.failed} failed
      </span>
    );
  }
  if (status.toReview > 0) {
    return (
      <span className={cn(words, "text-label-2")}>
        <StatusDot tone="waiting" />
        {status.toReview} to review
      </span>
    );
  }
  if (status.rendering) {
    return (
      <span className="flex size-(--icon) items-center justify-center">
        <StatusDot tone="working" className="animate-pulse motion-reduce:animate-none" />
        <span className="sr-only">Rendering</span>
      </span>
    );
  }
  return null;
}

/** Leading mark of a stage: done, current or locked. */
function StageMark({ status }: { status: NavigatorStage["status"] }) {
  if (status === "done") return <Check aria-hidden="true" />;
  if (status === "current") {
    return (
      <span aria-hidden="true" className="flex size-(--icon) items-center justify-center">
        <span className="size-1.5 rounded-full bg-label" />
      </span>
    );
  }
  return <Lock aria-hidden="true" />;
}

const STAGE_STATE_WORDS: Record<NavigatorStage["status"], string> = {
  done: "done",
  current: "current stage",
  upcoming: "upcoming",
  locked: "locked",
};

/** A row that opens a page, or a dimmed one that says why it cannot be opened yet. */
function NavRow({
  href,
  lockedHint,
  selected,
  status = NO_STATUS,
  stage,
  label,
  first = false,
}: {
  href: string | null;
  lockedHint?: string;
  selected: boolean;
  status?: NavigatorStatus;
  /** A stage row (capitals, with its mark); otherwise an area under a stage. */
  stage?: NavigatorStage["status"];
  label: ReactNode;
  first?: boolean;
}) {
  const accessory = href ? <RowStatus status={status} /> : null;
  const shared = {
    variant: stage ? ("nav" as const) : ("row" as const),
    icon: stage ? <StageMark status={stage} /> : undefined,
    inset: !stage,
    className: cn(stage && !first && "mt-3", !stage && "text-secondary"),
  };
  const srState = stage ? <span className="sr-only">, {STAGE_STATE_WORDS[stage]}</span> : null;
  if (!href) {
    return (
      <SidebarItem
        {...shared}
        disabled
        tooltip={lockedHint}
        tabIndex={lockedHint ? 0 : undefined}
        render={<span />}
      >
        {label}
        {srState}
        {lockedHint ? <span className="sr-only">. {lockedHint}</span> : null}
      </SidebarItem>
    );
  }
  return (
    <ActionMenuTarget
      actions={navActions(href)}
      render={
        <SidebarItem
          {...shared}
          selected={selected}
          accessory={accessory}
          render={<Link href={href} />}
        >
          {label}
          {srState}
        </SidebarItem>
      }
    />
  );
}

/** Which row the address selects (an asset's page selects its kind). */
function useSelection(projectId: string, assetKind: AssetKindKey | null) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;
  const parts = pathname.startsWith(`${base}/`)
    ? pathname
        .slice(base.length + 1)
        .split("/")
        .filter(Boolean)
    : [];
  const [stage, area, id] = parts;
  return {
    stage: (key: ProjectStageKey): boolean => {
      if (key === "style") return stage === "style";
      if (key === "script") return stage === "script";
      if (key === "pre_production") return stage === "pre-production" && area === undefined;
      return stage === "production" && area === undefined;
    },
    kind: (kind: AssetKindKey): boolean =>
      stage === "pre-production" &&
      (area === kindSlug(kind) || (area === "assets" && id !== undefined && assetKind === kind)),
    review: stage === "pre-production" && area === "review",
    production: (section: "blocks" | "clips" | "finished"): boolean =>
      stage === "production" && area === section,
  };
}

/**
 * The film navigator: the in-film sidebar. The way back to every film, the film's title, its
 * stages with their areas (each with one live status), what is being made right now, and the
 * account row. Polls the navigator: often while anything is being made, rarely otherwise.
 */
export function ProjectSidebarView({
  initial,
  assetKind,
  name,
  email,
}: {
  initial: NavigatorView;
  /** On an asset's page: its kind, so the kind's row is selected. */
  assetKind: AssetKindKey | null;
  name: string;
  email: string;
}) {
  const [view, setView] = useState(initial);
  const [seen, setSeen] = useState(initial);
  // A fresh server render (a navigation, a refresh) replaces the polled copy.
  if (initial !== seen) {
    setSeen(initial);
    setView(initial);
  }
  usePolling(
    async (isActive, signal) => {
      const next = await pollNavigator(view.projectId, { signal });
      if (!isActive() || !next) return;
      setView((current) => (current.signature === next.signature ? current : next));
    },
    true,
    view.working ? BUSY_POLL_MS : IDLE_POLL_MS,
  );

  const id = view.projectId;
  const selected = useSelection(id, assetKind);
  const kindStatus = new Map(view.preProduction?.kinds.map((k) => [k.kind, k]) ?? []);
  const kinds = ASSET_KIND_LABELS.filter((k) => kindStatus.has(k.kind));
  const production = view.production;
  const productionHint = view.stages.find((s) => s.key === "production")?.lockedHint;

  function areas(stage: NavigatorStage): ReactNode {
    if (stage.key === "pre_production" && view.preProduction && kinds.length > 0) {
      return (
        <>
          {kinds.map(({ kind, plural }) => (
            <NavRow
              key={kind}
              href={categoryHref(id, kind)}
              selected={selected.kind(kind)}
              status={kindStatus.get(kind) ?? NO_STATUS}
              label={plural}
            />
          ))}
          <NavRow href={reviewHref(id)} selected={selected.review} label="Review All" />
        </>
      );
    }
    if (stage.key === "production") {
      return (
        <>
          <NavRow
            href={production ? blocksHref(id) : null}
            lockedHint={productionHint}
            selected={selected.production("blocks")}
            status={production?.shots}
            label="Shots"
          />
          <NavRow
            href={production ? clipsHref(id) : null}
            lockedHint={productionHint}
            selected={selected.production("clips")}
            status={production?.clips}
            label="Clips"
          />
          <NavRow
            href={production?.finished ? finishedHref(id) : null}
            lockedHint={production ? "Opens once a clip is final" : productionHint}
            selected={selected.production("finished")}
            label="Finished"
          />
        </>
      );
    }
    return null;
  }

  return (
    <>
      <SidebarHeader>
        <Wordmark href="/dashboard" />
      </SidebarHeader>
      <SidebarBody aria-label="Film">
        <div className="flex flex-col gap-3">
          <ul>
            <ActionMenuTarget
              actions={navActions("/dashboard")}
              render={
                <SidebarItem
                  icon={<ChevronLeft />}
                  render={<Link href="/dashboard" />}
                  className="text-secondary"
                >
                  All Films
                </SidebarItem>
              }
            />
          </ul>
          <p
            title={view.title}
            className="line-clamp-2 swap-in px-3 text-section break-words text-label"
            key={view.title}
          >
            {view.title}
          </p>
        </div>
        <SidebarSection title="Stages">
          {view.stages.map((stage, index) => (
            <Fragment key={stage.key}>
              <NavRow
                href={stage.href ?? null}
                lockedHint={stage.lockedHint}
                selected={selected.stage(stage.key)}
                stage={stage.status}
                status={
                  stage.key === "script"
                    ? {
                        failed: view.script.failed ? 1 : 0,
                        toReview: 0,
                        rendering: view.script.working,
                      }
                    : NO_STATUS
                }
                label={stage.label}
                first={index === 0}
              />
              {areas(stage)}
            </Fragment>
          ))}
        </SidebarSection>
        {view.busy.items.length > 0 ? (
          <SidebarSection title="Now Rendering" showTitle divided className="swap-in">
            {view.busy.items.map((item) => (
              <ActionMenuTarget
                key={item.key}
                actions={navActions(item.href)}
                render={
                  <SidebarItem
                    icon={
                      <span className="flex size-(--icon) items-center justify-center">
                        <StatusDot
                          tone="working"
                          className="animate-pulse motion-reduce:animate-none"
                        />
                      </span>
                    }
                    tooltip={item.name}
                    render={<Link href={item.href} />}
                    className="text-secondary"
                  >
                    {item.name}
                  </SidebarItem>
                }
              />
            ))}
            {view.busy.more > 0 ? (
              <li className="flex min-h-(--sidebar-row-h) items-center gap-2.5 px-3 text-secondary text-label-3 tabular-nums">
                <span aria-hidden="true" className="w-(--icon) shrink-0" />
                and {view.busy.more} more
              </li>
            ) : null}
          </SidebarSection>
        ) : null}
      </SidebarBody>
      <SidebarFooter>
        <SidebarAccount name={name} email={email} />
      </SidebarFooter>
    </>
  );
}
