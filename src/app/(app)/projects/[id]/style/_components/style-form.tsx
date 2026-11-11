"use client";

import { useId, useRef, useState, useTransition, type ReactNode } from "react";
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
  Textarea,
  formatDurationLong,
  stagger,
  useToast,
} from "@/ui";
import { stageHref } from "@/lib/stages";
import {
  DURATION_PRESETS,
  FORMATS,
  GENRES,
  MAX_DURATION_SECONDS,
  MAX_EPISODES,
  ORIENTATION_OPTIONS,
  OTHER_VALUE,
  VISUAL_STYLES,
  durationError,
  episodeCount,
  splitChoice,
  type StyleOption,
} from "@/lib/style-options";
import { saveStyleAction, type StyleInput } from "../actions";

export interface SavedStyle {
  visualStyle: string;
  genre: string;
  format: "movie" | "series";
  orientation: "landscape" | "portrait";
  totalDurationSeconds: number;
  episodeDurationSeconds: number | null;
}

type Format = "movie" | "series";
type Orientation = "landscape" | "portrait";
type QuestionKey = "look" | "genre" | "format" | "length" | "frame";

const QUESTIONS: { key: QuestionKey; label: string }[] = [
  { key: "look", label: "Look" },
  { key: "genre", label: "Genre" },
  { key: "format", label: "Format" },
  { key: "length", label: "Length" },
  { key: "frame", label: "Frame" },
];

/** The step after the last question: the summary with the save button. */
const DONE = QUESTIONS.length;

/** Real frame proportions, side by side. */
const FRAME_SHAPE: Record<Orientation, { width: string; aspectRatio: string }> = {
  landscape: { width: "288px", aspectRatio: "16 / 9" },
  portrait: { width: "162px", aspectRatio: "9 / 16" },
};

/** Episodes a series starts with, before the user sets the count. */
const DEFAULT_EPISODES = 6;
const MIN_EPISODES = 2;

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

function optionLabel(options: readonly StyleOption[], value: string | null, other: string) {
  if (value === OTHER_VALUE) return other.trim() || "Other";
  return options.find((o) => o.value === value)?.label ?? "";
}

/** The question in the focus area: its heading, its options, then its error. */
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
    <div role="group" aria-labelledby={id} className="flex min-w-0 flex-col gap-4">
      <h2 id={id} className="mb-2 text-heading text-balance">
        {heading}
      </h2>
      {children}
      {error ? (
        <p role="alert" className="text-secondary text-red">
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
  const initialVisual = splitChoice(saved?.visualStyle, VISUAL_STYLES);
  const initialGenre = splitChoice(saved?.genre, GENRES);

  const [visual, setVisual] = useState<string | null>(initialVisual.choice);
  const [visualOther, setVisualOther] = useState(initialVisual.other);
  const [genre, setGenre] = useState<string | null>(initialGenre.choice);
  const [genreOther, setGenreOther] = useState(initialGenre.other);
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
  const [customOpen, setCustomOpen] = useState(false);

  const [step, setStep] = useState(saved ? DONE : 0);
  // After the first move, swapped-in options arrive quickly instead of after the page entrance.
  const [moved, setMoved] = useState(false);
  const [attempted, setAttempted] = useState<ReadonlySet<QuestionKey>>(new Set());
  const [serverError, setServerError] = useState<string | undefined>();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const otherField = useRef<HTMLTextAreaElement>(null);

  const isSeries = format === "series";
  const visualValue = visual === OTHER_VALUE ? visualOther.trim() : (visual ?? "");
  const genreValue = genre === OTHER_VALUE ? genreOther.trim() : (genre ?? "");
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

  const errors: Record<QuestionKey, string | null> = {
    look: visualValue ? null : visual === OTHER_VALUE ? "Describe the look." : "Choose a look.",
    genre: genreValue ? null : genre === OTHER_VALUE ? "Describe the genre." : "Choose a genre.",
    format: format ? null : "Choose a movie or a series.",
    length: lengthError(),
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

  const values: Record<QuestionKey, string> = {
    look: optionLabel(VISUAL_STYLES, visual, visualOther),
    genre: optionLabel(GENRES, genre, genreOther),
    format: FORMATS.find((f) => f.value === format)?.label ?? "",
    length:
      lengthValue === null
        ? ""
        : isSeries
          ? `${lengthLabel(lengthValue)} · ${shownCount} ${shownCount === 1 ? "episode" : "episodes"}`
          : lengthLabel(lengthValue),
    frame: ORIENTATION_OPTIONS.find((o) => o.value === orientation)?.label ?? "",
  };

  const first = saved === null;
  const dirty =
    saved === null ||
    saved.visualStyle !== visualValue ||
    saved.genre !== genreValue ||
    saved.format !== format ||
    saved.orientation !== orientation ||
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
    const style: StyleInput = {
      visualStyle: visualValue,
      genre: genreValue,
      format,
      orientation,
      totalDurationSeconds: total,
      ...(isSeries && episode !== null ? { episodeDurationSeconds: episode } : {}),
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

  function chooseOther(setter: (v: string) => void) {
    setter(OTHER_VALUE);
    requestAnimationFrame(() => otherField.current?.focus());
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

  function optionTiles(
    options: readonly StyleOption[],
    value: string | null,
    onPick: (v: string) => void,
    other?: { text: string; onText: (v: string) => void; label: string },
  ) {
    return (
      <>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
          {options.map((o, i) => (
            <OptionTile
              key={o.value}
              label={o.label}
              src={o.image}
              selected={value === o.value}
              onSelect={() => onPick(o.value)}
              className="enter"
              style={stagger(i, base)}
            />
          ))}
          {other ? (
            <OptionTile
              kind="other"
              label="Other"
              selected={value === OTHER_VALUE}
              onSelect={() => chooseOther(onPick)}
              className="enter"
              style={stagger(options.length, base)}
            />
          ) : null}
        </div>
        {other && value === OTHER_VALUE ? (
          <Textarea
            ref={otherField}
            className="swap-in"
            textStyle="script"
            minRows={2}
            maxRows={6}
            maxLength={120}
            value={other.text}
            onChange={(e) => other.onText(e.target.value)}
            placeholder="Describe it in your own words."
            aria-label={other.label}
          />
        ) : null}
      </>
    );
  }

  function questionBody(key: QuestionKey) {
    switch (key) {
      case "look":
        return (
          <Question heading="What should it look like?" error={shownError("look")}>
            {optionTiles(VISUAL_STYLES, visual, setVisual, {
              text: visualOther,
              onText: setVisualOther,
              label: "Describe the look in your own words",
            })}
          </Question>
        );
      case "genre":
        return (
          <Question heading="What kind of story is it?" error={shownError("genre")}>
            {optionTiles(GENRES, genre, setGenre, {
              text: genreOther,
              onText: setGenreOther,
              label: "Describe the genre in your own words",
            })}
          </Question>
        );
      case "format":
        return (
          <Question heading="Is it a movie or a series?" error={shownError("format")}>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
              {FORMATS.map((f, i) => (
                <OptionTile
                  key={f.value}
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
            <div className="flex max-w-140 flex-col gap-2">
              {DURATION_PRESETS.map((p, i) => (
                <OptionRow
                  key={p.seconds}
                  selected={!customLength && lengthValue === p.seconds}
                  onSelect={() => pickLength(p.seconds)}
                  className="enter"
                  style={stagger(i, base)}
                >
                  {lengthLabel(p.seconds)}
                </OptionRow>
              ))}
              <OptionRow
                selected={customLength}
                onSelect={() => setCustomOpen(true)}
                className="enter"
                style={stagger(DURATION_PRESETS.length, base)}
              >
                Other Length
              </OptionRow>
            </div>
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
              <div className="mt-2 flex max-w-140 swap-in flex-wrap items-center justify-between gap-x-6 gap-y-3">
                <span id="episodes-label" className="text-row">
                  Number of Episodes
                </span>
                <div
                  role="group"
                  aria-labelledby="episodes-label"
                  className="flex items-center gap-1 rounded-capsule border border-separator-opaque p-[3px]"
                >
                  <IconButton
                    label="One Episode Fewer"
                    tooltip={false}
                    className="bg-selected"
                    icon={<Minus aria-hidden="true" />}
                    onClick={() => setEpisodes(Math.max(MIN_EPISODES, shownCount - 1))}
                    disabled={shownCount <= MIN_EPISODES}
                  />
                  <span aria-live="polite" className="min-w-10 text-center text-row tabular-nums">
                    {shownCount}
                  </span>
                  <IconButton
                    label="One More Episode"
                    tooltip={false}
                    className="bg-selected"
                    icon={<Plus aria-hidden="true" />}
                    onClick={() => setEpisodes(Math.min(maxEpisodes, shownCount + 1))}
                    disabled={shownCount >= maxEpisodes}
                  />
                </div>
              </div>
            ) : null}
          </Question>
        );
      case "frame":
        return (
          <Question heading="Which way is it framed?" error={shownError("frame")}>
            <div className="flex flex-wrap items-end gap-4">
              {ORIENTATION_OPTIONS.map((o, i) => (
                <OptionTile
                  key={o.value}
                  label={o.label}
                  selected={orientation === o.value}
                  onSelect={() => setOrientation(o.value)}
                  width={FRAME_SHAPE[o.value].width}
                  aspectRatio={FRAME_SHAPE[o.value].aspectRatio}
                  className="enter"
                  style={stagger(i, base)}
                />
              ))}
            </div>
          </Question>
        );
    }
  }

  const ready = current ? !errors[current.key] : true;

  return (
    <>
      <FocusLayout
        listLabel="Your style choices"
        list={QUESTIONS.map((q, i) => (
          <SelectRow
            key={q.key}
            label={q.label}
            value={values[q.key] || undefined}
            done={values[q.key] !== "" && !errors[q.key]}
            active={i === step}
            onClick={() => go(i)}
            className="enter"
            style={stagger(i)}
          />
        ))}
      >
        <SwapFade swapKey={step} className="flex flex-col gap-8">
          {current ? (
            <>
              {questionBody(current.key)}
              <div className="flex flex-wrap items-center gap-6">
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
                <h2 className="text-heading text-balance">That is the style.</h2>
                <p className="max-w-[44ch] text-body text-label-2">
                  {first
                    ? "Press any choice in the list to change it before the script is written."
                    : dirty && pastStyleStage
                      ? "Changing the style later may require the script to be revised."
                      : "Press any choice in the list to change it."}
                </p>
              </div>
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
              {serverError ? (
                <p role="alert" className="text-secondary text-red">
                  {serverError}
                </p>
              ) : null}
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
