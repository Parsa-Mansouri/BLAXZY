"use client";

import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { Button, FeatureBlock, QuietTile, cn } from "@/ui";
import { useGuidedDraft } from "../_lib/guided-draft";
import { startFromPromptAction } from "../actions";
import { StageHeading, useAssetScreen, useFocusOnArrival } from "./asset-context";
import { GuidedFlow } from "./guided-flow";
import {
  ErrorLine,
  PriceLine,
  canAfford,
  formatNumber,
  type AssetInfo,
  type GuidedQuestion,
  type Orientation,
} from "./shared";
import { UploadZone } from "./upload-zone";
import { PICTURE_MAX_H } from "../../../_lib/fill";

/** The empty frame on the leading side, the way of adding the image filling the rest. */
function WithFrame({ orientation, children }: { orientation: Orientation; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-stretch gap-x-12 gap-y-10">
      <div className="min-w-0 flex-[1_1_280px] in-2">
        <EmptyFrame orientation={orientation} />
      </div>
      <div className="flex min-w-0 flex-[2_1_420px] flex-col gap-5">{children}</div>
    </div>
  );
}

export type AddMethod = "chooser" | "guided" | "prompt" | "upload";

const PLACEHOLDERS: Partial<Record<AssetInfo["kind"], string>> = {
  character: "Age, build, face, hair and clothing. Whatever matters most.",
  location: "The kind of place, its era, materials, light and weather.",
  prop: "What the object is, its material, size, colours and condition.",
  creature: "What kind of creature, its size, body, colours and face.",
  costume: "Every garment, its fabric, colours, fit and condition.",
  other: "Its shape, materials, colours and the details that must not change.",
};

/** The one sentence under the prompt's heading: what makes a good reference for this kind. */
const PROMPT_HINTS: Partial<Record<AssetInfo["kind"], string>> = {
  character:
    "Show them alone and whole, evenly lit, on a plain background. Name colours, materials, age and clothing.",
  creature:
    "Show it alone and whole, evenly lit, on a plain background. Name colours, size, body and markings.",
  costume:
    "Show it whole, evenly lit, on a plain background. Name each garment, its fabric, colours and fit.",
  location:
    "Show the place whole, in even daylight, without people. Name the era, materials, colours, light and weather.",
  prop: "Show the object alone and whole, evenly lit, on a plain background. Name the material, size, colours and condition.",
  other: "Show it whole and evenly lit. Name the shape, materials and colours.",
};

/** The empty frame where the image will stand, in the project's shape. */
function EmptyFrame({ orientation }: { orientation: Orientation }) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full items-center justify-center rounded-card border border-dashed border-separator-opaque text-meta text-label-3",
        PICTURE_MAX_H,
        orientation === "portrait" ? "aspect-[9/16]" : "aspect-video",
      )}
    >
      No image yet
    </div>
  );
}

export interface AddImageProps {
  projectId: string;
  asset: AssetInfo;
  questions: GuidedQuestion[];
  limits: { prompt: number; answer: number };
  price: number | null;
  balance: number;
  orientation: Orientation;
  /** Open at this way of adding the image (a card's action led here). */
  initialMethod?: AddMethod;
  /** Shown above the choices, e.g. after a failure. */
  title?: string;
  onCancel?: () => void;
}

/** The three ways to give an asset its image: the questions lead, prompt and upload beside them. */
export function AddImage(props: AddImageProps) {
  const { asset, questions } = props;
  const { draft, save, clear } = useGuidedDraft(asset.id);
  const hasQuestions = questions.length > 0;
  const initial =
    props.initialMethod === "guided" && !hasQuestions ? "chooser" : props.initialMethod;
  // Null until the user picks: a saved draft of answers then resumes the questions.
  const [picked, setPicked] = useState<AddMethod | null>(initial ?? null);
  const method: AddMethod = picked ?? (draft && hasQuestions ? "guided" : "chooser");

  if (method === "guided") {
    return (
      <GuidedFlow
        key={asset.id}
        projectId={props.projectId}
        assetId={asset.id}
        questions={questions}
        maxAnswer={props.limits.answer}
        maxPrompt={props.limits.prompt}
        price={props.price}
        balance={props.balance}
        initial={draft}
        onSave={save}
        onClear={clear}
        onMethod={setPicked}
      />
    );
  }

  if (method === "prompt") {
    return (
      <PromptWriter
        projectId={props.projectId}
        asset={asset}
        maxLength={props.limits.prompt}
        price={props.price}
        balance={props.balance}
        orientation={props.orientation}
        onBack={() => setPicked("chooser")}
      />
    );
  }

  if (method === "upload") {
    return (
      <WithFrame orientation={props.orientation}>
        <section aria-labelledby="upload-title" className="flex flex-1 in-2 flex-col gap-6">
          <BackToChooser onClick={() => setPicked("chooser")} />
          <div className="flex flex-col gap-3">
            <StageHeading id="upload-title" className="text-heading-sm">
              Upload an Image
            </StageHeading>
            <p className="text-body text-label-2">
              Use a photo, a drawing or a still you already have. No credits needed.
            </p>
          </div>
          <UploadZone projectId={props.projectId} assetId={asset.id} grow />
        </section>
      </WithFrame>
    );
  }

  return (
    <Chooser
      {...props}
      hasQuestions={hasQuestions}
      resuming={Boolean(draft && Object.keys(draft.answers).length > 0)}
      onPick={setPicked}
    />
  );
}

function Chooser({
  asset,
  orientation,
  price,
  balance,
  title,
  onCancel,
  hasQuestions,
  resuming,
  onPick,
}: AddImageProps & {
  hasQuestions: boolean;
  resuming: boolean;
  onPick: (method: AddMethod) => void;
}) {
  const lead = useRef<HTMLElement>(null);
  useFocusOnArrival(() => lead.current);
  return (
    <WithFrame orientation={orientation}>
      {title ? <StageHeading className="in-2 text-heading-sm">{title}</StageHeading> : null}
      <div className="flex flex-1 flex-wrap items-stretch gap-3">
        {hasQuestions ? (
          <FeatureBlock
            ref={lead}
            className="flex-[2_1_300px] enter"
            style={{ animationDelay: "300ms" }}
            title={resuming ? "Continue Answering" : "Answer a Few Questions"}
            description={`We ask about ${asset.name}, one thing at a time, and write the prompt for you.`}
            cta={resuming ? "Continue" : "Start"}
            onClick={() => onPick("guided")}
          />
        ) : (
          <FeatureBlock
            ref={lead}
            className="flex-[2_1_300px] enter"
            style={{ animationDelay: "300ms" }}
            title="Write a Prompt"
            description={`Describe how ${asset.name} should look, in your own words.`}
            cta="Start"
            onClick={() => onPick("prompt")}
          />
        )}
        <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-3">
          {hasQuestions ? (
            <QuietTile
              className="flex-1 enter"
              style={{ animationDelay: "340ms" }}
              title="Write a Prompt"
              onClick={() => onPick("prompt")}
            />
          ) : null}
          <QuietTile
            className="flex-1 enter"
            style={{ animationDelay: "380ms" }}
            title="Upload an Image"
            onClick={() => onPick("upload")}
          />
        </div>
      </div>
      <div className="flex in-3 flex-col items-start gap-4">
        <PriceLine price={price} balance={balance} action="image" />
        {onCancel ? (
          <Button variant="plain" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </WithFrame>
  );
}

function BackToChooser({ onClick }: { onClick: () => void }) {
  return (
    <div>
      <Button variant="plain" leadingIcon={<ChevronLeft />} onClick={onClick}>
        Other Ways to Add an Image
      </Button>
    </div>
  );
}

function PromptWriter({
  projectId,
  asset,
  maxLength,
  price,
  balance,
  orientation,
  onBack,
}: {
  projectId: string;
  asset: AssetInfo;
  maxLength: number;
  price: number | null;
  balance: number;
  orientation: Orientation;
  onBack: () => void;
}) {
  const { refresh } = useAssetScreen();
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  const over = prompt.length > maxLength;
  // The count appears once it matters: near the limit.
  const showCount = prompt.length > maxLength * 0.8;
  const affordable = canAfford(price, balance);

  function generate() {
    const trimmed = prompt.trim();
    if (trimmed.length < 3) {
      setError("Describe the image first. One sentence is enough.");
      area.current?.focus();
      return;
    }
    if (over) {
      setError(`Shorten the description to ${formatNumber(maxLength)} characters.`);
      return;
    }
    setError(null);
    startSending(async () => {
      const result = await startFromPromptAction(projectId, asset.id, trimmed);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      refresh();
    });
  }

  return (
    <WithFrame orientation={orientation}>
      <section aria-labelledby={`${id}-title`} className="flex flex-1 in-2 flex-col gap-6">
        <BackToChooser onClick={onBack} />
        <div className="flex flex-col gap-3">
          <StageHeading id={`${id}-title`} className="text-heading-sm">
            Write a Prompt
          </StageHeading>
          <p id={`${id}-hint`} className="text-body text-pretty text-label-2">
            {PROMPT_HINTS[asset.kind] ?? PROMPT_HINTS.other}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-prompt`} className="sr-only">
            Description of the image
          </label>
          <textarea
            ref={area}
            id={`${id}-prompt`}
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                generate();
              }
            }}
            rows={6}
            placeholder={PLACEHOLDERS[asset.kind] ?? PLACEHOLDERS.other}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-hint${showCount ? ` ${id}-count` : ""}`}
            disabled={sending}
            className={cn(
              "field-sizing-content max-h-[55dvh] min-h-[calc(var(--ts-script-lh)*6+2rem)] w-full resize-none rounded-tile border border-separator-opaque bg-elevated px-4 py-3.5 text-script text-label outline-none placeholder:text-label-3",
              "focus-visible:border-label-2 disabled:text-label-2",
            )}
          />
          <div className="flex items-baseline justify-between gap-4">
            {asset.description ? (
              <button
                type="button"
                disabled={sending}
                onClick={() => {
                  setPrompt((current) =>
                    current.trim()
                      ? `${current.trim()}\n\n${asset.description}`
                      : (asset.description ?? ""),
                  );
                  area.current?.focus();
                }}
                className="rounded-row text-secondary text-label underline-offset-4 focus-ring hover:underline disabled:text-label-3"
              >
                Start from the Script’s Description
              </button>
            ) : (
              <span />
            )}
            {showCount ? (
              <p
                id={`${id}-count`}
                className={cn(
                  "shrink-0 text-meta tabular-nums",
                  over ? "text-red" : "text-label-2",
                )}
              >
                <span className="sr-only">Characters used: </span>
                {formatNumber(prompt.length)} / {formatNumber(maxLength)}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-auto flex flex-col items-start gap-3">
          <PriceLine price={price} balance={balance} action="image" />
          <Button
            variant="primary"
            size="large"
            loading={sending}
            disabled={!affordable}
            onClick={generate}
          >
            Generate Image
          </Button>
          <ErrorLine>{error}</ErrorLine>
        </div>
      </section>
    </WithFrame>
  );
}
