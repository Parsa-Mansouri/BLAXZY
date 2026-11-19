"use client";

import { useEffect, useId, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { AnimatePresence, MotionConfig, motion, useAnimate, useReducedMotion } from "motion/react";
import { cn } from "@/ui";

export type CodeEntryStatus = "idle" | "verifying" | "error" | "success";

export interface CodeEntryProps {
  value: string;
  onChange: (value: string) => void;
  /** Called once when the last digit lands (typed, pasted or autofilled). */
  onComplete: (code: string) => void;
  status: CodeEntryStatus;
  /** Bumped on every wrong code: replays the shake. */
  errorTick: number;
  length?: number;
  /** Id of the text that describes the field (the status line). */
  describedBy?: string;
}

const EASE: [number, number, number, number] = [0.32, 0.72, 0, 1];
const DROP = { type: "spring", stiffness: 520, damping: 26, mass: 0.7 } as const;
/** How far one cell is from the next, in cell widths (cell plus gap): for the success merge. */
const CELL_PITCH = 118;
/** Input types that bring several characters at once (paste, autofill, drag). */
const BULK_INPUT = new Set(["insertFromPaste", "insertFromDrop", "insertReplacementText"]);

function digitsOf(text: string, length: number): string {
  return text.replace(/\D/g, "").slice(0, length);
}

/**
 * A one-time code field: one real `<input>` (numeric keyboard, `one-time-code` autofill, paste,
 * backspace and arrows all native) laid transparently over the cells, which only draw it. The
 * cells arrive in a stagger, a glowing caret glides to the active cell, each digit drops in from a
 * blur, a light sweeps the row while the code is checked, it shakes red when wrong and the row
 * folds into a check mark when right. Reduced motion keeps only the fades.
 */
export function CodeEntry({
  value,
  onChange,
  onComplete,
  status,
  errorTick,
  length = 6,
  describedBy,
}: CodeEntryProps) {
  const inputId = useId();
  const caretId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState(0);
  const [rowScope, animateRow] = useAnimate<HTMLDivElement>();
  const reduceMotion = useReducedMotion();
  const busy = status !== "idle";

  // Read by the native listeners below without re-binding them.
  const latest = useRef({ value, busy, length, onChange, onComplete });
  useEffect(() => {
    latest.current = { value, busy, length, onChange, onComplete };
  });

  function placeCaret(position: number) {
    setCaret(position);
    const input = inputRef.current;
    if (input && document.activeElement === input) input.setSelectionRange(position, position);
  }

  /** The one way a new value gets in: keeps digits only, moves the caret, submits when full. */
  function commit(raw: string, caretAt: number) {
    const { busy: isBusy, length: max, onChange: change, onComplete: complete } = latest.current;
    if (isBusy) return;
    const next = digitsOf(raw, max);
    latest.current.value = next;
    change(next);
    placeCaret(Math.min(caretAt, next.length));
    if (next.length === max) complete(next);
  }

  /** Puts pasted text in: a whole code replaces everything, a fragment goes in at the caret. */
  function insertText(text: string) {
    const { value: current, length: max } = latest.current;
    const pasted = text.replace(/\D/g, "");
    if (!pasted) return;
    if (pasted.length >= max) {
      commit(pasted, max);
      return;
    }
    const input = inputRef.current;
    const start = input?.selectionStart ?? current.length;
    const end = input?.selectionEnd ?? current.length;
    commit(current.slice(0, start) + pasted + current.slice(end), start + pasted.length);
  }
  const insertRef = useRef(insertText);
  useEffect(() => {
    insertRef.current = insertText;
  });

  // Focus on arrival, and again when the person comes back from their mail app, so the keyboard
  // (and its "From Mail" / clipboard suggestion) is up without a tap.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    const refocus = () => {
      if (document.visibilityState !== "visible") return;
      const { value: current, length: max, busy: isBusy } = latest.current;
      if (isBusy || current.length >= max) return;
      const active = document.activeElement;
      if (active && active !== document.body && active !== input) return;
      input.focus({ preventScroll: true });
    };
    document.addEventListener("visibilitychange", refocus);
    window.addEventListener("focus", refocus);
    return () => {
      document.removeEventListener("visibilitychange", refocus);
      window.removeEventListener("focus", refocus);
    };
  }, []);

  // Paste and autofill can bring "123 456" or "123-456", which `maxLength` would cut short:
  // take the digits of the whole text instead.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const onBeforeInput = (event: InputEvent) => {
      const data = event.data ?? event.dataTransfer?.getData("text") ?? "";
      if (
        !BULK_INPUT.has(event.inputType) &&
        !(event.inputType === "insertText" && data.length > 1)
      ) {
        return;
      }
      event.preventDefault();
      insertRef.current(data);
    };
    input.addEventListener("beforeinput", onBeforeInput);
    return () => input.removeEventListener("beforeinput", onBeforeInput);
  }, []);

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    insertText(event.clipboardData.getData("text"));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const start = input.selectionStart ?? value.length;
    const end = input.selectionEnd ?? value.length;
    // A digit typed over an existing one replaces it (the field is otherwise full-length).
    if (/^\d$/.test(event.key) && start === end && start < value.length) {
      event.preventDefault();
      commit(value.slice(0, start) + event.key + value.slice(start + 1), start + 1);
    }
  }

  // Wrong code: a spring shake of the whole row.
  useEffect(() => {
    if (errorTick === 0 || reduceMotion || !rowScope.current) return;
    void animateRow(
      rowScope.current,
      { x: [0, -18, 15, -11, 7, -3, 0] },
      { duration: 0.5, ease: "easeOut" },
    );
  }, [errorTick, reduceMotion, animateRow, rowScope]);

  // Back to typing after an error: the field is cleared, so put the keyboard back.
  useEffect(() => {
    if (status === "idle" && value.length === 0) inputRef.current?.focus({ preventScroll: true });
  }, [status, value.length]);

  const activeIndex = focused && !busy ? Math.min(caret, value.length, length - 1) : -1;
  const cells = Array.from({ length }, (_, index) => value[index] ?? "");
  const center = (length - 1) / 2;

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex flex-col gap-3">
        <label
          htmlFor={inputId}
          className="enter text-callout text-label-2"
          style={{ animationDelay: "240ms" }}
        >
          Verification code
        </label>
        <div className="relative">
          <div
            ref={rowScope}
            aria-hidden="true"
            className="relative grid grid-cols-6 gap-2 sm:gap-3"
          >
            {cells.map((digit, index) => {
              const active = index === activeIndex;
              return (
                <motion.div
                  key={index}
                  className="relative"
                  initial={{ opacity: 0, y: 22, filter: "blur(8px)" }}
                  animate={
                    status === "success"
                      ? {
                          opacity: 0,
                          x: `${(center - index) * CELL_PITCH}%`,
                          scale: 0.4,
                          filter: "blur(6px)",
                          transition: { duration: 0.45, ease: EASE, delay: 0.25 },
                        }
                      : {
                          opacity: 1,
                          x: 0,
                          y: 0,
                          scale: 1,
                          filter: "blur(0px)",
                          transition: { duration: 0.55, ease: EASE, delay: 0.28 + index * 0.06 },
                        }
                  }
                >
                  <motion.div
                    className={cn(
                      "relative flex h-14 items-center justify-center overflow-hidden rounded-tile border bg-hero sm:h-16",
                      "transition-[border-color,background-color,box-shadow] duration-(--dur-press)",
                      status === "error"
                        ? "border-red bg-red/10"
                        : status === "verifying" || status === "success"
                          ? "border-brand/60"
                          : active
                            ? "border-label-3 shadow-[0_0_0_1px_var(--label-3),0_0_28px_-6px_rgb(91_132_255/0.55)]"
                            : digit
                              ? "border-outline"
                              : "border-separator-opaque",
                    )}
                    animate={status === "verifying" ? { scale: [1, 1.05, 1] } : { scale: 1 }}
                    transition={
                      status === "verifying"
                        ? {
                            duration: 0.9,
                            repeat: Infinity,
                            delay: index * 0.07,
                            ease: "easeInOut",
                          }
                        : { duration: 0.2 }
                    }
                  >
                    <AnimatePresence mode="popLayout" initial={false}>
                      {digit ? (
                        <motion.span
                          key={`${index}-${digit}`}
                          className={cn(
                            "font-mono text-[28px] leading-none font-semibold tabular-nums sm:text-[32px]",
                            status === "error" ? "text-red" : "text-label",
                          )}
                          initial={{ opacity: 0, y: -20, scale: 1.45, filter: "blur(10px)" }}
                          animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                          exit={{ opacity: 0, y: 10, scale: 0.6, filter: "blur(6px)" }}
                          transition={{
                            ...DROP,
                            filter: { duration: 0.22 },
                            opacity: { duration: 0.15 },
                          }}
                        >
                          {digit}
                        </motion.span>
                      ) : null}
                    </AnimatePresence>

                    {active && !digit ? (
                      <motion.span
                        className="absolute h-7 w-[2px] rounded-mark bg-label sm:h-8"
                        animate={{ opacity: [1, 1, 0, 0] }}
                        transition={{ duration: 1.05, repeat: Infinity, times: [0, 0.5, 0.55, 1] }}
                      />
                    ) : null}

                    {status === "verifying" ? (
                      <motion.span
                        className="pointer-events-none absolute inset-y-0 -left-full w-full"
                        style={{
                          background:
                            "linear-gradient(100deg, transparent 20%, rgb(91 132 255 / 0.28) 42%, rgb(255 255 255 / 0.42) 50%, rgb(91 132 255 / 0.28) 58%, transparent 80%)",
                        }}
                        animate={{ x: ["0%", "200%"] }}
                        transition={{
                          duration: 0.9,
                          repeat: Infinity,
                          repeatDelay: 0.35,
                          delay: index * 0.07,
                          ease: "easeInOut",
                        }}
                      />
                    ) : null}
                  </motion.div>

                  {active ? (
                    <motion.span
                      layoutId={caretId}
                      className="absolute inset-x-3 -bottom-[5px] h-[3px] rounded-capsule bg-brand shadow-[0_0_14px_2px_rgb(91_132_255/0.7)]"
                      transition={{ type: "spring", stiffness: 600, damping: 38 }}
                    />
                  ) : null}
                </motion.div>
              );
            })}
          </div>

          <AnimatePresence>
            {status === "success" ? (
              <motion.div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 flex items-center justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { delay: 0.45 } }}
              >
                <motion.span
                  className="absolute size-16 rounded-capsule border border-brand"
                  initial={{ scale: 0.6, opacity: 0.8 }}
                  animate={{ scale: 2.2, opacity: 0 }}
                  transition={{ duration: 0.9, ease: EASE, delay: 0.5 }}
                />
                <motion.span
                  className="flex size-16 items-center justify-center rounded-capsule bg-accent text-on-accent shadow-[0_0_40px_-4px_rgb(91_132_255/0.8)]"
                  initial={{ scale: 0.2 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 420, damping: 18, delay: 0.45 }}
                >
                  <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor">
                    <motion.path
                      d="M5 12.5l4.5 4.5L19 7.5"
                      strokeWidth={2.6}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.35, ease: EASE, delay: 0.62 }}
                    />
                  </svg>
                </motion.span>
              </motion.div>
            ) : null}
          </AnimatePresence>

          {/*
            The real field: full size over the cells and transparent, never hidden, so mobile
            keyboards offer the code from Mail or the clipboard. 16px text keeps iOS from zooming.
          */}
          <input
            ref={inputRef}
            id={inputId}
            name="one-time-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={length}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            enterKeyHint="done"
            value={value}
            readOnly={busy}
            aria-describedby={describedBy}
            aria-invalid={status === "error" || undefined}
            onChange={(event) =>
              commit(event.target.value, event.target.selectionStart ?? event.target.value.length)
            }
            onPaste={onPaste}
            onKeyDown={onKeyDown}
            onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? value.length)}
            onFocus={(event) => {
              setFocused(true);
              const end = event.currentTarget.value.length;
              event.currentTarget.setSelectionRange(end, end);
              setCaret(end);
            }}
            onBlur={() => setFocused(false)}
            onPointerUp={(event) => {
              // A tap lands the caret after the last digit, whatever transparent glyph was hit.
              const end = event.currentTarget.value.length;
              event.currentTarget.setSelectionRange(end, end);
              setCaret(end);
            }}
            className="absolute inset-0 h-full w-full cursor-text rounded-tile border-0 bg-transparent p-0 text-[16px] text-transparent caret-transparent outline-none selection:bg-transparent"
          />
        </div>
      </div>
    </MotionConfig>
  );
}
