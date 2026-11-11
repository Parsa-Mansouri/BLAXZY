"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { stageHref } from "@/lib/stages";
import { Button } from "@/ui";
import { assetHref, kindPlural } from "../../../_lib/asset-kinds";
import { STAGE_VIEWS } from "../../_components/asset-stage";
import { continueToProductionAction, type NotReadyAsset } from "../actions";
import type { ReviewItem } from "./review-pass";

function AssetLinks({
  projectId,
  assets,
}: {
  projectId: string;
  assets: { id: string; name: string; kind: ReviewItem["kind"]; note?: string }[];
}) {
  return (
    <ul className="flex flex-col">
      {assets.map((asset) => (
        <li key={asset.id} className="flex items-baseline justify-between gap-4 py-2.5 hairline-b">
          <Link
            href={assetHref(projectId, asset.id)}
            className="min-w-0 rounded-control text-body text-label underline-offset-4 focus-ring hover:underline"
          >
            {asset.name}
          </Link>
          <span className="shrink-0 text-callout text-label-2">
            {asset.note ?? kindPlural(asset.kind)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The end of the pass: what was approved and sent back, and the way on to Production. */
export function ReviewSummary({
  projectId,
  approved,
  sentBack,
  canContinue,
  onBack,
}: {
  projectId: string;
  approved: number;
  sentBack: ReviewItem[];
  canContinue: boolean;
  onBack: (() => void) | null;
}) {
  const router = useRouter();
  const [pending, startContinuing] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notReady, setNotReady] = useState<NotReadyAsset[]>([]);
  const production = stageHref(projectId, "production");

  function proceed() {
    setError(null);
    setNotReady([]);
    startContinuing(async () => {
      const result = await continueToProductionAction(projectId);
      if (result.ok) {
        router.push(production);
        return;
      }
      setError(result.error);
      setNotReady(result.notReady);
    });
  }

  const others = notReady.filter((a) => !sentBack.some((s) => s.id === a.id));
  const approvedWords =
    approved === 0 ? "No sheet was marked Looks Good." : `${approved} marked Looks Good.`;

  return (
    <div className="flex max-w-(--measure) flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h2 className="text-large-title">All Sheets Reviewed</h2>
        <p className="text-reading text-label-2">
          {approvedWords}{" "}
          {sentBack.length > 0
            ? `${sentBack.length} sent back for changes.`
            : "Nothing was sent back."}
        </p>
      </header>

      {sentBack.length > 0 ? (
        <section aria-labelledby="sent-back" className="flex flex-col gap-1">
          <h3 id="sent-back" className="text-title-2">
            Sent Back
          </h3>
          <p className="pb-2 text-body text-label-2">
            Their sheets are being built again. Production opens once they are ready.
          </p>
          <AssetLinks projectId={projectId} assets={sentBack} />
        </section>
      ) : null}

      {error ? (
        <section aria-labelledby="blocked" className="flex flex-col gap-1">
          <h3 id="blocked" className="text-title-2">
            Not Ready Yet
          </h3>
          <p role="alert" className="text-body text-label-2">
            {error}
          </p>
          {others.length > 0 ? (
            <div className="pt-2">
              <AssetLinks
                projectId={projectId}
                assets={others.map((a) => ({
                  id: a.id,
                  name: a.name,
                  kind: a.kind,
                  note: STAGE_VIEWS[a.stage].label,
                }))}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {onBack ? (
          <Button variant="plain" leadingIcon={<ArrowLeft aria-hidden />} onClick={onBack}>
            Previous
          </Button>
        ) : null}
        {canContinue ? (
          <Button variant="prominent" size="large" loading={pending} onClick={proceed}>
            Continue to Production
          </Button>
        ) : (
          <Button variant="prominent" size="large" render={<Link href={production} />}>
            Continue to Production
          </Button>
        )}
        <Button variant="standard" render={<Link href={`/projects/${projectId}/pre-production`} />}>
          Back to Pre-production
        </Button>
      </div>
    </div>
  );
}
