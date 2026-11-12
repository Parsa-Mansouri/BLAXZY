"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { stageHref } from "@/lib/stages";
import { Button, type ButtonSize } from "@/ui";
import { assetHref } from "../../_lib/asset-kinds";
import { ASSET_STATUS_LABELS } from "../../_lib/asset-status";
import { continueToProductionAction, type NotReadyAsset } from "../review/actions";

/**
 * Finishes Pre-production and opens Production. When the server finds an asset that is no longer
 * ready, says which ones, each a link to its page.
 */
export function ContinueToProduction({
  projectId,
  size = "large",
  disabled = false,
}: {
  projectId: string;
  size?: ButtonSize;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startContinuing] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notReady, setNotReady] = useState<NotReadyAsset[]>([]);

  function proceed() {
    setError(null);
    setNotReady([]);
    startContinuing(async () => {
      const result = await continueToProductionAction(projectId);
      if (result.ok) {
        router.push(stageHref(projectId, "production"));
        return;
      }
      setError(result.error);
      setNotReady(result.notReady);
    });
  }

  return (
    <div className="flex flex-col items-start gap-3 sm:items-end">
      <Button
        variant={disabled ? "dark" : "primary"}
        size={size}
        loading={pending}
        disabled={disabled}
        onClick={proceed}
      >
        Continue to Production
      </Button>
      {error ? (
        <div role="alert" className="flex max-w-(--measure) flex-col gap-2 sm:items-end">
          <p className="text-secondary text-red">{error}</p>
          {notReady.length > 0 ? (
            <ul className="flex flex-col gap-1 sm:items-end">
              {notReady.map((asset) => (
                <li key={asset.id} className="text-secondary text-label-2">
                  <Link
                    href={assetHref(projectId, asset.id)}
                    className="rounded-row text-brand underline-offset-4 focus-ring hover:underline"
                  >
                    {asset.name}
                  </Link>{" "}
                  · {ASSET_STATUS_LABELS[asset.stage]}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
