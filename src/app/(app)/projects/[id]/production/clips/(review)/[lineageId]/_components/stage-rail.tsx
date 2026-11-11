"use client";

import { useState, useTransition, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import type { BlockProductionStage, TakeView } from "@/server/production";
import { Button, ProgressBar } from "@/ui";
import { ChangeRequest } from "../../../../_components/change-request";
import { isCreditsFailure } from "../../../_lib/clip-view";
import { blocksHref } from "../../../_lib/routes";
import { retryTakeAction } from "../../../actions";
import { StateHeading } from "../../../_components/clips-context";
import {
  CreditLine,
  ErrorLine,
  When,
  canAfford,
  creditWords,
  formatNumber,
  type IssueChoice,
} from "./shared";

const SAMPLE_CLIP = "Sample clip. A placeholder from the test generator, not a real result.";

export interface Prices {
  draft: number | null;
  final: number | null;
}

export interface ReviewRequest {
  decision: "accepted" | "rejected";
  issueCodes?: string[];
  note?: string;
}

/** Shared by the panels: the heading takes focus when a panel replaces another. */
interface PanelBase {
  shown: RefObject<boolean>;
}

function Intro({
  shown,
  title,
  children,
}: PanelBase & {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <StateHeading shown={shown} className="text-section text-balance">
        {title}
      </StateHeading>
      {children}
    </div>
  );
}

function TakeLine({ label, take }: { label: string; take: TakeView }) {
  return (
    <>
      <p className="text-secondary text-label-2">
        {label} · <When date={take.decidedAt ?? take.createdAt} />
      </p>
      {take.isSample ? <p className="text-secondary text-label-2">{SAMPLE_CLIP}</p> : null}
    </>
  );
}

/**
 * Accept or request changes on a draft or a final waiting for review. Request Changes replaces
 * the decision in place with the issue chips, a note and the price of the new draft.
 */
export function ReviewPanel({
  shown,
  take,
  label,
  prices,
  balance,
  issues,
  maxNote,
  deciding,
  error,
  askError,
  asking,
  onAsk,
  onDecide,
}: PanelBase & {
  take: TakeView;
  label: string;
  prices: Prices;
  balance: number;
  issues: IssueChoice[];
  maxNote: number;
  deciding: "accepted" | "rejected" | null;
  error: string | null;
  askError: string | null;
  asking: boolean;
  onAsk: (open: boolean) => void;
  onDecide: (review: ReviewRequest, fromAsk: boolean) => void;
}) {
  const draft = take.stage === "draft";
  const acceptPrice = draft ? prices.final : null;
  const busy = deciding !== null;

  if (asking) {
    return (
      <ChangeRequest
        issues={issues}
        maxNote={maxNote}
        sending={deciding === "rejected"}
        serverError={askError}
        notePlaceholder="What the next draft should do differently."
        cost={<CreditLine price={prices.draft} balance={balance} action="A new draft" />}
        blocked={!canAfford(prices.draft, balance)}
        onSubmit={(input) => onDecide({ decision: "rejected", ...input }, true)}
        onCancel={() => onAsk(false)}
      />
    );
  }

  return (
    <div className="flex swap-in flex-col gap-5">
      <Intro shown={shown} title={draft ? "Review the Draft" : "Review the Final"}>
        <p className="text-body text-pretty text-label-2">
          {draft
            ? "A quick render to judge the shot: the action, the framing and the characters."
            : "The accepted draft, rendered in full quality."}
        </p>
        <TakeLine label={label} take={take} />
      </Intro>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3">
          <Button
            variant="primary"
            size="large"
            loading={deciding === "accepted"}
            disabled={busy || !canAfford(acceptPrice, balance)}
            onClick={() => onDecide({ decision: "accepted" }, false)}
          >
            Accept
          </Button>
          <Button size="large" disabled={busy} onClick={() => onAsk(true)}>
            Request Changes
          </Button>
        </div>
        {draft ? (
          acceptPrice !== null && balance < acceptPrice ? (
            <CreditLine price={acceptPrice} balance={balance} action="The final" />
          ) : (
            <p className="text-secondary text-pretty text-label-2 tabular-nums">
              Accepting renders this exact clip in full quality
              {acceptPrice !== null
                ? `, for ${creditWords(acceptPrice)}. You have ${formatNumber(balance)}.`
                : "."}
            </p>
          )
        ) : (
          <p className="text-secondary text-pretty text-label-2">
            Accepting makes this shot final. Requesting changes goes back to a new draft.
          </p>
        )}
        <ErrorLine>{error}</ErrorLine>
      </div>
    </div>
  );
}

/** A draft or final rendering: plain words and indeterminate progress. */
export function RenderingPanel({ shown, stage }: PanelBase & { stage: BlockProductionStage }) {
  const final = stage === "final_generating";
  const title = final ? "Finishing in Full Quality…" : "Rendering the Draft…";
  return (
    <Intro shown={shown} title={title}>
      <ProgressBar value={null} aria-label={title} className="my-1 max-w-sm" />
      <p className="text-body text-pretty text-label-2">
        {final
          ? "The accepted draft is being rendered again in full quality. You can leave this page. The final appears here when it is ready."
          : "You can leave this page. The draft appears here when it is ready."}
      </p>
    </Intro>
  );
}

/** The latest take failed: the reason, and Try Again. */
export function FailedPanel({
  shown,
  projectId,
  take,
  prices,
  balance,
  onDone,
}: PanelBase & {
  projectId: string;
  take: TakeView;
  prices: Prices;
  balance: number;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const final = take.stage === "final";
  const price = final ? prices.final : prices.draft;

  function retry() {
    setError(null);
    startTransition(async () => {
      const result = await retryTakeAction(projectId, take.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onDone();
    });
  }

  return (
    <div role="alert" className="flex flex-col gap-5">
      <Intro
        shown={shown}
        title={final ? "The final could not be made." : "The draft could not be made."}
      >
        <p className="text-body text-pretty text-label-2">
          {take.failure ?? "Something went wrong while it was being made."}
        </p>
        {isCreditsFailure(take.failure) ? (
          <p className="text-body text-label tabular-nums">You now have {creditWords(balance)}.</p>
        ) : null}
      </Intro>
      <div className="flex flex-col gap-3">
        <div>
          <Button
            variant="primary"
            size="large"
            loading={pending}
            disabled={!canAfford(price, balance)}
            onClick={retry}
          >
            Try Again
          </Button>
        </div>
        <CreditLine price={price} balance={balance} action="Trying again" />
        <ErrorLine>{error}</ErrorLine>
      </div>
    </div>
  );
}

/** The shot has an accepted final. */
export function DonePanel({ shown, take, label }: PanelBase & { take: TakeView; label: string }) {
  return (
    <Intro shown={shown} title="Final">
      <p className="text-body text-pretty text-label-2">
        This shot is final and ready for your editor.
      </p>
      <TakeLine label={`${label} · Accepted`} take={take} />
    </Intro>
  );
}

/** The shot is still in this stage's shot review: nothing to play yet. */
export function BeforeClipsPanel({
  shown,
  projectId,
  stage,
  failure,
}: PanelBase & {
  projectId: string;
  stage: BlockProductionStage;
  failure: string | null;
}) {
  const words =
    stage === "preparing"
      ? "This shot is being prepared. Its draft is made once every shot is approved."
      : stage === "prepare_failed"
        ? (failure ?? "This shot could not be prepared.")
        : stage === "approved"
          ? "This shot is approved. Its draft is made once every shot is approved and the price is confirmed."
          : "This shot is waiting for its review in Shots.";
  return (
    <>
      <Intro shown={shown} title="No Clip Yet">
        <p className="text-body text-pretty text-label-2">{words}</p>
      </Intro>
      <div>
        <Button render={<Link href={blocksHref(projectId)} />}>Open Shots</Button>
      </div>
    </>
  );
}
