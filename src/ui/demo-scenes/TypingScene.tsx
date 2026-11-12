import type { CSSProperties } from "react";
import { cn } from "../cn";
import { caretBlinks, typingPlan, type TypedChar, type TypingOptions } from "../demo-hint-text";

export interface TypingSceneProps {
  /**
   * What gets written. Each line is typed, held and erased in turn; then the first line is typed
   * again and stays. One line is typed once and stays. Keep lines under about 150 characters.
   */
  lines: readonly string[];
  /** Typing speed, hold and pauses; see `typingPlan`. */
  timing?: TypingOptions;
  /**
   * `meta` (default): the card watermark's 13px text. `inherit`: the surrounding type, so an
   * animated placeholder writes in its field's own font (see AnimatedPlaceholder).
   */
  font?: "meta" | "inherit";
  className?: string;
}

/** The custom properties a character's animations read their delays from. */
function charStyle(char: TypedChar, blinks: number): CSSProperties {
  return {
    "--demo-in": `${char.inMs}ms`,
    "--demo-caret": `${char.caretMs}ms`,
    ...(char.outMs === null ? {} : { "--demo-out": `${char.outMs}ms` }),
    "--demo-blinks": blinks,
  } as CSSProperties;
}

/**
 * A prompt being written: characters appear one by one behind a caret, wrapping like real
 * text. Last frame: the first line, fully typed, no caret.
 */
export function TypingScene({ lines, timing, font = "meta", className }: TypingSceneProps) {
  const plan = typingPlan(lines, timing);
  const holdBlinks = caretBlinks(timing?.holdMs ?? 1400);

  return (
    <span className={cn("demo-scene demo-type", font === "meta" && "text-meta", className)}>
      {plan.passes.map((pass, p) => (
        <span key={p} className="demo-type-pass">
          {pass.chars.map((char, i) => {
            const last = i === pass.chars.length - 1;
            return (
              <span
                key={i}
                className="demo-type-char"
                data-out={char.outMs === null ? undefined : ""}
                data-last={last ? "" : undefined}
                style={charStyle(char, last && !pass.stays ? holdBlinks : 2)}
              >
                {char.char}
              </span>
            );
          })}
        </span>
      ))}
    </span>
  );
}
