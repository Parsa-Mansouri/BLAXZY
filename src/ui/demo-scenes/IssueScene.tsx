import type { CSSProperties, ReactNode } from "react";
import { cn } from "../cn";

/*
  Issue scenes: one 24x24 pictogram per thing that can be wrong with a picture, a sheet, a shot
  block or a take. Each rests on the PROBLEM (so the chip's icon matches its label), and on hover
  resolves into the fixed picture, holds, and settles back.

  Three parts, all driven by one clock (--demo-issue-dur) in issues.css:
    demo-issue-bad    drawn only in the wrong state (fades out, then back)
    demo-issue-good   drawn only in the fixed state (fades in, then out)
    demo-issue-move   sits displaced in the wrong state and moves home in the fixed one; the
                      displacement comes from `away()`
  Anything without a class is drawn in both states.
*/

/** Where a `demo-issue-move` part sits in the wrong state, relative to its drawn (fixed) place. */
function away(at: {
  x?: number;
  y?: number;
  scaleX?: number;
  scaleY?: number;
  rotate?: number;
  origin?: string;
}): CSSProperties {
  return {
    "--demo-issue-x": `${at.x ?? 0}px`,
    "--demo-issue-y": `${at.y ?? 0}px`,
    "--demo-issue-sx": at.scaleX ?? 1,
    "--demo-issue-sy": at.scaleY ?? 1,
    "--demo-issue-r": `${at.rotate ?? 0}deg`,
    ...(at.origin ? { transformOrigin: at.origin } : {}),
  } as CSSProperties;
}

function Glyph({ name, children }: { name: string; children: ReactNode }) {
  return (
    <span className={cn("demo-scene demo-issue", `demo-issue-${name}`)}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </span>
  );
}

/** The edge of a picture. */
const FRAME = <rect x="2.75" y="3.75" width="18.5" height="16.5" rx="2.5" />;

/** Head and shoulders, centred on x = 12, inside FRAME. */
const BUST = (
  <>
    <circle cx="12" cy="10" r="2.75" />
    <path d="M6.75 19.5c0-3 2.3-4.75 5.25-4.75s5.25 1.75 5.25 4.75" />
  </>
);

/** A dot the width of a stroke (an eye, a button). */
function Dot({ x, y }: { x: number; y: number }) {
  return <path d={`M${x} ${y}h.01`} strokeWidth="2" />;
}

/** A face that is broken up and missing features; fixed: whole, two eyes, a mouth. */
export function FaceIssueScene() {
  return (
    <Glyph name="face">
      <g className="demo-issue-bad">
        <circle cx="12" cy="12" r="8.25" strokeDasharray="2.5 3.5" />
        <Dot x={9} y={10.5} />
        <path d="M8.5 16c1.5-1.5 2.5.5 4-.5s2-2 3.5-1" />
      </g>
      <g className="demo-issue-good">
        <circle cx="12" cy="12" r="8.25" />
        <Dot x={9} y={10.5} />
        <Dot x={15} y={10.5} />
        <path d="M8.75 14.75a4 4 0 0 0 6.5 0" />
      </g>
    </Glyph>
  );
}

/** A figure with a third arm; fixed: two. */
export function AnatomyIssueScene() {
  return (
    <Glyph name="anatomy">
      <circle cx="12" cy="5" r="2.5" />
      <path d="M12 7.5V15M12 15l-3.5 6M12 15l3.5 6M12 10.5l-5.5 3M12 10.5l5.5 3" />
      <path className="demo-issue-bad" d="M12 10.5l6.5-4.5" />
    </Glyph>
  );
}

/** A striped top; fixed: a buttoned one. */
export function ClothingIssueScene() {
  return (
    <Glyph name="clothing">
      <path d="M8.5 4 3.5 7l2 3.5L8 9.25V20h8V9.25l2.5 1.25 2-3.5-5-3c-.5 1.4-1.8 2.25-3.5 2.25S9 5.4 8.5 4Z" />
      <path className="demo-issue-bad" d="M8 13h8M8 16.5h8" />
      <path className="demo-issue-good" d="M12 6.25V20" />
    </Glyph>
  );
}

/** Three swatches with the wrong one filled; fixed: another one. */
export function ColoursIssueScene() {
  return (
    <Glyph name="colours">
      <circle cx="12" cy="8.5" r="4.25" />
      <circle cx="8" cy="15" r="4.25" />
      <circle cx="16" cy="15" r="4.25" />
      <circle className="demo-issue-bad demo-issue-fill" cx="12" cy="8.5" r="4.25" stroke="none" />
      <circle className="demo-issue-good demo-issue-fill" cx="16" cy="15" r="4.25" stroke="none" />
    </Glyph>
  );
}

/** A letter stamped across a picture; fixed: the picture alone. */
export function TextIssueScene() {
  return (
    <Glyph name="text">
      {FRAME}
      <path d="M5 17.5l4-4.5 3 3 2.5-3 4.5 4.5" />
      <path className="demo-issue-bad" d="M8.5 7.5h7M12 7.5v6" />
    </Glyph>
  );
}

/** Two pictures, one drawn in line and one painted solid; fixed: both in line. */
export function StyleIssueScene() {
  return (
    <Glyph name="style">
      <rect x="2.75" y="6.75" width="8" height="10.5" rx="2" />
      <rect x="13.25" y="6.75" width="8" height="10.5" rx="2" />
      <circle cx="6.75" cy="12" r="2.25" />
      <circle className="demo-issue-bad" cx="17.25" cy="12" r="2.25" fill="currentColor" />
      <circle className="demo-issue-good" cx="17.25" cy="12" r="2.25" />
    </Glyph>
  );
}

/** Clutter behind the subject; fixed: the subject on an empty ground. */
export function BackgroundIssueScene() {
  return (
    <Glyph name="background">
      {FRAME}
      {BUST}
      <g className="demo-issue-bad">
        <path d="M5 7.75h2.5M6.25 6.5V9" />
        <circle cx="17.75" cy="7.75" r="1.25" />
        <path d="M5 12l1.5 1.5L5 15" />
        <path d="M17 14.5l1.25-2 1.25 2Z" />
      </g>
    </Glyph>
  );
}

/** The subject pushed into a corner and cut by the edge; fixed: centred. */
export function FramingIssueScene() {
  return (
    <Glyph name="framing">
      {FRAME}
      <svg x="2.75" y="3.75" width="18.5" height="16.5" viewBox="2.75 3.75 18.5 16.5">
        <g className="demo-issue-move" style={away({ x: 5.5, y: 3, scaleX: 1.2, scaleY: 1.2 })}>
          {BUST}
        </g>
      </svg>
    </Glyph>
  );
}

/** A second figure beside the subject; fixed: the subject alone, centred. */
export function ExtraSubjectIssueScene() {
  return (
    <Glyph name="extra">
      <g className="demo-issue-move" style={away({ x: -3.5 })}>
        <circle cx="12" cy="9" r="3.25" />
        <path d="M6 20c0-3.5 2.6-5.5 6-5.5s6 2 6 5.5" />
      </g>
      <g className="demo-issue-bad">
        <circle cx="18.75" cy="11" r="2.25" />
        <path d="M16.75 16.25c.6-.35 1.3-.5 2-.5 2 0 3.25 1.4 3.25 4.25" />
      </g>
    </Glyph>
  );
}

/** A subject lost in shadow; fixed: lit, the face readable. */
export function LightingIssueScene() {
  return (
    <Glyph name="lighting">
      <circle cx="12" cy="9" r="3.75" />
      <path d="M4.75 20.5c0-4 3.1-6.25 7.25-6.25s7.25 2.25 7.25 6.25" />
      <g className="demo-issue-bad demo-issue-fill" stroke="none">
        <circle cx="12" cy="9" r="3.75" />
        <path d="M4.75 20.5c0-4 3.1-6.25 7.25-6.25s7.25 2.25 7.25 6.25Z" />
      </g>
      <g className="demo-issue-good">
        <Dot x={10.6} y={8.75} />
        <Dot x={13.4} y={8.75} />
      </g>
    </Glyph>
  );
}

const VIEW_X = [4.5, 12, 19.5] as const;

function viewShoulders(x: number): string {
  return `M${x - 3.25} 18c0-2.25 1.4-3.5 3.25-3.5s3.25 1.25 3.25 3.5`;
}

/**
 * Three views of one character in a row. `differs`: the last one has another head; `scale`: the
 * middle head is too big; `missing`: the last view is an empty outline. Fixed: three alike.
 */
export function ViewsIssueScene({ variant }: { variant: "differs" | "scale" | "missing" }) {
  const last = VIEW_X[2];
  return (
    <Glyph name="views">
      <circle cx={VIEW_X[0]} cy="10" r="2.75" />
      <path d={viewShoulders(VIEW_X[0])} />
      <path d={viewShoulders(VIEW_X[1])} />
      <circle
        className={variant === "scale" ? "demo-issue-move" : undefined}
        style={variant === "scale" ? away({ scaleX: 1.5, scaleY: 1.5 }) : undefined}
        cx={VIEW_X[1]}
        cy="10"
        r="2.75"
      />
      {variant === "missing" ? (
        <>
          <g className="demo-issue-bad" strokeDasharray="1.75 2.25">
            <circle cx={last} cy="10" r="2.75" />
            <path d={viewShoulders(last)} />
          </g>
          <g className="demo-issue-good">
            <circle cx={last} cy="10" r="2.75" />
            <path d={viewShoulders(last)} />
          </g>
        </>
      ) : (
        <>
          <path d={viewShoulders(last)} />
          {variant === "differs" ? (
            <>
              <rect
                className="demo-issue-bad"
                x={last - 2.75}
                y="7.25"
                width="5.5"
                height="5.5"
                rx="1"
              />
              <circle className="demo-issue-good" cx={last} cy="10" r="2.75" />
            </>
          ) : (
            <circle cx={last} cy="10" r="2.75" />
          )}
        </>
      )}
    </Glyph>
  );
}

/** The result is not the reference: a not-equal sign between two heads; fixed: equal, alike. */
export function MatchIssueScene() {
  return (
    <Glyph name="match">
      <circle cx="4.75" cy="12" r="3" />
      <path d="M9.75 10.5h4.5M9.75 13.5h4.5" />
      <path className="demo-issue-bad" d="M13.25 8.25l-2.5 7.5" />
      <rect className="demo-issue-bad" x="16.25" y="9" width="6" height="6" rx="1.25" />
      <circle className="demo-issue-good" cx="19.25" cy="12" r="3" />
    </Glyph>
  );
}

/** Four panels thrown together; fixed: a tidy grid. */
export function ClutterIssueScene() {
  return (
    <Glyph name="clutter">
      <rect
        className="demo-issue-move"
        style={away({ x: 2.5, y: 1.5, rotate: -12 })}
        x="3.5"
        y="5"
        width="7"
        height="5.5"
        rx="1.25"
      />
      <rect
        className="demo-issue-move"
        style={away({ x: -2, y: 3, rotate: 9 })}
        x="13.5"
        y="5"
        width="7"
        height="5.5"
        rx="1.25"
      />
      <rect
        className="demo-issue-move"
        style={away({ x: 1.5, y: -2.5, rotate: 7 })}
        x="3.5"
        y="13.5"
        width="7"
        height="5.5"
        rx="1.25"
      />
      <rect
        className="demo-issue-move"
        style={away({ x: -3, y: -1, rotate: -10 })}
        x="13.5"
        y="13.5"
        width="7"
        height="5.5"
        rx="1.25"
      />
    </Glyph>
  );
}

const TILE_X = [2.5, 9.25, 16] as const;

/**
 * The references attached to a shot, as three tiles. `wrong`: the last one is crossed out;
 * `missing`: the last one is an empty outline. Fixed: three filled tiles.
 */
export function AttachedIssueScene({ variant }: { variant: "wrong" | "missing" }) {
  const last = TILE_X[2];
  return (
    <Glyph name="attached">
      {TILE_X.slice(0, 2).map((x) => (
        <g key={x}>
          <rect x={x} y="7.5" width="5.5" height="9" rx="1.5" />
          <Dot x={x + 2.75} y={12} />
        </g>
      ))}
      {variant === "missing" ? (
        <rect
          className="demo-issue-bad"
          x={last}
          y="7.5"
          width="5.5"
          height="9"
          rx="1.5"
          strokeDasharray="1.75 2.25"
        />
      ) : (
        <>
          <rect x={last} y="7.5" width="5.5" height="9" rx="1.5" />
          <path
            className="demo-issue-bad"
            d={`M${last + 1.5} 10.75l2.5 2.5M${last + 4} 10.75l-2.5 2.5`}
          />
        </>
      )}
      <g className="demo-issue-good">
        {variant === "missing" ? <rect x={last} y="7.5" width="5.5" height="9" rx="1.5" /> : null}
        <Dot x={last + 2.75} y={12} />
      </g>
    </Glyph>
  );
}

/** The subject too small in the viewfinder; fixed: the right shot size. */
export function ShotSizeIssueScene() {
  return (
    <Glyph name="shotsize">
      <path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16" />
      <g className="demo-issue-move" style={away({ scaleX: 0.5, scaleY: 0.5 })}>
        <circle cx="12" cy="9.5" r="2.75" />
        <path d="M6.75 18c0-2.75 2.3-4.25 5.25-4.25s5.25 1.5 5.25 4.25" />
      </g>
    </Glyph>
  );
}

/** A camera moving the wrong way; fixed: the arrow turns round. */
export function CameraMoveIssueScene() {
  return (
    <Glyph name="cameramove">
      <rect x="3.5" y="3.5" width="11" height="8.5" rx="2" />
      <path d="M14.5 6.75l5-2.5v7l-5-2.5" />
      <g className="demo-issue-move" style={away({ rotate: 180 })}>
        <path d="M5.5 18.25h13M15.5 15.25l3 3-3 3" />
      </g>
    </Glyph>
  );
}

/** Two shots in a row with a line that does not carry over; fixed: it runs straight through. */
export function ContinuityIssueScene() {
  return (
    <Glyph name="continuity">
      <rect x="2.5" y="6" width="8.5" height="12" rx="2" />
      <rect x="13" y="6" width="8.5" height="12" rx="2" />
      <path d="M4.75 10.5h4" />
      <path className="demo-issue-move" style={away({ y: 4 })} d="M15.25 10.5h4" />
    </Glyph>
  );
}

/** Night where it should be day; fixed: the sun. */
export function SettingIssueScene() {
  return (
    <Glyph name="setting">
      <path d="M2.5 19.5l5.5-7 3.5 4 2.5-3 7.5 6" />
      <path
        className="demo-issue-bad"
        d="M19.6 8.35A3.6 3.6 0 0 1 15.4 4.1a3.6 3.6 0 1 0 4.2 4.25Z"
      />
      <g className="demo-issue-good">
        <circle cx="17" cy="6.5" r="2" />
        <path d="M17 2.25V3M17 10v.75M12.75 6.5h.75M20.5 6.5h.75" />
      </g>
    </Glyph>
  );
}

/** A pin beside its mark; fixed: on it. */
export function LocationIssueScene() {
  return (
    <Glyph name="location">
      <ellipse cx="15.5" cy="20" rx="3.25" ry="1.25" />
      <g className="demo-issue-move" style={away({ x: -8 })}>
        <path d="M15.5 17s-4.25-3.9-4.25-7.5a4.25 4.25 0 0 1 8.5 0c0 3.6-4.25 7.5-4.25 7.5Z" />
        <circle cx="15.5" cy="9.5" r="1.25" />
      </g>
    </Glyph>
  );
}

const GLITCH_BANDS = [
  { y: 3.5, height: 5.5, x: -2.5 },
  { y: 9, height: 6, x: 2.5 },
  { y: 15, height: 6.5, x: -2 },
] as const;

/** A figure torn into shifted bands; fixed: whole. */
export function GlitchIssueScene() {
  return (
    <Glyph name="glitch">
      {GLITCH_BANDS.map((band) => (
        <svg
          key={band.y}
          x="0"
          y={band.y}
          width="24"
          height={band.height}
          viewBox={`0 ${band.y} 24 ${band.height}`}
        >
          <g className="demo-issue-move" style={away({ x: band.x })}>
            <circle cx="12" cy="9" r="3.75" />
            <path d="M4.75 20.5c0-4 3.1-6.25 7.25-6.25s7.25 2.25 7.25 6.25" />
          </g>
        </svg>
      ))}
    </Glyph>
  );
}

/** A ball that stays put with its path ahead of it; fixed: it rolls. */
export function StaticIssueScene() {
  return (
    <Glyph name="static">
      <path d="M2.5 19.5h19" />
      <path className="demo-issue-bad" d="M11 15.5h9" strokeDasharray="1.75 2.5" />
      <path className="demo-issue-good" d="M5 13.5h5M3.5 16.5h6" />
      <circle className="demo-issue-move" style={away({ x: -11 })} cx="17" cy="15.5" r="3.25" />
    </Glyph>
  );
}

/** An arc that stops at a cut; fixed: it runs to its end. */
export function CutOffIssueScene() {
  return (
    <Glyph name="cutoff">
      <path d="M3 18.5C5 10 8 6.5 12 6.5" />
      <path className="demo-issue-bad" d="M14.5 3.5v17" strokeDasharray="2 2.5" />
      <path className="demo-issue-good" d="M12 6.5c4 0 7 3.5 9 12" />
    </Glyph>
  );
}

/** A picture whose light pulses; fixed: steady. */
export function FlickerIssueScene() {
  return (
    <Glyph name="flicker">
      <rect x="5" y="6" width="14" height="12" rx="2" />
      <rect className="demo-issue-blink" x="5" y="6" width="14" height="12" rx="2" stroke="none" />
      <path className="demo-issue-bad" d="M12 1.75V3.5M12 20.5v1.75M1.5 12h1.75M20.75 12h1.75" />
    </Glyph>
  );
}

export interface LengthBarSceneProps {
  /** True: the bar runs past the target mark. False: it stops short of it. */
  over: boolean;
}

/** A length against its target mark: running past it or stopping short; fixed: exactly on it. */
export function LengthBarScene({ over }: LengthBarSceneProps) {
  return (
    <Glyph name="length">
      <path d="M16 5.5v13" />
      <rect
        className="demo-issue-move demo-issue-fill"
        style={away({ scaleX: over ? 1.4 : 0.45, origin: "left center" })}
        x="3"
        y="9.75"
        width="13"
        height="4.5"
        rx="1.5"
        stroke="none"
      />
    </Glyph>
  );
}

export interface BlockSwapSceneProps {
  className?: string;
}

function BlockCard({ lines, tiles }: { lines: readonly number[]; tiles: number }) {
  return (
    <svg viewBox="0 0 112 56" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="0.75" y="0.75" width="110.5" height="54.5" rx="9" />
      {lines.map((width, i) => (
        <path key={i} d={`M10 ${13 + i * 8}h${width}`} strokeLinecap="round" />
      ))}
      {Array.from({ length: tiles }, (_, i) => (
        <rect key={i} x={10 + i * 17} y="35" width="12" height="12" rx="3" />
      ))}
    </svg>
  );
}

/**
 * A shot block being revised: the current card slides out and the next version slides in.
 * Last frame: the new version in place.
 */
export function BlockSwapScene({ className }: BlockSwapSceneProps) {
  return (
    <span className={cn("demo-scene demo-blockswap", className)}>
      <span className="demo-blockswap-card demo-blockswap-old">
        <BlockCard lines={[84, 52]} tiles={2} />
      </span>
      <span className="demo-blockswap-card demo-blockswap-new">
        <BlockCard lines={[64, 90]} tiles={3} />
      </span>
    </span>
  );
}
