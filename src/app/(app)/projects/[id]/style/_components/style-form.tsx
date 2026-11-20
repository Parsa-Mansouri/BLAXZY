"use client";

import { useId, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Minus, Plus } from "lucide-react";
import {
  Alert,
  Button,
  DurationInput,
  FocusLayout,
  IconButton,
  OptionRow,
  OptionTile,
  SelectRow,
  SwapFade,
  cn,
  formatDurationLong,
  stagger,
  useToast,
} from "@/ui";
import { stageHref } from "@/lib/stages";
import {
  BLOCK_LENGTHS,
  DEFAULT_BLOCK_LENGTH,
  DURATION_PRESETS,
  FORMATS,
  GENRES,
  MAX_DURATION_SECONDS,
  MAX_EPISODES,
  OFFERED_BLOCK_LENGTHS,
  ORIENTATION_OPTIONS,
  OTHER_VALUE,
  VISUAL_STYLES,
  durationError,
  episodeCount,
  splitChoice,
  type BlockLength,
  type StyleOption,
} from "@/lib/style-options";
import {
  describeReference,
  hasReference,
  normalizeReference,
  summarizeReference,
  type StyleReferenceInput,
} from "@/lib/style-references";
import { saveStyleAction, type StyleInput } from "../actions";
import { ReferencePanel } from "./reference-panel";

export interface SavedStyle {
  visualStyle: string;
  genre: string;
  format: "movie" | "series";
  orientation: "landscape" | "portrait";
  totalDurationSeconds: number;
  episodeDurationSeconds: number | null;
  blockLength?: BlockLength;
  references?: { visualStyle?: StyleReferenceInput; genre?: StyleReferenceInput };
}

type Format = "movie" | "series";
type Orientation = "landscape" | "portrait";
type QuestionKey = "look" | "genre" | "format" | "length" | "blocks" | "frame";

const QUESTIONS: { key: QuestionKey; label: string }[] = [
  { key: "look", label: "Look" },
  { key: "genre", label: "Genre" },
  { key: "format", label: "Format" },
  { key: "length", label: "Length" },
  { key: "blocks", label: "Blocks" },
  { key: "frame", label: "Frame" },
];

/** The step after the last question: the summary with the save button. */
const DONE = QUESTIONS.length;

/** The "Other" choice's title on every question that has one. */
const NOT_IN_MIND = "Not what you have in mind?";

/**
 * Frame tiles keep their real proportions and grow with the space: both pictures share one
 * height, as tall as the area allows (minus the 32px name line) and as wide as the row allows.
 * Widths in container query units of the frame area (16:9 + 9:16 = 337/144 of the height).
 */
const FRAME_WIDTH: Record<Orientation, string> = {
  landscape: "min(calc((100cqh - 32px) * 16 / 9), calc((100cqw - 16px) * 256 / 337))",
  portrait: "min(calc((100cqh - 32px) * 9 / 16), calc((100cqw - 16px) * 81 / 337))",
};
const FRAME_RATIO: Record<Orientation, string> = { landscape: "16 / 9", portrait: "9 / 16" };

/** Fluid picture grid: as many columns as fit, rows sharing the free height. */
const TILE_GRID =
  "grid min-h-0 flex-1 grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] auto-rows-[minmax(180px,1fr)] gap-4";

/** Episodes a series starts with, before the user sets the count. */
const DEFAULT_EPISODES = 6;
const MIN_EPISODES = 2;

const EMPTY_REFERENCE: StyleReferenceInput = { titles: [], fileIds: [] };

/** 30 -> "30 seconds", 60 -> "1 minute", 600 -> "10 minutes", 90 -> "1 min 30 s". */
function lengthLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  return formatDurationLong(seconds);
}

const isPreset = (seconds: number | null) =>
  seconds !== null && DURATION_PRESETS.some((p) => p.seconds === seconds);

/**
 * The reference a saved look or genre starts from: the stored one, or (older projects) the
 * typed "other" text as its description.
 */
function initialReference(
  stored: StyleReferenceInput | undefined,
  other: string,
): StyleReferenceInput {
  if (stored)
    return { titles: stored.titles, description: stored.description, fileIds: stored.fileIds };
  return other ? { titles: [], description: other, fileIds: [] } : EMPTY_REFERENCE;
}

const sameReference = (a: StyleReferenceInput | undefined, b: StyleReferenceInput) =>
  JSON.stringify(a ? normalizeReference(a) : null) === JSON.stringify(normalizeReference(b));

/** The question in the focus area: its heading, then its options filling the height. */
function Question({
  heading,
  error,
  children,
}: {
  heading: string;
  error: string | null;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="flex min-h-0 min-w-0 flex-1 flex-col gap-6">
      <h2 id={id} className="max-w-[24ch] text-heading text-balance">
        {heading}
      </h2>
      {children}
      {error ? (
        <p role="alert" className="-mt-2 swap-in text-secondary text-pretty text-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function StyleForm({
  projectId,
  saved,
  pastStyleStage,
}: {
  projectId: string;
  saved: SavedStyle | null;
  pastStyleStage: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const savedVisualRef = saved?.references?.visualStyle;
  const savedGenreRef = saved?.references?.genre;
  const initialVisual = savedVisualRef
    ? { choice: OTHER_VALUE, other: "" }
    : splitChoice(saved?.visualStyle, VISUAL_STYLES);
  const initialGenre = savedGenreRef
    ? { choice: OTHER_VALUE, other: "" }
    : splitChoice(saved?.genre, GENRES);

  const [visual, setVisual] = useState<string | null>(initialVisual.choice);
  const [visualRef, setVisualRef] = useState(() =>
    initialReference(savedVisualRef, initialVisual.other),
  );
  const [genre, setGenre] = useState<string | null>(initialGenre.choice);
  const [genreRef, setGenreRef] = useState(() =>
    initialReference(savedGenreRef, initialGenre.other),
  );
  // With "Not what you have in mind?" chosen, the references panel replaces the examples;
  // "Show the Examples" brings them back without losing what was typed.
  const [showExamples, setShowExamples] = useState(false);
  const [format, setFormat] = useState<Format | null>(saved?.format ?? null);
  const [orientation, setOrientation] = useState<Orientation | null>(saved?.orientation ?? null);
  // The total is the source of truth for both formats. For a series it is the episode length
  // times the episode count, recomputed only when the user changes one of them, so a saved total
  // that is not an exact multiple stays as it was.
  const [total, setTotal] = useState<number | null>(saved?.totalDurationSeconds ?? null);
  const [episode, setEpisode] = useState<number | null>(saved?.episodeDurationSeconds ?? null);
  const [count, setCount] = useState(
    saved?.episodeDurationSeconds
      ? episodeCount(saved.totalDurationSeconds, saved.episodeDurationSeconds)
      : DEFAULT_EPISODES,
  );
  // Old projects have none saved: they show 15 s, the default a new project starts with.
  const [blockLength, setBlockLength] = useState<BlockLength>(
    saved?.blockLength ?? DEFAULT_BLOCK_LENGTH,
  );
  const [customOpen, setCustomOpen] = useState(false);

  const [step, setStep] = useState(saved ? DONE : 0);
  // After the first move, swapped-in options arrive quickly instead of after the page entrance.
  const [moved, setMoved] = useState(false);
  const [attempted, setAttempted] = useState<ReadonlySet<QuestionKey>>(new Set());
  const [serverError, setServerError] = useState<string | undefined>();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const isSeries = format === "series";
  const visualIsRef = visual === OTHER_VALUE;
  const genreIsRef = genre === OTHER_VALUE;
  const visualValue = visualIsRef ? describeReference(visualRef) : (visual ?? "");
  const genreValue = genreIsRef ? describeReference(genreRef) : (genre ?? "");
  const lengthValue = isSeries ? episode : total;
  const shownCount =
    isSeries && episode !== null && total !== null ? episodeCount(total, episode) : count;
  const customLength = customOpen || (lengthValue !== null && !isPreset(lengthValue));

  function lengthError(): string | null {
    if (format === null) return "Choose a movie or a series first.";
    if (!isSeries) {
      if (total === null) return "Choose a length.";
      return durationError("total", total, null);
    }
    if (episode === null) return "Choose how long each episode is.";
    return durationError("episode", episode, total) ?? durationError("total", total, null);
  }

  const NEEDS_REFERENCE = "Add a film or show name, a reference image or a description.";
  const errors: Record<QuestionKey, string | null> = {
    look: visualIsRef
      ? hasReference(visualRef)
        ? null
        : NEEDS_REFERENCE
      : visual
        ? null
        : "Choose a look.",
    genre: genreIsRef
      ? hasReference(genreRef)
        ? null
        : NEEDS_REFERENCE
      : genre
        ? null
        : "Choose a genre.",
    format: format ? null : "Choose a movie or a series.",
    length: lengthError(),
    blocks: OFFERED_BLOCK_LENGTHS.includes(blockLength)
      ? null
      : "Choose 15-second or 30-second blocks.",
    frame: orientation ? null : "Choose a frame.",
  };

  // Empty answers only complain after the user tried to move on; a typed length that is out of
  // range complains as soon as it is typed.
  function shownError(key: QuestionKey): string | null {
    const error = errors[key];
    if (!error) return null;
    if (attempted.has(key)) return error;
    if (key === "length" && customLength && lengthValue !== null) return error;
    return null;
  }

  const optionValue = (
    options: readonly StyleOption[],
    value: string | null,
    ref: StyleReferenceInput,
  ) =>
    value === OTHER_VALUE
      ? summarizeReference(ref)
      : (options.find((o) => o.value === value)?.label ?? "");

  const values: Record<QuestionKey, string> = {
    look: optionValue(VISUAL_STYLES, visual, visualRef),
    genre: optionValue(GENRES, genre, genreRef),
    format: FORMATS.find((f) => f.value === format)?.label ?? "",
    length:
      lengthValue === null
        ? ""
        : isSeries
          ? `${lengthLabel(lengthValue)} · ${shownCount} ${shownCount === 1 ? "episode" : "episodes"}`
          : lengthLabel(lengthValue),
    blocks: BLOCK_LENGTHS.find((b) => b.value === blockLength)?.label ?? "",
    frame: ORIENTATION_OPTIONS.find((o) => o.value === orientation)?.label ?? "",
  };

  const first = saved === null;
  const dirty =
    saved === null ||
    saved.visualStyle !== visualValue ||
    saved.genre !== genreValue ||
    (visualIsRef && !sameReference(savedVisualRef, visualRef)) ||
    (genreIsRef && !sameReference(savedGenreRef, genreRef)) ||
    saved.format !== format ||
    saved.orientation !== orientation ||
    (saved.blockLength ?? DEFAULT_BLOCK_LENGTH) !== blockLength ||
    saved.totalDurationSeconds !== total ||
    (isSeries && saved.episodeDurationSeconds !== episode);
  const changesLength =
    saved !== null &&
    (saved.format !== format ||
      saved.totalDurationSeconds !== total ||
      (isSeries && saved.episodeDurationSeconds !== episode));

  function go(next: number) {
    if (next === step) return;
    setMoved(true);
    setShowExamples(false);
    setStep(next);
  }

  const current = QUESTIONS[step];

  function next() {
    if (!current) return;
    if (errors[current.key]) {
      setAttempted((set) => new Set(set).add(current.key));
      return;
    }
    // The next question still waiting for an answer, wrapping round; the summary when none is.
    for (let k = 1; k < QUESTIONS.length; k++) {
      const j = (step + k) % QUESTIONS.length;
      const q = QUESTIONS[j];
      if (q && errors[q.key]) {
        go(j);
        return;
      }
    }
    go(DONE);
  }

  function save() {
    if (total === null || format === null || orientation === null) return;
    const references: NonNullable<StyleInput["references"]> = {
      ...(visualIsRef ? { visualStyle: normalizeReference(visualRef) } : {}),
      ...(genreIsRef ? { genre: normalizeReference(genreRef) } : {}),
    };
    const style: StyleInput = {
      visualStyle: visualValue,
      genre: genreValue,
      format,
      orientation,
      blockLength,
      totalDurationSeconds: total,
      ...(isSeries && episode !== null ? { episodeDurationSeconds: episode } : {}),
      ...(visualIsRef || genreIsRef ? { references } : {}),
    };
    setServerError(undefined);
    startTransition(async () => {
      const result = await saveStyleAction(projectId, style);
      setConfirming(false);
      if (!result.ok) {
        setServerError(result.error);
        return;
      }
      if (pastStyleStage) {
        toast.success("Changes saved.");
        router.refresh();
      } else {
        router.push(stageHref(projectId, "script"));
      }
    });
  }

  function submit() {
    const firstWrong = QUESTIONS.findIndex((q) => errors[q.key]);
    if (firstWrong !== -1) {
      setAttempted(new Set(QUESTIONS.map((q) => q.key)));
      go(firstWrong);
      return;
    }
    if (pastStyleStage && changesLength) {
      setConfirming(true);
      return;
    }
    save();
  }

  function pickLength(seconds: number) {
    setCustomOpen(false);
    setLength(seconds);
  }

  function setLength(seconds: number | null) {
    if (!isSeries) {
      setTotal(seconds);
      return;
    }
    setEpisode(seconds);
    if (seconds !== null) setTotal(seconds * shownCount);
  }

  function setEpisodes(n: number) {
    setCount(n);
    if (episode !== null) setTotal(episode * n);
  }

  const maxEpisodes =
    episode !== null
      ? Math.min(MAX_EPISODES, Math.floor(MAX_DURATION_SECONDS / episode))
      : MAX_EPISODES;
  const base = moved ? 40 : 300;

  /** Picture options plus "Not what you have in mind?", or the references panel when chosen. */
  function optionTiles(
    subject: "look" | "genre",
    options: readonly StyleOption[],
    value: string | null,
    onPick: (v: string) => void,
    ref: StyleReferenceInput,
    onRef: (update: (prev: StyleReferenceInput) => StyleReferenceInput) => void,
  ) {
    if (value === OTHER_VALUE && !showExamples) {
      return (
        <>
          <ReferencePanel projectId={projectId} subject={subject} value={ref} onChange={onRef} />
          <div>
            <Button variant="plain" onClick={() => setShowExamples(true)}>
              Show the Examples
            </Button>
          </div>
        </>
      );
    }
    return (
      <div className={TILE_GRID}>
        {options.map((o, i) => (
          <OptionTile
            key={o.value}
            fill
            label={o.label}
            src={o.image}
            selected={value === o.value}
            onSelect={() => onPick(o.value)}
            className="enter"
            style={stagger(i, base)}
          />
        ))}
        <OptionTile
          fill
          kind="other"
          label={NOT_IN_MIND}
          selected={value === OTHER_VALUE}
          onSelect={() => {
            onPick(OTHER_VALUE);
            setShowExamples(false);
          }}
          className="enter"
          style={stagger(options.length, base)}
        />
      </div>
    );
  }

  function questionBody(key: QuestionKey) {
    switch (key) {
      case "look":
        return (
          <Question heading="What should it look like?" error={shownError("look")}>
            {optionTiles("look", VISUAL_STYLES, visual, setVisual, visualRef, setVisualRef)}
          </Question>
        );
      case "genre":
        return (
          <Question heading="What kind of story is it?" error={shownError("genre")}>
            {optionTiles("genre", GENRES, genre, setGenre, genreRef, setGenreRef)}
          </Question>
        );
      case "format":
        return (
          <Question heading="Is it a movie or a series?" error={shownError("format")}>
            <div className={TILE_GRID}>
              {FORMATS.map((f, i) => (
                <OptionTile
                  key={f.value}
                  fill
                  label={f.label}
                  selected={format === f.value}
                  onSelect={() => setFormat(f.value)}
                  className="enter"
                  style={stagger(i, base)}
                />
              ))}
            </div>
          </Question>
        );
      case "length":
        return (
          <Question
            heading={
              isSeries ? "How long is each episode, and how many?" : "How long should it be?"
            }
            error={shownError("length")}
          >
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-3">
              {DURATION_PRESETS.map((p, i) => (
                <OptionRow
                  key={p.seconds}
                  selected={!customLength && lengthValue === p.seconds}
                  onSelect={() => pickLength(p.seconds)}
                  className="min-h-32 enter items-end pb-5 text-heading-sm font-semibold tabular-nums"
                  style={stagger(i, base)}
                >
                  {lengthLabel(p.seconds)}
                </OptionRow>
              ))}
              <OptionRow
                selected={customLength}
                onSelect={() => setCustomOpen(true)}
                className="min-h-32 enter items-end pb-5 text-heading-sm font-semibold text-balance"
                style={stagger(DURATION_PRESETS.length, base)}
              >
                Other Length
              </OptionRow>
            </div>
            <div className="flex flex-wrap items-center gap-x-12 gap-y-4">
              {customLength ? (
                <DurationInput
                  className="swap-in"
                  value={lengthValue}
                  onValueChange={setLength}
                  max={MAX_DURATION_SECONDS}
                  aria-label={isSeries ? "Episode length" : "Length"}
                />
              ) : null}
              {isSeries ? (
                <div className="flex swap-in flex-wrap items-center gap-x-6 gap-y-3">
                  <span id="episodes-label" className="text-row">
                    Episodes
                  </span>
                  {/* Capsules in a capsule: the corners stay concentric at any padding. */}
                  <div
                    role="group"
                    aria-labelledby="episodes-label"
                    className="flex items-center gap-1 rounded-capsule border border-separator-opaque p-1"
                  >
                    <IconButton
                      label="One Episode Fewer"
                      tooltip={false}
                      className="bg-selected"
                      icon={<Minus aria-hidden="true" strokeWidth={1.5} />}
                      onClick={() => setEpisodes(Math.max(MIN_EPISODES, shownCount - 1))}
                      disabled={shownCount <= MIN_EPISODES}
                    />
                    {/* Keyed by the count: each change settles in. */}
                    <span aria-live="polite" className="min-w-10 text-center text-row tabular-nums">
                      <span key={shownCount} className="inline-block swap-in">
                        {shownCount}
                      </span>
                    </span>
                    <IconButton
                      label="One More Episode"
                      tooltip={false}
                      className="bg-selected"
                      icon={<Plus aria-hidden="true" strokeWidth={1.5} />}
                      onClick={() => setEpisodes(Math.min(maxEpisodes, shownCount + 1))}
                      disabled={shownCount >= maxEpisodes}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </Question>
        );
      case "blocks":
        return (
          <Question heading="How long is each clip?" error={shownError("blocks")}>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-3">
              {BLOCK_LENGTHS.filter((b) => OFFERED_BLOCK_LENGTHS.includes(b.value)).map((b, i) => (
                <OptionRow
                  key={b.value}
                  selected={blockLength === b.value}
                  onSelect={() => setBlockLength(b.value)}
                  className="min-h-32 enter items-end pb-5"
                  style={stagger(i, base)}
                >
                  <span className="block text-heading-sm font-semibold">{b.label}</span>
                  <span className="font-normal mt-1 block text-secondary text-pretty text-label-2">
                    {b.description}
                  </span>
                </OptionRow>
              ))}
            </div>
          </Question>
        );
      case "frame":
        return (
          <Question heading="Which way is it framed?" error={shownError("frame")}>
            <div className="[container-type:size] relative min-h-60 flex-1">
              <div className="absolute inset-0 flex items-end justify-center gap-4">
                {ORIENTATION_OPTIONS.map((o, i) => (
                  <OptionTile
                    key={o.value}
                    label={o.label}
                    selected={orientation === o.value}
                    onSelect={() => setOrientation(o.value)}
                    width={FRAME_WIDTH[o.value]}
                    aspectRatio={FRAME_RATIO[o.value]}
                    className="enter"
                    style={stagger(i, base)}
                  />
                ))}
              </div>
            </div>
          </Question>
        );
    }
  }

  const ready = current ? !errors[current.key] : true;

  return (
    <>
      <FocusLayout
        fill
        listLabel="Your style choices"
        list={QUESTIONS.map((q, i) => (
          <SelectRow
            key={q.key}
            label={q.label}
            value={values[q.key] || undefined}
            done={values[q.key] !== "" && !errors[q.key]}
            active={i === step}
            onClick={() => go(i)}
            // The tick settles in when an answer is saved; the value is set in tabular figures.
            className="enter tabular-nums [&>svg]:swap-in"
            style={stagger(i)}
          />
        ))}
      >
        <SwapFade swapKey={step} className="flex min-h-0 flex-1 flex-col gap-12">
          {current ? (
            <>
              {questionBody(current.key)}
              <div className="mt-auto flex flex-wrap items-center gap-6">
                <Button variant={ready ? "primary" : "dark"} size="large" onClick={next}>
                  Next
                </Button>
                {step > 0 ? (
                  <Button variant="plain" size="large" onClick={() => go(step - 1)}>
                    Back
                  </Button>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                <h2 className="max-w-[24ch] text-heading text-balance">
                  {first
                    ? "Is this the film you want to make?"
                    : dirty
                      ? "Save the new style?"
                      : "This is the style of your film."}
                </h2>
                <p className="max-w-(--measure) text-body text-pretty text-label-2">
                  {first
                    ? "Press any choice to change it before the script is written."
                    : dirty && pastStyleStage
                      ? "Changing the style later may require the script to be revised."
                      : "Press any choice to change it."}
                </p>
              </div>
              <ul
                aria-label="Your answers"
                className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-3"
              >
                {QUESTIONS.map((q, i) => (
                  <li key={q.key} className="enter" style={stagger(i, base)}>
                    {/*
                      An answer that opens its question again. The kit QuietTile has no small
                      label above a large value, so this tile is drawn here on the same tokens.
                    */}
                    <button
                      type="button"
                      onClick={() => go(i)}
                      className="flex size-full min-h-40 press flex-col justify-between gap-6 rounded-card bg-elevated p-5 text-left focus-ring hover:bg-fill-4"
                    >
                      <span className="text-secondary text-label-2">{q.label}</span>
                      <span
                        className={cn(
                          "text-heading-sm text-balance break-words tabular-nums",
                          values[q.key] ? "text-label" : "text-label-3",
                        )}
                      >
                        {values[q.key] || "Not answered"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex flex-col gap-3">
                {serverError ? (
                  <p role="alert" className="swap-in text-secondary text-pretty text-red">
                    {serverError}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  {first || dirty ? (
                    <Button variant="primary" size="large" loading={pending} onClick={submit}>
                      {first ? "Continue to Script" : "Save Changes"}
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      size="large"
                      render={<Link href={stageHref(projectId, "script")} />}
                    >
                      Continue to Script
                    </Button>
                  )}
                  <Button variant="plain" size="large" onClick={() => go(DONE - 1)}>
                    Back
                  </Button>
                </div>
              </div>
            </>
          )}
        </SwapFade>
      </FocusLayout>

      <Alert
        open={confirming}
        onOpenChange={setConfirming}
        title="Change the Format or Length?"
        message="The script may need to be revised to fit the new length."
        confirmLabel="Save Changes"
        destructive={false}
        loading={pending}
        onConfirm={save}
      />
    </>
  );
}
