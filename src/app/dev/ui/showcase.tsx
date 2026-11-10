"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Clapperboard,
  Film,
  Monitor,
  Moon,
  Plus,
  Smartphone,
  Sun,
  Trash2,
  Tv,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ChoiceCards,
  CoachMark,
  DatePicker,
  Dialog,
  DurationInput,
  EmptyState,
  Field,
  HelpTip,
  Hint,
  IconButton,
  Input,
  Popover,
  ProgressBar,
  SegmentedControl,
  Select,
  Skeleton,
  Spinner,
  Stepper,
  Textarea,
  ToastProvider,
  Tooltip,
  TooltipProvider,
  formatDurationLong,
  useDismissed,
  useToast,
  type SelectOption,
  type StepperStep,
} from "@/ui";

const genres: SelectOption[] = [
  { value: "drama", label: "Drama", description: "Character-driven, grounded", icon: <Film /> },
  {
    value: "thriller",
    label: "Thriller",
    description: "Tension and reveals",
    icon: <Clapperboard />,
  },
  { value: "comedy", label: "Comedy", description: "Light and quick" },
  { value: "doc", label: "Documentary", description: "Real-world stories", disabled: true },
];

const manyOptions: SelectOption[] = [
  "Arabic",
  "Dutch",
  "English",
  "French",
  "German",
  "Hindi",
  "Italian",
  "Japanese",
  "Korean",
  "Mandarin",
  "Persian",
  "Portuguese",
  "Spanish",
  "Turkish",
].map((label) => ({ value: label.toLowerCase(), label }));

const stages: StepperStep[] = [
  { id: "style", label: "Style", status: "done" },
  { id: "script", label: "Script", status: "current" },
  { id: "pre", label: "Pre-production", status: "upcoming" },
  {
    id: "prod",
    label: "Production",
    status: "locked",
    lockedHint: "Finish pre-production to unlock.",
  },
];

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5 border-t border-line pt-10">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        {note ? <p className="max-w-(--measure) text-sm text-fg-muted">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {label ? <span className="text-xs text-fg-subtle">{label}</span> : null}
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

function ToastDemo() {
  const toast = useToast();
  return (
    <Row>
      <Button onClick={() => toast.info("Saved to drafts", "You can pick this up later.")}>
        Info
      </Button>
      <Button onClick={() => toast.success("Script approved")}>Success</Button>
      <Button onClick={() => toast.warning("Scene 4 is long", "Consider splitting it.")}>
        Warning
      </Button>
      <Button
        variant="danger"
        onClick={() => toast.danger("Render failed", "Stays until you dismiss it.")}
      >
        Danger
      </Button>
    </Row>
  );
}

function Content() {
  const [theme, setTheme] = useState("dark");
  const [loading, setLoading] = useState(false);
  const [format, setFormat] = useState<string | null>("movie");
  const [orientation, setOrientation] = useState<string | null>(null);
  const [genre, setGenre] = useState<string | null>(null);
  const [language, setLanguage] = useState<string | null>("english");
  const [view, setView] = useState("grid");
  const [date, setDate] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(95);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dialog, setDialog] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const tourTarget = useRef<HTMLDivElement>(null);
  const intro = useDismissed("dev-ui-tour");

  function changeTheme(next: string) {
    setTheme(next);
    document.documentElement.dataset.theme = next;
  }

  function fakeLoad() {
    setLoading(true);
    window.setTimeout(() => setLoading(false), 1800);
  }

  const tour = [
    {
      title: "Pick a look first",
      body: "Everything else in the film follows the style you choose here.",
    },
    {
      title: "Then write the script",
      body: "Describe the idea in your own words. We shape it into scenes.",
    },
  ];
  const showTour = !intro.dismissed && tourStep < tour.length;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-12 px-(--gutter) pt-8 pb-32">
      <header className="sticky top-0 z-(--z-sticky) -mx-(--gutter) flex items-center justify-between gap-4 border-b border-line bg-bg/85 px-(--gutter) py-3 backdrop-blur">
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate text-lg font-semibold tracking-tight">BLAXZY UI kit</h1>
          <p className="truncate text-xs text-fg-subtle">Development only</p>
        </div>
        <SegmentedControl
          aria-label="Theme"
          size="sm"
          value={theme}
          onValueChange={changeTheme}
          options={[
            { value: "dark", label: "Dark", icon: <Moon /> },
            { value: "light", label: "Light", icon: <Sun /> },
          ]}
        />
      </header>

      <Section
        title="Buttons"
        note="Four variants, three sizes. Loading keeps the width so nothing jumps."
      >
        <Row label="Variants">
          <Button variant="primary">Continue</Button>
          <Button variant="secondary">Save draft</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger" leadingIcon={<Trash2 />}>
            Delete
          </Button>
        </Row>
        <Row label="Sizes, icons, link">
          <Button size="sm" variant="primary">
            Small
          </Button>
          <Button size="md" variant="primary" trailingIcon={<ArrowRight />}>
            Medium
          </Button>
          <Button size="lg" variant="primary" leadingIcon={<Plus />}>
            New film
          </Button>
          <Button href="#buttons" variant="secondary">
            Rendered as a link
          </Button>
        </Row>
        <Row label="States">
          <Button variant="primary" loading={loading} onClick={fakeLoad}>
            {loading ? "Generating" : "Click to load"}
          </Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
          <IconButton label="Add scene" icon={<Plus />} variant="secondary" />
          <IconButton label="Delete scene" icon={<Trash2 />} />
        </Row>
      </Section>

      <Section
        title="Text fields"
        note="Label, an always-visible hint, and an error that says how to fix it."
      >
        <div className="grid gap-6 sm:grid-cols-2">
          <Field
            label="Film title"
            required
            hint="You can change this any time."
            labelAccessory={
              <HelpTip title="Film title" example="Midnight in Tabriz">
                The name shown on your dashboard and on the exported film.
              </HelpTip>
            }
          >
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Untitled film"
            />
          </Field>
          <Field
            label="Email"
            error="That doesn't look like an email address. Check for a missing @."
          >
            <Input defaultValue="director@" type="email" />
          </Field>
          <Field label="Producer" optional disabled>
            <Input placeholder="Disabled" disabled />
          </Field>
          <Field label="Search" hint="With a leading icon and large size.">
            <Input size="lg" placeholder="Find a scene" leading={<Film />} />
          </Field>
        </div>
        <Field label="Logline" hint="Grows as you type, up to 12 lines." optional>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="A retired cinematographer returns to the town where she shot her only film."
          />
        </Field>
      </Section>

      <Section
        title="Choices"
        note="Select, segmented control and the large cards the Wizard uses."
      >
        <div className="grid gap-6 sm:grid-cols-2">
          <Field label="Genre" hint="Short list: a plain dropdown.">
            <Select
              options={genres}
              value={genre}
              onValueChange={setGenre}
              placeholder="Choose a genre"
            />
          </Field>
          <Field label="Language" hint="Long list: search appears by itself.">
            <Select options={manyOptions} value={language} onValueChange={setLanguage} />
          </Field>
        </div>
        <Row label="Segmented control">
          <SegmentedControl
            aria-label="View"
            value={view}
            onValueChange={setView}
            options={[
              { value: "grid", label: "Grid" },
              { value: "list", label: "List" },
              { value: "board", label: "Board" },
            ]}
          />
        </Row>
        <div className="flex flex-col gap-3">
          <h3 className="text-base font-medium">What are you making?</h3>
          <ChoiceCards
            aria-label="Format"
            value={format}
            onValueChange={setFormat}
            options={[
              {
                value: "movie",
                title: "A movie",
                description: "One story, start to finish.",
                icon: <Film />,
              },
              {
                value: "series",
                title: "A series",
                description: "Episodes that share a world.",
                icon: <Tv />,
              },
            ]}
          />
          <ChoiceCards
            aria-label="Orientation"
            columns={3}
            value={orientation}
            onValueChange={setOrientation}
            options={[
              {
                value: "landscape",
                title: "Landscape",
                description: "Cinema and TV",
                icon: <Monitor />,
              },
              {
                value: "portrait",
                title: "Portrait",
                description: "Phones and social",
                icon: <Smartphone />,
              },
              {
                value: "square",
                title: "Square",
                description: "Coming soon",
                icon: <Clapperboard />,
                disabled: true,
              },
            ]}
          />
        </div>
      </Section>

      <Section title="Date and duration">
        <div className="grid gap-6 sm:grid-cols-2">
          <Field label="Release date" hint="Arrow keys move, PageUp and PageDown change month.">
            <DatePicker
              value={date}
              onValueChange={setDate}
              min="2025-01-01"
              max="2030-12-31"
              clearable
            />
          </Field>
          <Field
            label="Running time"
            hint={duration === null ? "Minutes and seconds." : formatDurationLong(duration)}
          >
            <DurationInput value={duration} onValueChange={setDuration} max={3 * 3600} />
          </Field>
        </div>
      </Section>

      <Section
        title="Overlays"
        note="Dialog traps focus. Popover and tooltip are portalled, so nothing is clipped."
      >
        <Row>
          <Button variant="secondary" onClick={() => setDialog(true)}>
            Open dialog
          </Button>
          <Popover
            trigger={<Button variant="secondary">Open popover</Button>}
            aria-label="Quick note"
          >
            <div className="flex w-64 flex-col gap-2 text-sm">
              <p className="font-medium">Quick note</p>
              <p className="text-fg-muted">Any small, optional content lives here.</p>
            </div>
          </Popover>
          <Tooltip content="Short, plain-language label">
            <Button variant="ghost">Hover or focus me</Button>
          </Tooltip>
        </Row>
        <Dialog
          open={dialog}
          onOpenChange={setDialog}
          title="Delete this scene?"
          description="You can bring it back from history for 30 days."
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialog(false)}>
                Keep it
              </Button>
              <Button variant="danger" onClick={() => setDialog(false)}>
                Delete scene
              </Button>
            </>
          }
        >
          <Field label="Why? (helps us improve)" optional>
            <Input placeholder="Too slow, wrong tone..." />
          </Field>
        </Dialog>
      </Section>

      <Section title="Toasts" note="Danger toasts stay until dismissed.">
        <ToastDemo />
      </Section>

      <Section title="Surfaces and status">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader
              title="Midnight in Tabriz"
              description="Movie, landscape, 12 min"
              action={
                <Badge tone="accent" dot>
                  Script
                </Badge>
              }
            />
          </Card>
          <Card variant="raised" interactive>
            <CardHeader title="Raised and interactive" description="Hover me." />
          </Card>
        </div>
        <Row label="Badges">
          <Badge>Neutral</Badge>
          <Badge tone="accent">Accent</Badge>
          <Badge tone="success" dot>
            Approved
          </Badge>
          <Badge tone="warning" dot>
            Needs review
          </Badge>
          <Badge tone="danger" dot>
            Failed
          </Badge>
        </Row>
        <Row label="Spinners">
          <Spinner size="sm" />
          <Spinner />
          <Spinner size="lg" />
        </Row>
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="flex flex-col gap-5">
            <ProgressBar value={42} label="Rendering scene 3 of 7" showValue />
            <ProgressBar value={100} tone="success" size="sm" aria-label="Done" />
            <ProgressBar value={null} label="Waiting in queue" />
          </div>
          <div className="flex flex-col gap-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
        <EmptyState
          icon={<Clapperboard />}
          title="No films yet"
          description="Start with an idea. We guide you through style, script and production, one step at a time."
          action={
            <Button variant="primary" leadingIcon={<Plus />}>
              Start a film
            </Button>
          }
        />
      </Section>

      <Section
        title="Progress and hints"
        note="The Wizard's four stages, plus the three layers of help."
      >
        <Stepper aria-label="Film progress" steps={stages} onStepClick={() => undefined} />
        <div className="flex flex-col gap-3">
          <Hint>Start simple. One sentence about your idea is enough.</Hint>
          <Hint tone="info">Everything you write here is saved automatically.</Hint>
          <Hint tone="warning">Changing the style later regenerates your storyboard.</Hint>
        </div>
        <Row label="HelpTip (hover, focus, or tap the ?)">
          <span className="flex items-center gap-1 text-sm">
            Aspect ratio
            <HelpTip title="Aspect ratio" example="16:9 fills a TV, 9:16 fills a phone.">
              The shape of the picture. Pick the screen your film is for.
            </HelpTip>
          </span>
        </Row>
        <div className="flex flex-col items-start gap-3">
          <div
            ref={tourTarget}
            className="rounded-md border border-line-strong bg-surface px-4 py-3 text-sm"
          >
            The coach mark points at this box
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setTourStep(0);
              intro.reset();
            }}
          >
            Replay tour
          </Button>
          <CoachMark
            open={showTour}
            anchor={tourTarget}
            title={tour[Math.min(tourStep, tour.length - 1)]!.title}
            step={tourStep + 1}
            total={tour.length}
            onNext={() => setTourStep((s) => s + 1)}
            onDismiss={intro.dismiss}
          >
            {tour[Math.min(tourStep, tour.length - 1)]!.body}
          </CoachMark>
        </div>
      </Section>
    </div>
  );
}

export function Showcase() {
  return (
    <TooltipProvider>
      <ToastProvider>
        <Content />
      </ToastProvider>
    </TooltipProvider>
  );
}
