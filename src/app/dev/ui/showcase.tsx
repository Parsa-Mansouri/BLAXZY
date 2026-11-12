"use client";

import { useRef, useState, type ReactNode } from "react";
import { Clapperboard, House, LayoutGrid, Play, Plus, Trash2, Tv, Upload } from "lucide-react";
import {
  Alert,
  AnimatedPlaceholder,
  BackControl,
  Badge,
  Button,
  ChoiceCards,
  Confirmation,
  Kbd,
  Mono,
  SkeletonButton,
  SkeletonHeader,
  SkeletonRegion,
  SkeletonRows,
  SkeletonText,
  SkeletonTile,
  SubmitButton,
  TextLink,
  Tick,
  useFlash,
  DatePicker,
  DemoHint,
  SilhouetteScene,
  WaveformScene,
  DropScene,
  DurationInput,
  FeatureBlock,
  Field,
  FocusLayout,
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
  OptionRow,
  OptionTile,
  PageHeader,
  PaperSheet,
  PicturePlaceholder,
  PictureTile,
  Popover,
  ProgressBar,
  QuietTile,
  ScreenplayAction,
  ScreenplayDialogue,
  SegmentedControl,
  Select,
  SelectRow,
  Sheet,
  SidebarAction,
  SidebarBody,
  SidebarHeader,
  SidebarItem,
  SidebarSection,
  Skeleton,
  Spinner,
  SplitView,
  StageStrip,
  StatusLine,
  SwapFade,
  Tabs,
  Textarea,
  Tip,
  TitleCard,
  Toolbar,
  Tooltip,
  TypingScene,
  formatDurationLong,
  samplePrompt,
  stagger,
  useDismissed,
  useToast,
  type SelectOption,
  type StageStripItem,
} from "@/ui";
import { IssueScenesDemo } from "./issue-scenes-demo";

const SECTIONS = [
  { id: "colour", label: "Colour" },
  { id: "type", label: "Typography" },
  { id: "header", label: "Page Header" },
  { id: "buttons", label: "Buttons" },
  { id: "fields", label: "Text Fields" },
  { id: "focus", label: "Tabs and Focus" },
  { id: "pictures", label: "Pictures" },
  { id: "options", label: "Options" },
  { id: "blocks", label: "Leading Option" },
  { id: "demo", label: "Demo Hints" },
  { id: "paper", label: "Paper" },
  { id: "status", label: "Status" },
  { id: "feedback", label: "Feedback" },
  { id: "loading", label: "Loading" },
  { id: "icons", label: "Icons" },
  { id: "lists", label: "Grouped Lists" },
  { id: "choices", label: "Choices" },
  { id: "overlays", label: "Menus and Sheets" },
  { id: "help", label: "Help" },
] as const;

/** What the "Write a Prompt" card types: the asset's own sample prompt, then a second idea. */
const DEMO_PROMPT_LINES = [
  samplePrompt(
    "character",
    "Ines",
    "The keeper's daughter, thirty, wind-burnt, in a patched oilskin coat",
  ),
  "Ines at the lamp room window, grey morning light, hair tied back.",
];

const genres: SelectOption[] = [
  { value: "drama", label: "Drama", description: "Character-driven, grounded" },
  { value: "thriller", label: "Thriller", description: "Tension and reveals" },
  { value: "comedy", label: "Comedy" },
  { value: "doc", label: "Documentary", disabled: true },
];

const stages: StageStripItem[] = [
  { id: "style", label: "Style", status: "done", href: "#status" },
  { id: "script", label: "Script", status: "current", href: "#status", active: true },
  {
    id: "pre",
    label: "Pre-production",
    status: "locked",
    lockedHint: "Finish Script first",
    grow: 1.5,
  },
  { id: "prod", label: "Production", status: "locked", lockedHint: "Finish Pre-production first" },
];

const swatches: { name: string; className: string; note: string }[] = [
  { name: "ground", className: "bg-ground ring-1 ring-separator ring-inset", note: "#000000" },
  { name: "sidebar", className: "bg-sidebar", note: "#0F0F11" },
  { name: "elevated", className: "bg-elevated", note: "#141416 tiles" },
  { name: "elevated-2", className: "bg-elevated-2", note: "#1C1C1E raised" },
  { name: "selected", className: "bg-selected", note: "#1F1F22" },
  { name: "fill", className: "bg-fill", note: "#343437 dark button" },
  { name: "outline", className: "bg-outline", note: "#48484A" },
  { name: "accent", className: "bg-accent", note: "#FFFFFF primary button" },
  { name: "brand", className: "bg-brand", note: "#5B84FF small marks only" },
  { name: "paper", className: "bg-paper", note: "#EFE7D3" },
  { name: "done", className: "bg-done", note: "#30D158" },
  { name: "waiting", className: "bg-waiting", note: "#FF9F0A" },
  { name: "working", className: "bg-working", note: "#8E8E93" },
  { name: "failed", className: "bg-failed", note: "#FF453A" },
];

const textStyles = [
  { name: "display 48", className: "text-display uppercase", sample: "Script" },
  { name: "heading 34", className: "text-heading", sample: "What should it look like?" },
  { name: "heading-sm 28", className: "text-heading-sm", sample: "The Lighthouse Keeper" },
  { name: "section 18", className: "text-section", sample: "Your Films" },
  { name: "row 17", className: "text-row", sample: "Mara" },
  { name: "body 15", className: "text-body", sample: "Comment on any line, then accept it." },
  { name: "secondary 14", className: "text-secondary", sample: "You choose the style next." },
  { name: "meta 13", className: "text-meta", sample: "Earlier version, read only" },
  { name: "caps-label", className: "caps-label", sample: "Pre-production" },
  { name: "block-title 32", className: "text-block-title", sample: "Answer a Few Questions" },
  { name: "cover-title 22", className: "text-cover-title", sample: "Ines" },
  { name: "mono-value 13", className: "mono-value text-meta", sample: "00:01:35 · 120 credits" },
];

const scenes = [
  {
    slug: "INT. LIGHTHOUSE - NIGHT",
    action: "Rain against the glass. MARA, sixty, climbs the last turn of the stair.",
    who: "MARA",
    line: "Forty years and the light has never gone out on my watch.",
  },
  {
    slug: "EXT. HARBOUR - DAWN",
    action: "A rowing boat drifts in with no one at the oars. JONAS watches from the quay.",
    who: "JONAS",
    line: "Whose boat is that?",
  },
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
      className="flex scroll-mt-20 flex-col gap-6 pt-8 first:pt-0"
    >
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-title`} className="text-section">
          {title}
        </h2>
        {note ? <p className="text-secondary text-label-2">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      {label ? <span className="text-secondary text-label-2">{label}</span> : null}
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

/** Animated placeholders: a line title field and a form field, each with its own value. */
function AnimatedPlaceholderDemo() {
  const [title, setTitle] = useState("");
  const [film, setFilm] = useState("");
  const titles = ["Give it a working title", "The Lighthouse Keeper", "Night Ferry", "Salt"];
  const films = ["Blade Runner 2049", "In the Mood for Love", "Chernobyl"];
  return (
    <div className="flex w-full max-w-170 flex-col gap-6">
      <AnimatedPlaceholder lines={titles} empty={!title} variant="line">
        <Input
          variant="line"
          aria-label="Working title"
          placeholder={titles[0]}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </AnimatedPlaceholder>
      <AnimatedPlaceholder lines={films} empty={!film} delay={600} className="w-80">
        <Input
          aria-label="A film like it"
          placeholder={films[0]}
          value={film}
          onChange={(e) => setFilm(e.target.value)}
        />
      </AnimatedPlaceholder>
    </div>
  );
}

/** A stand-in picture of the given size for the media toasts. */
function demoPicture(width: number, height: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#3a3a3c"/><circle cx="${width / 2}" cy="${height * 0.4}" r="${Math.min(width, height) * 0.18}" fill="#8e8e93"/><rect x="${width * 0.25}" y="${height * 0.66}" width="${width * 0.5}" height="${height * 0.34}" rx="${width * 0.06}" fill="#8e8e93"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function ToastDemo() {
  const toast = useToast();
  return (
    <Row>
      <Button
        onClick={() =>
          toast.show({
            kind: "success",
            title: "Ines's image is ready",
            description: "In The Long Tide",
            media: { src: demoPicture(540, 960), alt: "Ines", aspect: "portrait" },
            href: "#toast-demo",
            persistent: true,
          })
        }
      >
        Image Ready
      </Button>
      <Button
        onClick={() =>
          toast.show({
            kind: "success",
            title: "Harbour Pier's sheet is ready",
            media: { src: demoPicture(1600, 900), alt: "Harbour Pier" },
            href: "#toast-demo",
            persistent: true,
          })
        }
      >
        Sheet Ready
      </Button>
      <Button
        onClick={() =>
          toast.show({
            kind: "danger",
            title: "Couldn't make Ines's image",
            description: "Open it to try again.",
            href: "#toast-demo",
          })
        }
      >
        Linked Failure
      </Button>
      <Button onClick={() => toast.info("Saved to drafts", "Open it from Home at any time.")}>
        Info
      </Button>
      <Button onClick={() => toast.success("Script accepted")}>Success</Button>
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

function FeedbackDemo() {
  const [saved, flashSaved] = useFlash();
  const [tickKey, setTickKey] = useState(0);
  const [settleKey, setSettleKey] = useState(0);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  return (
    <div className="flex flex-col gap-8">
      <Row label="Tick: draws in when it mounts (250ms)">
        <span key={tickKey} className="inline-flex items-center gap-2 text-body">
          <Tick className="size-(--icon-lg)" />
          Answer saved
        </span>
        <Button size="small" onClick={() => setTickKey((n) => n + 1)}>
          Replay
        </Button>
      </Row>
      <Row label="Confirmation with useFlash(): shows for two seconds">
        <Button onClick={flashSaved}>Save Notes</Button>
        <Confirmation show={saved}>Saved</Confirmation>
      </Row>
      <Row label="Settle: a row that just changed state (replay by changing its key)">
        <div className="flex w-full max-w-140 flex-col gap-2">
          <OptionRow
            key={settleKey}
            className={settleKey > 0 ? "settle" : undefined}
            selected={accepted}
            onSelect={() => {
              setAccepted((a) => !a);
              setSettleKey((n) => n + 1);
            }}
          >
            {accepted ? "Accepted" : "Accept this sheet"}
          </OptionRow>
        </div>
      </Row>
      <div className="max-w-100">
        <Field label="Character name" error={error}>
          <Input placeholder="Mara" />
        </Field>
        <div className="mt-3">
          <Button
            size="small"
            onClick={() => setError((e) => (e ? undefined : "Give the character a name."))}
          >
            {error ? "Clear Error" : "Mark Wrong (Shake)"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SubmitDemo() {
  return (
    <form
      action={async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
      }}
    >
      <SubmitButton pendingLabel="Saving">Save Style</SubmitButton>
    </form>
  );
}

function FocusDemo() {
  const [scene, setScene] = useState(0);
  const [version, setVersion] = useState("v2");
  const current = scenes[scene] ?? scenes[0];
  return (
    <Tabs
      aria-label="Script versions"
      value={version}
      onValueChange={setVersion}
      tabs={[
        { value: "v2", label: "Version 2" },
        { value: "v1", label: "Version 1" },
      ]}
      trailing={version === "v1" ? "Earlier version, read only" : undefined}
    >
      <FocusLayout
        listLabel="Scenes"
        listWidth="narrow"
        list={scenes.map((s, i) => (
          <SelectRow
            key={s.slug}
            size="regular"
            label={s.slug}
            active={i === scene}
            trailing={i === 1 ? "1" : undefined}
            onClick={() => setScene(i)}
            className="enter"
            style={stagger(i)}
          />
        ))}
      >
        <SwapFade swapKey={scene}>
          <PaperSheet heading={current.slug}>
            <ScreenplayAction>{current.action}</ScreenplayAction>
            <ScreenplayDialogue who={current.who}>{current.line}</ScreenplayDialogue>
          </PaperSheet>
        </SwapFade>
      </FocusLayout>
    </Tabs>
  );
}

function QuestionsDemo() {
  const [step, setStep] = useState(1);
  const [look, setLook] = useState<string | null>("Cinematic");
  const [length, setLength] = useState<string | null>(null);
  const rows = [
    { label: "Look", value: look },
    { label: "Length", value: length },
    { label: "Frame", value: null },
  ];
  return (
    <FocusLayout
      listLabel="Your style choices"
      list={rows.map((r, i) => (
        <SelectRow
          key={r.label}
          label={r.label}
          value={r.value ?? undefined}
          done={Boolean(r.value)}
          active={i === step}
          onClick={() => setStep(i)}
          className="enter"
          style={stagger(i)}
        />
      ))}
    >
      <SwapFade swapKey={step} className="flex flex-col gap-6">
        {step === 0 ? (
          <>
            <h3 className="text-heading">What should it look like?</h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
              {["Cinematic", "Animation", "Documentary"].map((o, i) => (
                <OptionTile
                  key={o}
                  label={o}
                  selected={look === o}
                  onSelect={() => setLook(o)}
                  className="enter"
                  style={stagger(i, 40)}
                />
              ))}
              <OptionTile
                kind="other"
                label="Not what you have in mind?"
                selected={look === "Other"}
                onSelect={() => setLook("Other")}
                className="enter"
                style={stagger(3, 40)}
              />
            </div>
          </>
        ) : step === 1 ? (
          <>
            <h3 className="text-heading">How long should it be?</h3>
            <div className="flex max-w-140 flex-col gap-2">
              {["1 minute", "3 minutes", "5 minutes"].map((o, i) => (
                <OptionRow
                  key={o}
                  selected={length === o}
                  onSelect={() => setLength(o)}
                  className="enter"
                  style={stagger(i, 40)}
                >
                  {o}
                </OptionRow>
              ))}
            </div>
          </>
        ) : (
          <>
            <h3 className="text-heading">Which way is it framed?</h3>
            <div className="flex flex-wrap items-end gap-4">
              <OptionTile label="Landscape" width="288px" aspectRatio="16 / 9" />
              <OptionTile label="Portrait" width="162px" aspectRatio="9 / 16" />
            </div>
          </>
        )}
        <div>
          <Button variant="primary" size="large" onClick={() => setStep((s) => (s + 1) % 3)}>
            Next
          </Button>
        </div>
      </SwapFade>
    </FocusLayout>
  );
}

function Content() {
  const [loading, setLoading] = useState(false);
  const [format, setFormat] = useState<string | null>("movie");
  const [genre, setGenre] = useState<string | null>(null);
  const [view, setView] = useState("grid");
  const [date, setDate] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(95);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [sheet, setSheet] = useState(false);
  const [alert, setAlert] = useState(false);
  const [replay, setReplay] = useState(0);
  const tipTarget = useRef<HTMLDivElement>(null);
  const tip = useDismissed("dev-ui-tip");

  function fakeLoad() {
    setLoading(true);
    window.setTimeout(() => setLoading(false), 1800);
  }

  return (
    <div className="flex flex-col gap-12 px-(--content-x) pt-8 pb-32">
      <PageHeader
        title="UI Kit"
        description="Every primitive in the pinned language. Development only."
        actions={
          <>
            <Button variant="outlined" onClick={() => setReplay((n) => n + 1)}>
              Replay Header
            </Button>
            <Button variant="primary">Primary Action</Button>
          </>
        }
      />

      <Section
        id="colour"
        title="Colour"
        note="Black ground, white for the one primary button, one brand colour for small marks (title rule, selected ring and tick, active stage, tab underline, links, selection, progress). Other colour is status only."
      >
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-4">
          {swatches.map((s, i) => (
            <li key={s.name} className="flex enter flex-col gap-1.5" style={stagger(i, 0, 20)}>
              <span className={`h-12 rounded-tile ${s.className}`} />
              <span className="text-body">{s.name}</span>
              <span className="text-meta text-label-2">{s.note}</span>
            </li>
          ))}
        </ul>
        <Row label="Labels">
          <span className="text-body text-label">Primary #F2F2F3</span>
          <span className="text-body text-label-2">Secondary #C9C9CE</span>
          <span className="text-body text-label-3">Placeholder and disabled #A1A1A6</span>
        </Row>
        <Row label="Text link">
          <p className="text-body text-label-2">
            Read the <TextLink href="#paper">screenplay rules</TextLink> before you write.
          </p>
        </Row>
      </Section>

      <Section
        id="type"
        title="Typography"
        note="Geist everywhere, status lines included. Geist Mono only for technical values."
      >
        <ul className="flex flex-col">
          {textStyles.map((t) => (
            <li
              key={t.name}
              className="grid grid-cols-1 gap-1 border-b border-separator py-3 sm:grid-cols-[160px_1fr] sm:items-baseline"
            >
              <span className="text-meta text-label-2">{t.name}</span>
              <span className={t.className}>{t.sample}</span>
            </li>
          ))}
        </ul>
        <p className="text-wordmark">BLAXZY</p>
      </Section>

      <Section
        id="header"
        title="Page Header"
        note="Title rises (650ms), the rule wipes in (500ms, 180ms delay), then the description."
      >
        <div key={replay} className="flex flex-col gap-10">
          <PageHeader
            as="h2"
            title="Script"
            description="Comment on any line, then accept it or ask for changes."
            actions={
              <>
                <Button variant="outlined">Request Changes</Button>
                <Button variant="primary">Accept Script</Button>
              </>
            }
          />
          <PageHeader
            as="h2"
            keepCase
            title="Ines"
            description={<StatusLine tone="waiting">1 to review · 2 need an image</StatusLine>}
          />
          <PageHeader
            as="h2"
            keepCase
            title="The Unusually Long and Winding Title of a Film Somebody Typed Without Stopping"
            description="Long user-written titles wrap in balanced lines and never overflow."
          />
        </div>
      </Section>

      <Section
        id="buttons"
        title="Buttons"
        note="Capsules that press to 98%. One white button per screen."
      >
        <Row label="Variants">
          <Button variant="primary">Accept Script</Button>
          <Button variant="outlined">Request Changes</Button>
          <Button variant="dark">Rename</Button>
          <Button variant="plain">Back</Button>
          <Button variant="destructive" leadingIcon={<Trash2 />}>
            Delete Scene
          </Button>
        </Row>
        <Row label="Sizes: small 36, regular 40, large 48">
          <Button size="small">Comment</Button>
          <Button>Change Password</Button>
          <Button variant="primary" size="large" leadingIcon={<Plus />}>
            Continue to Script
          </Button>
          <IconButton label="Add Scene" icon={<Plus />} variant="dark" />
          <IconButton label="Delete Scene" icon={<Trash2 />} />
        </Row>
        <Row label="States: pending keeps its width and blocks a second press; disabled stays readable">
          <Button variant="primary" loading={loading} pendingLabel="Generating" onClick={fakeLoad}>
            Generate
          </Button>
          <SubmitDemo />
          <Button variant="primary" disabled>
            Disabled
          </Button>
          <Button variant="outlined" disabled>
            Disabled
          </Button>
        </Row>
      </Section>

      <Section id="fields" title="Text Fields" note="Dark tile, grey outline, label above.">
        <div className="max-w-190">
          <Input
            variant="line"
            aria-label="Name of the new film"
            placeholder="Give it a working title"
            trailing={<IconButton label="Create the Project" icon={<Plus />} variant="dark" />}
          />
        </div>
        <div className="grid max-w-3xl gap-6 sm:grid-cols-2">
          <Field
            label="Film Title"
            hint="You can change this later."
            labelAccessory={
              <HelpTip title="Film Title" example="The Lighthouse Keeper">
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
        <Field label="Describe it in your own words" optional className="max-w-3xl">
          <Textarea textStyle="script" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </Section>

      <Section
        id="focus"
        title="Tabs and Focus"
        note="One sliding underline. The list on the left chooses what the focus area shows."
      >
        <FocusDemo />
        <QuestionsDemo />
      </Section>

      <Section
        id="pictures"
        title="Pictures"
        note="Hover or focus a tile: the action panel slides up over the whole picture."
      >
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-6 gap-y-9">
          {[
            { title: "The Lighthouse Keeper", line: "1 sheet waiting for you", tone: "waiting" },
            { title: "Night Ferry", line: "Script ready to review", tone: "waiting" },
            { title: "Salt", line: "Style not chosen yet", tone: "working" },
          ].map((f, i) => (
            <li key={f.title}>
              <PictureTile
                label={f.title}
                overlay={f.title}
                coverLine={<StatusLine>{f.line}</StatusLine>}
                actionsInline
                actions={
                  <>
                    <Button variant="primary">Continue</Button>
                    <Button variant="dark">Rename</Button>
                  </>
                }
                status={
                  <StatusLine tone={f.tone as "waiting" | "working"}>
                    {i === 2 ? "Style" : "Pre-production"}
                  </StatusLine>
                }
                className="enter"
                style={stagger(i)}
              />
            </li>
          ))}
        </ul>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(208px,1fr))] gap-x-7 gap-y-10">
          {[
            { name: "Mara", status: "Ready", tone: "done", placeholder: "Image placeholder" },
            { name: "Ines", status: "Needs image", tone: "waiting", placeholder: "No image yet" },
          ].map((a, i) => (
            <li key={a.name}>
              <PictureTile
                label={a.name}
                aspect="portrait"
                placeholder={a.placeholder}
                dashed={a.tone === "waiting"}
                coverHeading={a.name}
                actions={
                  <>
                    <Button variant={a.tone === "waiting" ? "primary" : "dark"}>
                      {a.tone === "waiting" ? "Add Image" : "Open"}
                    </Button>
                    <Button variant="dark">Rename</Button>
                  </>
                }
                caption={a.name}
                status={<StatusLine tone={a.tone as "done" | "waiting"}>{a.status}</StatusLine>}
                className="enter"
                style={stagger(i)}
              />
            </li>
          ))}
          <li>
            <PicturePlaceholder aspect="portrait" dashed label="No image yet" />
          </li>
        </ul>
        <TitleCard size="hero" title="The Lighthouse Keeper" line="Pre-production" />
      </Section>

      <Section
        id="options"
        title="Options"
        note="Picture options show a neutral Example image until real examples exist."
      >
        <div className="grid max-w-190 grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
          <OptionTile label="Cinematic" selected />
          <OptionTile label="Animation" />
          <OptionTile label="Not what you have in mind?" kind="other" />
        </div>
        <div className="flex max-w-140 flex-col gap-2">
          <OptionRow selected>3 minutes</OptionRow>
          <OptionRow>5 minutes</OptionRow>
        </div>
      </Section>

      <Section
        id="blocks"
        title="Leading Option"
        note="The main road is a big white block; the alternatives stay present as dark tiles."
      >
        <div className="flex max-w-170 flex-wrap gap-3">
          <FeatureBlock
            className="flex-[2_1_300px]"
            title="Answer a Few Questions"
            description="We ask about her, one thing at a time, and write the prompt for you."
            cta="Start"
          />
          <div className="flex flex-[1_1_200px] flex-col gap-3">
            <QuietTile className="flex-1" title="Write a Prompt" />
            <QuietTile className="flex-1" title="Upload an Image" icon={<Upload />} />
          </div>
        </div>
      </Section>

      <Section
        id="demo"
        title="Demo Hints"
        note="A quiet animation behind the label shows what the card does. It plays once when it comes into view, rests on its last frame, and plays again on hover or keyboard focus."
      >
        <div className="flex max-w-170 flex-wrap gap-3">
          <FeatureBlock
            className="flex-[2_1_300px]"
            title="Answer a Few Questions"
            description="We ask about her, one thing at a time, and write the prompt for you."
            cta="Start"
          />
          <div className="flex flex-[1_1_200px] flex-col gap-3">
            <QuietTile
              className="flex-1"
              title="Write a Prompt"
              demo={
                <DemoHint>
                  <TypingScene lines={DEMO_PROMPT_LINES} />
                </DemoHint>
              }
            />
            <QuietTile
              className="flex-1"
              icon={<Upload />}
              title="Upload an Image"
              demo={
                <DemoHint delay={600} mask="none">
                  <DropScene variant="image" />
                </DemoHint>
              }
            />
          </div>
        </div>
        <Row label="Hover only: rests on its last frame until the card is hovered or focused">
          <QuietTile
            className="min-h-36 w-70"
            title="Upload a Recording"
            demo={
              <DemoHint trigger="hover" mask="none">
                <DropScene variant="audio" />
              </DemoHint>
            }
          />
          <QuietTile
            className="min-h-36 w-70"
            title="Describe the Place"
            demo={
              <DemoHint trigger="hover">
                <TypingScene lines={[samplePrompt("location", "The Lamp Room", null)]} />
              </DemoHint>
            }
          />
        </Row>
        <Row label="Silhouettes for empty asset slots, one per kind">
          {["character", "location", "prop", "voice", "creature", "costume", "other"].map(
            (kind, i) => (
              <div
                key={kind}
                className="demo-host relative flex h-40 w-32 items-end justify-center rounded-tile bg-selected p-2 text-meta text-label-2"
              >
                <DemoHint delay={i * 250} mask="none">
                  <SilhouetteScene kind={kind} className="[--demo-sil-bottom:30%]" />
                </DemoHint>
                <span>{kind}</span>
              </div>
            ),
          )}
        </Row>
        <Row label="Waveform behind a heading">
          <div className="demo-host relative w-96 rounded-card bg-elevated p-4">
            <DemoHint mask="left" className="[--demo-pad:0rem]">
              <WaveformScene align="end" bars={32} />
            </DemoHint>
            <p className="text-heading-sm">Add Ines’s Voice</p>
            <p className="text-body text-label-2">It is used as is.</p>
          </div>
        </Row>
        <Row label="Animated placeholder: examples typed into an empty field, ending on the real placeholder; focus brings the plain one back">
          <AnimatedPlaceholderDemo />
        </Row>
        <IssueScenesDemo />
      </Section>

      <Section id="paper" title="Paper" note="Screenplay text: Courier Prime 16/24 on paper.">
        <PaperSheet heading="INT. KEEPER’S COTTAGE - DAY">
          <ScreenplayAction>INES folds oilskins at the table. She has not slept.</ScreenplayAction>
          <ScreenplayDialogue who="INES">He should have been back by now.</ScreenplayDialogue>
        </PaperSheet>
      </Section>

      <Section id="status" title="Status">
        <Row label="Status lines">
          <StatusLine tone="done">Ready</StatusLine>
          <StatusLine tone="waiting">1 to review · 2 need an image</StatusLine>
          <StatusLine tone="working">Generating</StatusLine>
          <StatusLine tone="failed">Failed · try again</StatusLine>
        </Row>
        <Row label="Toolbar: back control and stage strip">
          <div className="flex w-full flex-wrap items-center gap-x-6 gap-y-3">
            <BackControl href="#status">Pre-production</BackControl>
            <div className="ml-auto flex max-w-full">
              <StageStrip stages={stages} />
            </div>
          </div>
        </Row>
        <Row label="Tags: only real status in a dense list, never decoration">
          <Badge tone="warning">Needs Review</Badge>
          <Badge tone="danger">Failed</Badge>
        </Row>
        <Row label="Technical values: Mono and Kbd">
          <span className="text-body text-label-2">
            Clip <Mono className="text-label">00:01:35</Mono> costs{" "}
            <Mono className="text-label">120</Mono> credits
          </span>
          <span className="text-body text-label-2">
            Hide the sidebar with <Kbd>⌘\</Kbd>
          </span>
        </Row>
        <Row label="Activity">
          <Spinner size="sm" />
          <Spinner />
          <Spinner size="lg" />
        </Row>
        <div className="grid max-w-3xl gap-6 sm:grid-cols-2">
          <div className="flex flex-col gap-5">
            <ProgressBar value={42} label="Rendering" showValue />
            <ProgressBar value={null} label="Waiting in queue" />
          </div>
          <div className="flex flex-col gap-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="aspect-video w-full" />
          </div>
        </div>
      </Section>

      <Section
        id="feedback"
        title="Feedback"
        note="Motion that confirms what just happened: 150-300ms on the app curve, still under reduced motion."
      >
        <FeedbackDemo />
      </Section>

      <Section
        id="loading"
        title="Loading"
        note="Skeletons shaped like the real screen. Wrap them in SkeletonRegion."
      >
        <SkeletonRegion className="max-w-5xl">
          <SkeletonHeader actions={1} />
          <div className="flex flex-wrap gap-x-20 gap-y-10">
            <SkeletonRows rows={4} className="flex-[1_1_260px] sm:max-w-80" />
            <div className="flex min-w-0 flex-[999_1_380px] flex-col gap-6">
              <SkeletonText lines={3} />
              <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
                <SkeletonTile />
                <SkeletonTile />
                <SkeletonTile />
              </div>
              <SkeletonButton />
            </div>
          </div>
        </SkeletonRegion>
      </Section>

      <Section
        id="icons"
        title="Icons"
        note="Lucide only, stroke 1.5, 16px beside text, 20px standalone. Same icon for the same meaning."
      >
        <Row label="Beside text (16px) and standalone (20px)">
          <Button leadingIcon={<Upload />}>Upload an Image</Button>
          <IconButton label="Add Scene" icon={<Plus />} variant="dark" />
          <IconButton label="Delete Scene" icon={<Trash2 />} />
        </Row>
        <Row label="Play glyph nudged right to its visual centre (optical-play)">
          <button
            type="button"
            aria-label="Play"
            className="flex size-14 press items-center justify-center rounded-full bg-fill text-label focus-ring"
          >
            <Play aria-hidden="true" className="size-(--icon-lg) optical-play" />
          </button>
        </Row>
      </Section>

      <Section id="lists" title="Grouped Lists" note="Settings rows on a dark tile.">
        <div className="flex max-w-(--settings-w) flex-col gap-8">
          <GroupedList header="Profile" footer="Your email address is how you sign in.">
            <GroupedListField label="Name">
              <Input defaultValue="Leila Hatami" />
            </GroupedListField>
            <GroupedListRow label="Email">leila@example.com</GroupedListRow>
          </GroupedList>
          <GroupedList>
            <GroupedListButton chevron>Export Settings</GroupedListButton>
            <GroupedListButton destructive>Sign Out</GroupedListButton>
          </GroupedList>
        </div>
      </Section>

      <Section id="choices" title="Choices">
        <Row label="Pop-up button and segmented control">
          <Select
            options={genres}
            value={genre}
            onValueChange={setGenre}
            placeholder="Genre"
            aria-label="Genre"
          />
          <SegmentedControl
            aria-label="View"
            value={view}
            onValueChange={setView}
            options={[
              { value: "grid", label: "Grid" },
              { value: "list", label: "List" },
            ]}
          />
        </Row>
        <Row label="Option thumbnails (older screens)">
          <ChoiceCards
            aria-label="Format"
            value={format}
            onValueChange={setFormat}
            options={[
              { value: "movie", title: "Movie", icon: <Clapperboard /> },
              { value: "series", title: "Series", icon: <Tv /> },
            ]}
          />
        </Row>
        <div className="grid max-w-3xl gap-6 sm:grid-cols-2">
          <Field label="Release Date">
            <DatePicker value={date} onValueChange={setDate} clearable />
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
        note="Sheets only for short focused tasks; alerts only to confirm a destructive action."
      >
        <Row>
          <Menu trigger={<Button>Menu</Button>}>
            <MenuLabel>leila@example.com</MenuLabel>
            <MenuItem shortcut="⌘R">Rename…</MenuItem>
            <MenuSeparator />
            <MenuItem destructive>Delete…</MenuItem>
          </Menu>
          <Button onClick={() => setSheet(true)}>Sheet</Button>
          <Button onClick={() => setAlert(true)}>Alert</Button>
          <Popover trigger={<Button>Popover</Button>} aria-label="Note">
            <p className="w-56 text-secondary text-label-2">Small, optional content.</p>
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
              <Button variant="plain" onClick={() => setSheet(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => setSheet(false)}>
                Rename
              </Button>
            </>
          }
        >
          <Field label="Title">
            <Input defaultValue="The Lighthouse Keeper" />
          </Field>
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

      <Section id="help" title="Help">
        <Hint>Start simple. One sentence about the idea is enough.</Hint>
        <div className="flex flex-col items-start gap-3">
          <div ref={tipTarget}>
            <Button onClick={tip.reset}>Show Tip Again</Button>
          </div>
          <Tip
            open={!tip.dismissed}
            anchor={tipTarget}
            title="Pick a Look First"
            onDismiss={tip.dismiss}
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
          <SidebarAction icon={<Plus />}>New Project</SidebarAction>
          <SidebarBody aria-label="Kit sections">
            <SidebarSection title="Library">
              <SidebarItem variant="nav" icon={<House strokeWidth={1.5} />} selected href="#">
                Home
              </SidebarItem>
              <SidebarItem variant="nav" icon={<LayoutGrid strokeWidth={1.5} />} href="#">
                Projects
              </SidebarItem>
            </SidebarSection>
            <SidebarSection title="Sections" divided>
              {SECTIONS.map((s) => (
                <SidebarItem key={s.id} href={`#${s.id}`}>
                  {s.label}
                </SidebarItem>
              ))}
            </SidebarSection>
          </SidebarBody>
        </>
      }
    >
      <Toolbar
        titleAs="div"
        title="The Lighthouse Keeper"
        trailing={<StageStrip stages={stages} />}
      />
      <Content />
    </SplitView>
  );
}
