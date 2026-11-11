"use client";

import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, ImagePlus, ImageUp, ListChecks, PenLine } from "lucide-react";
import { Button, Hint, cn } from "@/ui";
import { useGuidedDraft } from "../_lib/guided-draft";
import { startFromPromptAction } from "../actions";
import { StageHeading, useAssetScreen } from "./asset-context";
import { GuidedFlow } from "./guided-flow";
import { StageLayout } from "./stage-panels";
import {
  Artwork,
  ErrorLine,
  type Orientation,
  PriceLine,
  canAfford,
  formatNumber,
  type AssetInfo,
  type GuidedQuestion,
} from "./shared";
import { UploadZone } from "./upload-zone";

type Method = "chooser" | "guided" | "prompt" | "upload";

const PLACEHOLDERS: Partial<Record<AssetInfo["kind"], string>> = {
  character: "Age, build, face, hair and clothing. Whatever matters most.",
  location: "The kind of place, its era, materials, light and weather.",
  prop: "What the object is, its material, size, colours and condition.",
  creature: "What kind of creature, its size, body, colours and face.",
  costume: "Every garment, its fabric, colours, fit and condition.",
  other: "Its shape, materials, colours and the details that must not change.",
};

const SUBJECT_HINT =
  "A good reference image shows the subject alone and whole, evenly lit, on a plain background.";

/** The footnote under the prompt: what makes a good reference for this kind of asset. */
const PROMPT_HINTS: Partial<Record<AssetInfo["kind"], string>> = {
  character: `${SUBJECT_HINT} Concrete words work better than moods: name the colours, materials, age and clothing.`,
  creature: `${SUBJECT_HINT} Concrete words work better than moods: name the colours, size, body and markings.`,
  costume: `${SUBJECT_HINT} Concrete words work better than moods: name each garment, its fabric, colours and fit.`,
  location:
    "A good reference image shows the place whole, in even daylight, without people. Concrete words work better than moods: name the era, materials, colours, light and weather.",
  prop: "A good reference image shows the object alone and whole, evenly lit, on a plain background. Concrete words work better than moods: name the material, size, colours and condition.",
  other:
    "A good reference image shows the subject whole and evenly lit. Concrete words work better than moods: name the shape, materials and colours.",
};

export interface AddImageProps {
  projectId: string;
  asset: AssetInfo;
  questions: GuidedQuestion[];
  limits: { prompt: number; answer: number };
  price: number | null;
  balance: number;
  orientation: Orientation;
  /** Shown instead of the chooser's title, e.g. after a failure. */
  title?: string;
  onCancel?: () => void;
}

/** The three ways to give an asset its image, as one chooser that opens into each way. */
export function AddImage(props: AddImageProps) {
  const { asset, questions } = props;
  const { draft, save, clear } = useGuidedDraft(asset.id);
  // Null until the user picks: a saved draft of answers then resumes the questions.
  const [picked, setPicked] = useState<Method | null>(null);
  const method: Method = picked ?? (draft && questions.length > 0 ? "guided" : "chooser");

  if (method === "guided") {
    return (
      <GuidedFlow
        key={asset.id}
        projectId={props.projectId}
        assetId={asset.id}
        assetName={asset.name}
        questions={questions}
        maxAnswer={props.limits.answer}
        price={props.price}
        balance={props.balance}
        initial={draft}
        onSave={save}
        onClear={clear}
        onExit={() => setPicked("chooser")}
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
        onBack={() => setPicked("chooser")}
      />
    );
  }

  if (method === "upload") {
    return (
      <section aria-labelledby="upload-title" className="flex max-w-2xl flex-col gap-6">
        <BackToChooser onClick={() => setPicked("chooser")} />
        <div className="flex flex-col gap-1.5">
          <StageHeading id="upload-title" className="text-title-1">
            Upload an Image
          </StageHeading>
          <p className="text-reading text-label-2">
            Use a photo, a drawing or a still you already have. You review it before the sheet is
            built.
          </p>
        </div>
        <UploadZone projectId={props.projectId} assetId={asset.id} />
      </section>
    );
  }

  const answered = draft ? Object.keys(draft.answers).length : 0;
  const chooser = (
    <section aria-labelledby="add-title" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <StageHeading id="add-title" className="text-title-1">
          {props.title ?? "Add Image"}
        </StageHeading>
        <p className="text-reading text-label-2">
          The image becomes the reference every shot of {asset.name} is made from.
        </p>
      </div>

      <ul className="flex flex-col">
        <MethodRow
          icon={<ListChecks />}
          title={answered > 0 ? "Continue Answering" : "Answer Questions"}
          description={
            answered > 0
              ? `${answered} of ${questions.length} answered. Pick up where you left off.`
              : `Recommended for a first image. ${questions.length} short questions about how ${asset.name} looks.`
          }
          onClick={() => setPicked("guided")}
          hidden={questions.length === 0}
        />
        <MethodRow
          icon={<PenLine />}
          title="Write a Prompt"
          description="Describe the image in your own words."
          onClick={() => setPicked("prompt")}
        />
        <MethodRow
          icon={<ImageUp />}
          title="Upload an Image"
          description="Use an image you already have. No credits needed."
          onClick={() => setPicked("upload")}
        />
      </ul>

      <PriceLine price={props.price} balance={props.balance} action="image" />
      {props.onCancel ? (
        <div>
          <Button onClick={props.onCancel}>Cancel</Button>
        </div>
      ) : null}
    </section>
  );

  // The empty frame shows where the image will stand; on narrow screens the chooser comes first.
  return (
    <StageLayout
      frameClassName="hidden @4xl:block"
      frame={
        <Artwork fileId={null} alt="" shape={props.orientation}>
          <ImagePlus aria-hidden="true" className="size-7 text-label-3" strokeWidth={1.5} />
          <span className="text-callout text-label-2">No image yet</span>
        </Artwork>
      }
      rail={chooser}
    />
  );
}

function MethodRow({
  icon,
  title,
  description,
  onClick,
  hidden = false,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  hidden?: boolean;
}) {
  if (hidden) return null;
  return (
    <li className="relative before:pointer-events-none before:absolute before:inset-x-3 before:top-0 before:h-(--hairline) before:bg-separator first:before:hidden">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "group flex w-full items-center gap-4 rounded-group px-3 py-4 text-left focus-ring",
          "transition-colors duration-(--dur-fast) hover:bg-fill-4 active:bg-fill-3",
        )}
      >
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-fill-3 text-label [&>svg]:size-5"
        >
          {icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-title-3 text-label">{title}</span>
          <span className="text-body text-pretty text-label-2">{description}</span>
        </span>
        <ChevronRight
          aria-hidden="true"
          className="size-(--icon) shrink-0 text-label-3 transition-transform duration-(--dur-fast) group-hover:translate-x-0.5 motion-reduce:transition-none"
        />
      </button>
    </li>
  );
}

function BackToChooser({ onClick }: { onClick: () => void }) {
  return (
    <div>
      <Button variant="plain" leadingIcon={<ChevronLeft />} onClick={onClick} className="-ml-3">
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
  onBack,
}: {
  projectId: string;
  asset: AssetInfo;
  maxLength: number;
  price: number | null;
  balance: number;
  onBack: () => void;
}) {
  const { refresh } = useAssetScreen();
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  const over = prompt.length > maxLength;
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
    <section aria-labelledby={`${id}-title`} className="flex max-w-2xl flex-col gap-6">
      <BackToChooser onClick={onBack} />
      <div className="flex flex-col gap-1.5">
        <StageHeading id={`${id}-title`} className="text-title-1">
          Write a Prompt
        </StageHeading>
        <p className="text-reading text-label-2">
          Describe how {asset.name} should look in the reference image.
        </p>
      </div>

      <div className="flex flex-col">
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
          aria-describedby={`${id}-count ${id}-hint`}
          disabled={sending}
          className={cn(
            "field-sizing-content max-h-[55dvh] min-h-[calc(var(--ts-script-lh)*6+2.5rem)] w-full resize-none bg-transparent py-5 text-script text-label outline-none placeholder:text-label-3",
            "[box-shadow:inset_0_var(--hairline)_0_var(--separator),inset_0_calc(var(--hairline)*-1)_0_var(--separator)]",
            "focus-visible:[box-shadow:inset_0_var(--hairline)_0_var(--label-2),inset_0_calc(var(--hairline)*-1)_0_var(--label-2)]",
            "disabled:text-label-2",
          )}
        />
        <div className="flex items-baseline justify-between gap-4 pt-2">
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
              className="rounded-control-inner text-callout text-label underline-offset-4 focus-ring hover:underline disabled:text-label-3"
            >
              Start from the Script’s Description
            </button>
          ) : (
            <span />
          )}
          <p
            id={`${id}-count`}
            className={cn("shrink-0 text-callout tabular-nums", over ? "text-red" : "text-label-2")}
          >
            <span className="sr-only">Characters used: </span>
            {formatNumber(prompt.length)} / {formatNumber(maxLength)}
          </p>
        </div>
      </div>

      <Hint id={`${id}-hint`}>{PROMPT_HINTS[asset.kind] ?? PROMPT_HINTS.other}</Hint>

      <div className="flex flex-col gap-3">
        <PriceLine price={price} balance={balance} action="image" />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="prominent"
            size="large"
            loading={sending}
            disabled={!affordable}
            onClick={generate}
          >
            Generate Image
          </Button>
        </div>
        <ErrorLine>{error}</ErrorLine>
      </div>
    </section>
  );
}
