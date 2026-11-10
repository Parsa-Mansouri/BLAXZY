"use client";

import { useRef, useState, type ReactNode } from "react";
import { Clapperboard, Film, Grid2x2, Palette, Plus, Trash2, Tv, Type } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  ChoiceCards,
  DatePicker,
  DurationInput,
  Field,
  GroupedList,
  GroupedListButton,
  GroupedListField,
  GroupedListRow,
  HelpTip,
  Hint,
  IconButton,
  Input,
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Popover,
  ProgressBar,
  SegmentedControl,
  Select,
  Sheet,
  SidebarBody,
  SidebarFooter,
  SidebarHeader,
  SidebarItem,
  SidebarSection,
  Skeleton,
  Spinner,
  SplitView,
  StageList,
  Textarea,
  Tip,
  TitleCard,
  Toolbar,
  Tooltip,
  formatDurationLong,
  useDismissed,
  useToast,
  type SelectOption,
  type StageListItem,
} from "@/ui";

const SECTIONS = [
  { id: "colour", label: "Colour", icon: <Palette /> },
  { id: "type", label: "Typography", icon: <Type /> },
  { id: "buttons", label: "Buttons", icon: <Grid2x2 /> },
  { id: "fields", label: "Text Fields", icon: <Grid2x2 /> },
  { id: "lists", label: "Grouped Lists", icon: <Grid2x2 /> },
  { id: "choices", label: "Choices", icon: <Grid2x2 /> },
  { id: "overlays", label: "Menus and Sheets", icon: <Grid2x2 /> },
  { id: "artwork", label: "Artwork", icon: <Film /> },
  { id: "status", label: "Status", icon: <Grid2x2 /> },
  { id: "help", label: "Help", icon: <Grid2x2 /> },
] as const;

const genres: SelectOption[] = [
  { value: "drama", label: "Drama", description: "Character-driven, grounded" },
  { value: "thriller", label: "Thriller", description: "Tension and reveals" },
  { value: "comedy", label: "Comedy" },
  { value: "doc", label: "Documentary", disabled: true },
];

const languages: SelectOption[] = [
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

const stages: StageListItem[] = [
  { id: "style", label: "Style", status: "done" },
  { id: "script", label: "Script", status: "current" },
  { id: "pre", label: "Pre-production", status: "locked", lockedHint: "Finish Script first" },
  { id: "prod", label: "Production", status: "locked", lockedHint: "Finish Pre-production first" },
];

const swatches: { name: string; className: string; note: string }[] = [
  { name: "ground", className: "bg-ground ring-1 ring-separator ring-inset", note: "#000000" },
  { name: "elevated", className: "bg-elevated", note: "#1C1C1E" },
  { name: "elevated-2", className: "bg-elevated-2", note: "#2C2C2E" },
  { name: "elevated-3", className: "bg-elevated-3", note: "#3A3A3C" },
  { name: "fill", className: "bg-fill", note: "120 120 128 / .36" },
  { name: "fill-3", className: "bg-fill-3", note: "120 120 128 / .24" },
  { name: "selection", className: "bg-selection", note: "white / .12" },
  { name: "accent", className: "bg-accent", note: "#FFFFFF" },
  { name: "red", className: "bg-red", note: "#FF453A" },
  { name: "green", className: "bg-green", note: "#30D158" },
  { name: "orange", className: "bg-orange", note: "#FF9F0A" },
  { name: "yellow", className: "bg-yellow", note: "#FFD60A" },
];

const textStyles = [
  { name: "Large Title", className: "text-large-title", sample: "Night Train to Isfahan" },
  { name: "Title 1", className: "text-title-1", sample: "Up Next" },
  { name: "Title 2", className: "text-title-2", sample: "Projects" },
  { name: "Title 3", className: "text-title-3", sample: "Rename Project" },
  { name: "Headline", className: "text-headline", sample: "Create a Project" },
  { name: "Body", className: "text-body", sample: "Write or upload the story, then refine it." },
  {
    name: "Reading",
    className: "text-reading",
    sample: "Multi-line reading text sits at 14 over 20 for comfortable paragraphs.",
  },
  {
    name: "Script",
    className: "text-script",
    sample: "INT. STATION PLATFORM - NIGHT. Rain on the glass roof.",
  },
  { name: "Callout", className: "text-callout", sample: "Use at least 10 characters." },
  { name: "Subheadline", className: "text-subheadline", sample: "Library" },
  { name: "Footnote", className: "text-footnote", sample: "Step 2 of 4" },
];

function Section({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="flex scroll-mt-16 flex-col gap-5 pt-10 hairline-t first:pt-2 first:shadow-none"
    >
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-title`} className="text-title-2">
          {title}
        </h2>
        {note ? <Hint>{note}</Hint> : null}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {label ? <span className="text-callout text-label-2">{label}</span> : null}
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

/** Outline of a frame at a given aspect ratio, for the orientation thumbnails. */
function FrameShape({ ratio }: { ratio: "landscape" | "portrait" }) {
  return (
    <span
      aria-hidden="true"
      className={
        ratio === "landscape"
          ? "aspect-video w-3/5 rounded-control ring-2 ring-current"
          : "aspect-[9/16] h-3/5 rounded-control ring-2 ring-current"
      }
    />
  );
}

function ToastDemo() {
  const toast = useToast();
  return (
    <Row>
      <Button onClick={() => toast.info("Saved to drafts", "Open it from Home at any time.")}>
        Info
      </Button>
      <Button onClick={() => toast.success("Script approved")}>Success</Button>
      <Button onClick={() => toast.warning("Scene 4 is long", "Consider splitting it in two.")}>
        Warning
      </Button>
      <Button
        variant="destructive"
        onClick={() => toast.danger("Render failed", "Stays until you dismiss it.")}
      >
        Danger
      </Button>
    </Row>
  );
}

function Content() {
  const [loading, setLoading] = useState(false);
  const [format, setFormat] = useState<string | null>("movie");
  const [orientation, setOrientation] = useState<string | null>("landscape");
  const [genre, setGenre] = useState<string | null>(null);
  const [language, setLanguage] = useState<string | null>("english");
  const [view, setView] = useState("grid");
  const [date, setDate] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(95);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [sheet, setSheet] = useState(false);
  const [alert, setAlert] = useState(false);
  const tipTarget = useRef<HTMLDivElement>(null);
  const tip = useDismissed("dev-ui-tip");

  function fakeLoad() {
    setLoading(true);
    window.setTimeout(() => setLoading(false), 1800);
  }

  return (
    <div className="flex flex-col gap-10 px-(--content-x) pt-2 pb-32">
      <Section
        id="colour"
        title="Colour"
        note="Apple's dark semantic values. White is the only accent; colour is for status."
      >
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(--spacing(36),1fr))] gap-4">
          {swatches.map((s) => (
            <li key={s.name} className="flex flex-col gap-1.5">
              <span className={`h-12 rounded-field ${s.className}`} />
              <span className="text-body">{s.name}</span>
              <span className="text-callout text-label-2">{s.note}</span>
            </li>
          ))}
        </ul>
        <Row label="Labels">
          <span className="text-body text-label">Primary</span>
          <span className="text-body text-label-2">Secondary</span>
          <span className="text-body text-label-3">Tertiary (decoration only)</span>
          <span className="text-body text-label-4">Quaternary (decoration only)</span>
        </Row>
      </Section>

      <Section
        id="type"
        title="Typography"
        note="macOS text styles. On touch screens and narrow windows the iOS scale takes over."
      >
        <ul className="flex flex-col">
          {textStyles.map((t) => (
            <li
              key={t.name}
              className="grid grid-cols-1 gap-1 py-3 hairline-b sm:grid-cols-[--spacing(32)_1fr] sm:items-baseline"
            >
              <span className="text-callout text-label-2">{t.name}</span>
              <span className={t.className}>{t.sample}</span>
            </li>
          ))}
        </ul>
        <p className="text-wordmark">BLAXZY</p>
      </Section>

      <Section
        id="buttons"
        title="Buttons"
        note="Prominent at most once per screen. Loading keeps the width."
      >
        <Row label="Styles">
          <Button variant="prominent">Continue</Button>
          <Button variant="standard">Save</Button>
          <Button variant="plain">Cancel</Button>
          <Button variant="destructive" leadingIcon={<Trash2 />}>
            Delete Scene
          </Button>
        </Row>
        <Row label="Large, icons">
          <Button variant="prominent" size="large" leadingIcon={<Plus />}>
            New Project
          </Button>
          <Button variant="standard" size="large">
            Show More
          </Button>
          <IconButton label="Add Scene" icon={<Plus />} variant="standard" />
          <IconButton label="Delete Scene" icon={<Trash2 />} />
        </Row>
        <Row label="States">
          <Button variant="prominent" loading={loading} onClick={fakeLoad}>
            {loading ? "Generating" : "Generate"}
          </Button>
          <Button variant="prominent" disabled>
            Disabled
          </Button>
          <Button variant="standard" disabled>
            Disabled
          </Button>
        </Row>
      </Section>

      <Section
        id="fields"
        title="Text Fields"
        note="Grey fill, no border at rest, persistent label, the fix stated in red."
      >
        <div className="grid max-w-3xl gap-6 sm:grid-cols-2">
          <Field
            label="Film Title"
            hint="You can change this later."
            labelAccessory={
              <HelpTip title="Film Title" example="Night Train to Isfahan">
                The name shown on Home and on every exported clip.
              </HelpTip>
            }
          >
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Email" error="Enter an email address such as name@example.com.">
            <Input defaultValue="director@" type="email" />
          </Field>
          <Field label="Producer" optional disabled>
            <Input disabled />
          </Field>
          <Field label="Search Scenes">
            <Input variant="toolbar" placeholder="Search" />
          </Field>
        </div>
        <Field
          label="Logline"
          optional
          hint="Grows as you type, up to 12 lines."
          className="max-w-3xl"
        >
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Field label="Script" optional className="max-w-3xl">
          <Textarea textStyle="script" defaultValue="INT. STATION PLATFORM - NIGHT" />
        </Field>
      </Section>

      <Section
        id="lists"
        title="Grouped Lists"
        note="The only container for settings and forms. Help goes in the footnote."
      >
        <div className="flex max-w-(--settings-w) flex-col gap-8">
          <GroupedList header="Profile" footer="Your email address is how you sign in.">
            <GroupedListField label="Name">
              <Input defaultValue="Leila Hatami" />
            </GroupedListField>
            <GroupedListRow label="Email">leila@example.com</GroupedListRow>
          </GroupedList>
          <GroupedList header="Project">
            <GroupedListRow label="Format">Movie</GroupedListRow>
            <GroupedListRow label="Status">
              <Badge tone="success" dot>
                Approved
              </Badge>
            </GroupedListRow>
            <GroupedListButton chevron>Export Settings</GroupedListButton>
          </GroupedList>
          <GroupedList>
            <GroupedListButton destructive>Sign Out</GroupedListButton>
          </GroupedList>
        </div>
      </Section>

      <Section
        id="choices"
        title="Choices"
        note="Pop-up button, segmented control and option thumbnails."
      >
        <Row label="Pop-up buttons">
          <Select
            options={genres}
            value={genre}
            onValueChange={setGenre}
            placeholder="Genre"
            aria-label="Genre"
          />
          <Select
            options={languages}
            value={language}
            onValueChange={setLanguage}
            aria-label="Language"
          />
        </Row>
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
        <Row label="What are you making?">
          <ChoiceCards
            aria-label="Format"
            value={format}
            onValueChange={setFormat}
            options={[
              { value: "movie", title: "Movie", description: "One story", icon: <Clapperboard /> },
              { value: "series", title: "Series", description: "Episodes", icon: <Tv /> },
            ]}
          />
        </Row>
        <Row label="Orientation">
          <ChoiceCards
            aria-label="Orientation"
            value={orientation}
            onValueChange={setOrientation}
            options={[
              {
                value: "landscape",
                title: "Landscape",
                thumbnail: <FrameShape ratio="landscape" />,
              },
              { value: "portrait", title: "Portrait", thumbnail: <FrameShape ratio="portrait" /> },
            ]}
          />
        </Row>
        <div className="grid max-w-3xl gap-6 sm:grid-cols-2">
          <Field label="Release Date">
            <DatePicker
              value={date}
              onValueChange={setDate}
              min="2025-01-01"
              max="2030-12-31"
              clearable
            />
          </Field>
          <Field
            label="Running Time"
            hint={duration === null ? "Minutes and seconds." : formatDurationLong(duration)}
          >
            <DurationInput value={duration} onValueChange={setDuration} max={3 * 3600} />
          </Field>
        </div>
      </Section>

      <Section
        id="overlays"
        title="Menus and Sheets"
        note="Menus for commands, sheets for a focused task, alerts only to confirm a destructive action."
      >
        <Row>
          <Menu trigger={<Button variant="standard">Menu</Button>}>
            <MenuLabel>leila@example.com</MenuLabel>
            <MenuItem shortcut="⌘R">Rename…</MenuItem>
            <MenuItem>Duplicate</MenuItem>
            <MenuSeparator />
            <MenuItem destructive>Delete…</MenuItem>
          </Menu>
          <Button variant="standard" onClick={() => setSheet(true)}>
            Sheet
          </Button>
          <Button variant="standard" onClick={() => setAlert(true)}>
            Alert
          </Button>
          <Popover trigger={<Button variant="standard">Popover</Button>} aria-label="Note">
            <p className="w-56 text-callout text-label-2">Small, optional content with an arrow.</p>
          </Popover>
          <Tooltip content="Hide Sidebar" shortcut="⌘\">
            <Button variant="plain">Tooltip</Button>
          </Tooltip>
        </Row>
        <Sheet
          open={sheet}
          onOpenChange={setSheet}
          title="Rename Project"
          footer={
            <>
              <Button variant="standard" onClick={() => setSheet(false)}>
                Cancel
              </Button>
              <Button variant="prominent" onClick={() => setSheet(false)}>
                Rename
              </Button>
            </>
          }
        >
          <GroupedList>
            <GroupedListField label="Title">
              <Input defaultValue="Night Train to Isfahan" />
            </GroupedListField>
          </GroupedList>
        </Sheet>
        <Alert
          open={alert}
          onOpenChange={setAlert}
          title="Delete Scene 4?"
          message="The scene and its clips are removed from this version."
          confirmLabel="Delete"
          onConfirm={() => setAlert(false)}
        />
        <ToastDemo />
      </Section>

      <Section
        id="artwork"
        title="Artwork"
        note="Title cards stand in for imagery until real stills exist. Never fake a generated frame."
      >
        <TitleCard
          size="hero"
          title="Night Train to Isfahan"
          line="Script · Step 2 of 4"
          action={
            <Button variant="standard" size="large">
              Continue
            </Button>
          }
        />
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,--spacing(70)),1fr))] gap-5">
          {[
            "The Salt Road",
            "Winter in Tabriz",
            "A Quiet Harbour Where the Ferries No Longer Stop",
          ].map((t) => (
            <li key={t}>
              <TitleCard title={t} />
            </li>
          ))}
        </ul>
      </Section>

      <Section id="status" title="Status">
        <Row label="Stage list">
          <div className="w-60 rounded-group bg-elevated p-2.5">
            <StageList stages={stages} />
          </div>
        </Row>
        <Row label="Tags">
          <Badge>Draft</Badge>
          <Badge tone="success" dot>
            Approved
          </Badge>
          <Badge tone="warning" dot>
            Needs Review
          </Badge>
          <Badge tone="danger" dot>
            Failed
          </Badge>
        </Row>
        <Row label="Activity">
          <Spinner size="sm" />
          <Spinner />
          <Spinner size="lg" />
        </Row>
        <div className="grid max-w-3xl gap-6 sm:grid-cols-2">
          <div className="flex flex-col gap-5">
            <ProgressBar value={42} label="Rendering scene 3 of 7" showValue />
            <ProgressBar value={100} tone="success" aria-label="Done" />
            <ProgressBar value={null} label="Waiting in queue" />
          </div>
          <div className="flex flex-col gap-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="aspect-video w-full rounded-artwork" />
          </div>
        </div>
      </Section>

      <Section
        id="help"
        title="Help"
        note="Three levels: a footnote, the round help button, and one first-run tip at a time."
      >
        <Hint>Footnote text: start simple. One sentence about the idea is enough.</Hint>
        <Hint tone="warning">Changing the style later regenerates the storyboard.</Hint>
        <Row>
          <span className="flex items-center gap-1.5 text-body">
            Aspect Ratio
            <HelpTip title="Aspect Ratio" example="16:9 fills a TV, 9:16 fills a phone.">
              The shape of the picture. Choose the screen the film is for.
            </HelpTip>
          </span>
        </Row>
        <div className="flex flex-col items-start gap-3">
          <div ref={tipTarget}>
            <Button variant="standard" onClick={tip.reset}>
              Show Tip Again
            </Button>
          </div>
          <Tip
            open={!tip.dismissed}
            anchor={tipTarget}
            title="Pick a Look First"
            onDismiss={tip.dismiss}
            action={{ label: "Choose Style", onClick: tip.dismiss }}
            align="start"
          >
            Everything else in the film follows the style chosen here.
          </Tip>
        </div>
      </Section>
    </div>
  );
}

export function Showcase() {
  return (
    <SplitView
      cookieName="blaxzy_dev_sidebar"
      sidebar={
        <>
          <SidebarHeader>
            <span className="text-wordmark">BLAXZY</span>
          </SidebarHeader>
          <SidebarBody aria-label="Kit sections">
            <SidebarSection title="UI Kit">
              {SECTIONS.map((s) => (
                <SidebarItem key={s.id} href={`#${s.id}`} icon={s.icon}>
                  {s.label}
                </SidebarItem>
              ))}
            </SidebarSection>
          </SidebarBody>
          <SidebarFooter>
            <p className="px-2 text-callout text-label-2">Development only</p>
          </SidebarFooter>
        </>
      }
    >
      <Toolbar title="UI Kit" trailing={<Button variant="prominent">Prominent Action</Button>} />
      <Content />
    </SplitView>
  );
}
