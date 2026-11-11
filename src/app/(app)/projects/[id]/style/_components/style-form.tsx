"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import {
  Alert,
  Button,
  ChoiceCards,
  DurationInput,
  Field,
  Hint,
  Input,
  SegmentedControl,
  Select,
  useToast,
  type ChoiceOption,
} from "@/ui";
import { stageHref } from "@/lib/stages";
import {
  DURATION_PRESETS,
  FORMATS,
  GENRES,
  ORIENTATION_OPTIONS,
  OTHER_VALUE,
  VISUAL_STYLES,
  durationError,
  episodeCount,
  splitChoice,
} from "@/lib/style-options";
import { saveStyleAction, type StyleInput } from "../actions";
import {
  Animation2dThumbnail,
  Animation3dThumbnail,
  CinematicThumbnail,
  FrameThumbnail,
} from "./thumbnails";

export interface SavedStyle {
  visualStyle: string;
  genre: string;
  format: "movie" | "series";
  orientation: "landscape" | "portrait";
  totalDurationSeconds: number;
  episodeDurationSeconds: number | null;
}

const VISUAL_THUMBNAILS: Record<string, ReactNode> = {
  "cinematic-live-action": <CinematicThumbnail />,
  "3d-animation": <Animation3dThumbnail />,
  "2d-animation": <Animation2dThumbnail />,
};

const VISUAL_OPTIONS: ChoiceOption[] = [
  ...VISUAL_STYLES.map((o) => ({
    value: o.value,
    title: o.label,
    description: o.description,
    thumbnail: VISUAL_THUMBNAILS[o.value],
  })),
  {
    value: OTHER_VALUE,
    title: "Other",
    description: "Describe a look in your own words.",
    icon: <Pencil aria-hidden="true" />,
  },
];

const ORIENTATION_CHOICES: ChoiceOption[] = ORIENTATION_OPTIONS.map((o) => ({
  value: o.value,
  title: o.label,
  description: o.description,
  thumbnail: <FrameThumbnail orientation={o.value} />,
}));

const GENRE_OPTIONS = [
  ...GENRES.map((g) => ({ value: g.value, label: g.label, description: g.description })),
  { value: OTHER_VALUE, label: "Other", description: "Describe a genre in your own words." },
];

function Question({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-3 text-title-3">{title}</legend>
      {children}
      <Hint>{hint}</Hint>
    </fieldset>
  );
}

function presetValue(seconds: number | null): string {
  return DURATION_PRESETS.find((p) => p.seconds === seconds)?.seconds.toString() ?? "";
}

function DurationPicker({
  label,
  value,
  onChange,
  error,
  hint,
}: {
  label: string;
  value: number | null;
  onChange: (seconds: number | null) => void;
  error: string | null;
  hint?: ReactNode;
}) {
  return (
    <Field label={label} error={error ?? undefined} hint={hint}>
      <div className="flex flex-wrap items-center gap-3">
        <DurationInput value={value} onValueChange={onChange} aria-label={label} />
        <SegmentedControl
          aria-label={`${label} presets`}
          value={presetValue(value)}
          onValueChange={(next) => onChange(Number(next))}
          options={DURATION_PRESETS.map((p) => ({ value: String(p.seconds), label: p.label }))}
        />
      </div>
    </Field>
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
  const [orientation, setOrientation] = useState<"landscape" | "portrait">(
    saved?.orientation ?? "landscape",
  );
  const [format, setFormat] = useState<"movie" | "series">(saved?.format ?? "movie");
  const [total, setTotal] = useState<number | null>(saved?.totalDurationSeconds ?? null);
  const [episode, setEpisode] = useState<number | null>(saved?.episodeDurationSeconds ?? null);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | undefined>();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const isSeries = format === "series";
  const visualValue = visual === OTHER_VALUE ? visualOther.trim() : (visual ?? "");
  const genreValue = genre === OTHER_VALUE ? genreOther.trim() : (genre ?? "");

  const visualError = visualValue
    ? null
    : visual === OTHER_VALUE
      ? "Describe the visual style."
      : "Choose a visual style.";
  const genreError = genreValue
    ? null
    : genre === OTHER_VALUE
      ? "Describe the genre."
      : "Choose a genre.";
  const totalError = durationError("total", total, null);
  const episodeError = isSeries ? durationError("episode", episode, total) : null;

  // Empty answers only complain after a submit attempt; wrong values complain as soon as typed.
  const show = (error: string | null, empty: boolean) =>
    error && (submitted || !empty) ? error : null;
  const totalShown = show(totalError, total === null);
  const episodeShown = show(episodeError, episode === null);
  const episodes =
    isSeries && total !== null && episode !== null && !totalError && !episodeError
      ? episodeCount(total, episode)
      : null;

  const hasErrors = Boolean(visualError || genreError || totalError || episodeError);
  const first = saved === null;
  const changesLength =
    saved !== null &&
    (saved.format !== format ||
      saved.totalDurationSeconds !== total ||
      (isSeries && saved.episodeDurationSeconds !== episode));

  function save() {
    if (total === null) return;
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

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (hasErrors) return;
    if (pastStyleStage && changesLength) {
      setConfirming(true);
      return;
    }
    save();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-10">
      <Question
        title="Visual Style"
        hint="Sets how every shot looks. It stays the same across the whole film."
      >
        <ChoiceCards
          aria-label="Visual style"
          aspect="video"
          options={VISUAL_OPTIONS}
          value={visual}
          onValueChange={setVisual}
        />
        {visual === OTHER_VALUE ? (
          <Field label="Describe the Visual Style" className="max-w-(--form-w)">
            <Input
              value={visualOther}
              onChange={(e) => setVisualOther(e.target.value)}
              placeholder="Stop-motion clay"
              maxLength={120}
              autoComplete="off"
              autoFocus
            />
          </Field>
        ) : null}
        {submitted && visualError ? (
          <p role="alert" className="text-callout text-red">
            {visualError}
          </p>
        ) : null}
      </Question>

      <Question title="Genre" hint="Shapes the tone of the script and the pace of its scenes.">
        <div className="flex max-w-(--form-w) flex-col gap-3">
          <Select
            aria-label="Genre"
            size="large"
            options={GENRE_OPTIONS}
            value={genre}
            onValueChange={setGenre}
            placeholder="Choose a Genre"
            className="w-full"
          />
          {genre === OTHER_VALUE ? (
            <Field label="Describe the Genre">
              <Input
                value={genreOther}
                onChange={(e) => setGenreOther(e.target.value)}
                placeholder="Western"
                maxLength={120}
                autoComplete="off"
                autoFocus
              />
            </Field>
          ) : null}
          {submitted && genreError ? (
            <p role="alert" className="text-callout text-red">
              {genreError}
            </p>
          ) : null}
        </div>
      </Question>

      <Question
        title="Orientation"
        hint="Landscape suits cinema and television. Portrait suits phones and short-form feeds."
      >
        <ChoiceCards
          aria-label="Orientation"
          aspect="video"
          options={ORIENTATION_CHOICES}
          value={orientation}
          onValueChange={(v) => setOrientation(v === "portrait" ? "portrait" : "landscape")}
        />
      </Question>

      <Question
        title="Format"
        hint="A movie is one continuous film. A series is split into episodes."
      >
        <SegmentedControl
          className="self-start"
          aria-label="Format"
          options={FORMATS.map((f) => ({ value: f.value, label: f.label }))}
          value={format}
          onValueChange={(v) => setFormat(v === "series" ? "series" : "movie")}
        />
      </Question>

      <Question
        title="Length"
        hint="The script is written to fit this length. One page of script runs about a minute."
      >
        <div className="flex flex-col gap-6">
          <DurationPicker
            label={isSeries ? "Total Duration" : "Duration"}
            value={total}
            onChange={setTotal}
            error={totalShown}
          />
          {isSeries ? (
            <DurationPicker
              label="Episode Duration"
              value={episode}
              onChange={setEpisode}
              error={episodeShown}
              hint={
                episodeShown ? undefined : (
                  <span aria-live="polite">
                    {episodes !== null
                      ? `That makes ${episodes} ${episodes === 1 ? "episode" : "episodes"}.`
                      : "The episode count appears once both durations are set."}
                  </span>
                )
              }
            />
          ) : null}
        </div>
      </Question>

      <div className="flex flex-col items-start gap-3">
        <Button type="submit" variant="prominent" size="large" loading={pending}>
          {first ? "Continue" : "Save Changes"}
        </Button>
        {serverError ? (
          <p role="alert" className="text-callout text-red">
            {serverError}
          </p>
        ) : null}
        {pastStyleStage ? (
          <Hint>Changing the style later may require the script to be revised.</Hint>
        ) : null}
      </div>

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
    </form>
  );
}
