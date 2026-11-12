import { cn } from "../cn";

export interface DropSceneProps {
  /** What is dragged in: a small framed picture, or a waveform chip for a recording. */
  variant: "image" | "audio";
  className?: string;
}

/** Bar heights of the waveform chip, in the 64x28 box. */
const WAVE = [6, 12, 18, 10, 16, 8, 14, 6, 10] as const;

/**
 * A file being dropped on the card: a cursor carries a thumbnail in from outside, the card
 * shows its real drop state (the dashed brand border of UploadZone while dragging), and the
 * thumbnail settles. Last frame: the thumbnail resting in the card's top corner.
 */
export function DropScene({ variant, className }: DropSceneProps) {
  return (
    <span className={cn("demo-scene demo-drop", className)}>
      <span className="demo-drop-zone" />
      <span className="demo-drop-carrier">
        {variant === "image" ? (
          <span className="demo-drop-thumb">
            <svg viewBox="0 0 52 40" width="52" height="40" fill="none" stroke="currentColor">
              <circle cx="16" cy="13" r="4" strokeWidth="1.5" />
              <path
                d="M6 32 20 20l8 7 8-9 10 14"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        ) : (
          <span className="demo-drop-thumb demo-drop-thumb-audio">
            <svg viewBox="0 0 64 28" width="64" height="28" fill="none" stroke="currentColor">
              {WAVE.map((height, i) => (
                <path
                  key={i}
                  d={`M${12 + i * 5} ${14 - height / 2}v${height}`}
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              ))}
            </svg>
          </span>
        )}
        <svg className="demo-drop-cursor" viewBox="0 0 16 16" width="16" height="16">
          <path d="M3 1.5v12l3.4-3 2 4.4 1.9-.9-2-4.3h4.4z" fill="currentColor" />
        </svg>
      </span>
    </span>
  );
}
