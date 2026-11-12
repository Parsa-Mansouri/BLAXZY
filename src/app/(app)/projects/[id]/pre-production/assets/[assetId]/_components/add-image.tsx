"use client";

import { useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import {
  Button,
  DemoHint,
  DropScene,
  FeatureBlock,
  QuietTile,
  Textarea,
  TypingScene,
  cn,
  samplePrompt,
  clipText,
  stagger,
} from "@/ui";
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
} from "./shared";
import { UploadZone } from "./upload-zone";
import { useFileDrop } from "./use-file-drop";

/** The way of adding the image, full width: no empty picture frame, since there is no image yet. */
function MethodLayout({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-5">{children}</div>;
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

export interface AddImageProps {
  projectId: string;
  asset: AssetInfo;
  questions: GuidedQuestion[];
  limits: { prompt: number; answer: number };
  price: number | null;
  balance: number;
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
  // A file dropped on the Upload an Image tile, uploaded as soon as the upload view opens.
  const [dropped, setDropped] = useState<File | undefined>(undefined);

  function pick(next: AddMethod, file?: File) {
    setDropped(next === "upload" ? file : undefined);
    setPicked(next);
  }

  if (method === "guided") {
    return (
      <GuidedFlow
        key={asset.id}
        projectId={props.projectId}
        assetId={asset.id}
        assetName={asset.name}
        assetDescription={asset.description}
        questions={questions}
        maxAnswer={props.limits.answer}
        maxPrompt={props.limits.prompt}
        price={props.price}
        balance={props.balance}
        initial={draft}
        onSave={save}
        onClear={clear}
        onMethod={(next) => pick(next)}
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
        onBack={() => pick("chooser")}
      />
    );
  }

  if (method === "upload") {
    return (
      <MethodLayout>
        <section aria-labelledby="upload-title" className="flex flex-1 in-2 flex-col gap-6">
          <BackToChooser onClick={() => pick("chooser")} />
          <div className="flex flex-col gap-3">
            <StageHeading id="upload-title" className="text-heading-sm">
              Upload an Image
            </StageHeading>
            <p className="text-body text-label-2">
              Use a photo, a drawing or a still you already have. No credits needed.
            </p>
          </div>
          <UploadZone
            projectId={props.projectId}
            assetId={asset.id}
            assetName={asset.name}
            grow
            initialFile={dropped}
          />
        </section>
      </MethodLayout>
    );
  }

  return (
    <Chooser
      {...props}
      hasQuestions={hasQuestions}
      resuming={Boolean(draft && Object.keys(draft.answers).length > 0)}
      onPick={pick}
    />
  );
}

function Chooser({
  asset,
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
  /** `file`: one dropped on the Upload an Image tile, to upload straight away. */
  onPick: (method: AddMethod, file?: File) => void;
}) {
  const lead = useRef<HTMLElement>(null);
  useFocusOnArrival(() => lead.current);
  const prompt = useMemo(
    () => samplePrompt(asset.kind, asset.name, asset.description),
    [asset.kind, asset.name, asset.description],
  );
  // The Upload an Image tile is a real drop target: a file let go on it opens the upload view
  // and starts uploading. UploadZone checks the type and size.
  const { dragging, dropProps } = useFileDrop({ onFile: (file) => onPick("upload", file) });
  return (
    <MethodLayout>
      {title ? <StageHeading className="in-2 text-heading-sm">{title}</StageHeading> : null}
      <div className="flex flex-1 flex-wrap items-stretch gap-3">
        {hasQuestions ? (
          <FeatureBlock
            ref={lead}
            className="flex-[2_1_300px] enter"
            style={stagger(0)}
            title={resuming ? "Continue Answering" : "Answer a Few Questions"}
            description={`We ask about ${asset.name}, one thing at a time, and write the prompt for you.`}
            cta={resuming ? "Continue" : "Start"}
            onClick={() => onPick("guided")}
          />
        ) : (
          <FeatureBlock
            ref={lead}
            className="flex-[2_1_300px] enter"
            style={stagger(0)}
            title="Write a Prompt"
            description={`Describe how ${asset.name} should look, in your own words.`}
            cta="Start"
            onClick={() => onPick("prompt")}
            demo={
              // On the white block: its 32px padding, a lighter ink, and the prompt typed above the
              // Start pill rather than under the title.
              <DemoHint mask="none" className="[--demo-ink:var(--label-3)] [--demo-pad:2rem]">
                <TypingScene
                  lines={[clipText(prompt, 90)]}
                  className="content-end pb-[calc(var(--demo-pad)+var(--btn-lg)+1.5rem)]"
                />
              </DemoHint>
            }
          />
        )}
        <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-3">
          {hasQuestions ? (
            <QuietTile
              className="flex-1 enter"
              style={stagger(1)}
              title="Write a Prompt"
              onClick={() => onPick("prompt")}
              demo={
                <DemoHint>
                  <TypingScene lines={[prompt]} />
                </DemoHint>
              }
            />
          ) : null}
          <QuietTile
            {...dropProps}
            className={cn(
              "flex-1 enter",
              dragging &&
                "bg-elevated-2 outline-1 -outline-offset-1 outline-brand outline-dashed hover:bg-elevated-2",
            )}
            style={stagger(2)}
            title="Upload an Image"
            onClick={() => onPick("upload")}
            demo={
              <DemoHint delay={750} mask="none" className={cn(dragging && "invisible")}>
                <DropScene variant="image" />
              </DemoHint>
            }
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
    </MethodLayout>
  );
}

function BackToChooser({ onClick }: { onClick: () => void }) {
  return (
    <div>
      <Button
        variant="plain"
        leadingIcon={<ChevronLeft strokeWidth={1.5} />}
        onClick={onClick}
        className="pl-0"
      >
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
  const { moveOn } = useAssetScreen();
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
      moveOn(result.data, `Creating ${asset.name}’s image`);
    });
  }

  return (
    <MethodLayout>
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
          <Textarea
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
            minRows={6}
            maxRows={16}
            textStyle="script"
            placeholder={PLACEHOLDERS[asset.kind] ?? PLACEHOLDERS.other}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-hint${showCount ? ` ${id}-count` : ""}`}
            disabled={sending}
          />
          <div className="flex items-baseline justify-between gap-4">
            {asset.description ? (
              <Button
                variant="plain"
                size="small"
                className="pl-0"
                disabled={sending}
                onClick={() => {
                  setPrompt((current) =>
                    current.trim()
                      ? `${current.trim()}\n\n${asset.description}`
                      : (asset.description ?? ""),
                  );
                  area.current?.focus();
                }}
              >
                Start from the Script’s Description
              </Button>
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
    </MethodLayout>
  );
}
