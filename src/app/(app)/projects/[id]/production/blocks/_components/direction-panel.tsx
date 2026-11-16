import { ArrowRight } from "lucide-react";
import type { BlockDirectionView, ShotView, StagingView } from "@/server/blocks";
import { stagger } from "@/ui";
import { Mono } from "@/app/(app)/_components/values";
import {
  continuityLabel,
  framing,
  functionLabel,
  plain,
  stagingLine,
  windowLabel,
  windowLengths,
  type Names,
} from "../_lib/direction-text";
import { Section } from "./section";

/**
 * The strip: the block's running time cut into its shots, each segment as long as its window,
 * numbered like the list below it, so the rhythm of the cuts can be read at a glance.
 */
function CutStrip({ shots, total }: { shots: readonly ShotView[]; total: number }) {
  const lengths = windowLengths(shots);
  return (
    <div aria-hidden className="flex flex-col gap-1.5">
      <div className="flex h-9 gap-0.5">
        {shots.map((shot, i) => (
          <div
            key={shot.shot_number || i}
            style={{ flexGrow: lengths[i] ?? 1, flexBasis: 0 }}
            className="flex min-w-0 items-end rounded-mark bg-fill px-2 pb-1 text-meta text-label-2 tabular-nums"
          >
            {i + 1}
          </div>
        ))}
      </div>
      <div className="flex justify-between text-meta text-label-3 tabular-nums">
        <span>0 s</span>
        <span>{total > 0 ? `${total} s` : ""}</span>
      </div>
    </div>
  );
}

function Shots({ shots, names }: { shots: readonly ShotView[]; names: Names }) {
  return (
    <ol className="flex max-w-205 flex-col">
      {shots.map((shot, i) => (
        <li
          key={shot.shot_number || i}
          className="grid enter grid-cols-[5.5rem_minmax(0,1fr)] gap-x-5 border-t border-separator py-4 first:border-t-0 max-sm:grid-cols-1 max-sm:gap-y-1.5"
          style={stagger(i, 50)}
        >
          <div className="flex flex-col gap-0.5">
            <Mono>{windowLabel(shot.window)}</Mono>
            <span className="caps-label text-label-3">Angle {i + 1}</span>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="text-body text-label">{framing(shot) || "Angle"}</p>
            {shot.action.trim() ? (
              <p className="max-w-(--measure) text-body text-pretty text-label-2">
                {plain(shot.action, names)}
              </p>
            ) : null}
            {shot.dialogue.map((line, j) => (
              <p key={j} className="max-w-(--measure) text-secondary text-pretty text-label-2">
                <span className="text-label">{names[line.speaker_id] ?? line.speaker_id}</span>
                {line.delivery.trim() ? ` (${plain(line.delivery, names)})` : ""}
                {": "}“{line.line}”
              </p>
            ))}
            {shot.cut_reason.trim() ? (
              <p className="max-w-(--measure) text-secondary text-pretty text-label-3">
                Cut: {plain(shot.cut_reason, names)}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Frame({
  label,
  state,
  staging,
  names,
}: {
  label: string;
  state: string;
  staging: readonly StagingView[];
  names: Names;
}) {
  const lines = staging.map((s) => stagingLine(s, names)).filter((l) => l.detail || l.name);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h4 className="caps-label text-label-3">{label}</h4>
      {state.trim() ? (
        <p className="max-w-(--measure) text-body text-pretty text-label">{plain(state, names)}</p>
      ) : null}
      {lines.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {lines.map((line, i) => (
            <li key={i} className="max-w-(--measure) text-secondary text-pretty text-label-2">
              <span className="text-label">{line.name}</span>
              {line.detail ? ` · ${line.detail}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Reason({ title, children }: { title: string; children: string }) {
  if (!children.trim()) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <h4 className="caps-label text-label-3">{title}</h4>
      <p className="max-w-(--measure) text-body text-pretty text-label-2">{children}</p>
    </div>
  );
}

/**
 * What the Director decided for this shot, in plain words: how the time is cut, where everyone
 * stands when the shot opens and when it ends, why the camera and the cuts are what they are, and
 * how the shot hands over to the next one. Blocks cut before the Director existed have none.
 */
export function DirectionPanel({
  direction,
  durationSeconds,
  className,
}: {
  direction: BlockDirectionView;
  durationSeconds: number | null;
  className?: string;
}) {
  const names = direction.asset_names;
  const how = continuityLabel(direction.continuity.type);
  const total = durationSeconds ?? direction.duration_s;
  return (
    <Section title="Direction" className={className}>
      <div className="flex flex-col gap-10">
        {direction.dramatic_function.trim() || how ? (
          <div className="flex max-w-(--measure) flex-col gap-1">
            {direction.dramatic_function.trim() ? (
              <p className="text-body text-pretty text-label">
                {functionLabel(direction.dramatic_function, names)}
              </p>
            ) : null}
            {how ? (
              <p className="text-secondary text-pretty text-label-3">
                {how}
                {direction.continuity.note.trim()
                  ? `. ${plain(direction.continuity.note, names)}`
                  : ""}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-4">
          <CutStrip shots={direction.shots} total={total} />
          <Shots shots={direction.shots} names={names} />
        </div>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-x-6 gap-y-6 max-md:grid-cols-1">
            <Frame
              label="At the start"
              state={direction.opening_frame || direction.start_state}
              staging={direction.start_staging}
              names={names}
            />
            <ArrowRight
              aria-hidden
              strokeWidth={1.5}
              className="mt-0.5 size-(--icon-lg) text-label-3 max-md:hidden"
            />
            <Frame
              label="At the end"
              state={direction.end_state}
              staging={direction.end_staging}
              names={names}
            />
          </div>
          {direction.staging_meaning.trim() ? (
            <p className="max-w-(--measure) text-secondary text-pretty text-label-2">
              {plain(direction.staging_meaning, names)}
            </p>
          ) : null}
        </div>

        <div className="grid max-w-205 grid-cols-2 gap-x-10 gap-y-6 max-md:grid-cols-1">
          <Reason title="Why this camera">{plain(direction.camera_rationale, names)}</Reason>
          <Reason title="Why these cuts">{plain(direction.editing_rationale, names)}</Reason>
          <Reason title="Handed to the next shot">
            {plain(direction.in_progress_at_end, names)}
          </Reason>
        </div>
      </div>
    </Section>
  );
}
