"use client";

import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { Button, SwapFade, TextLink, Textarea, cn, stagger } from "@/ui";
import type { GuidedDraft } from "../_lib/guided-draft";
import { startFromGuidedAction, startFromPromptAction } from "../actions";
import { focusIsFree, keepTitleVisible, useAssetScreen } from "./asset-context";
import { CastingDossier } from "./casting-dossier";
import { ErrorLine, PriceLine, canAfford, formatNumber, type GuidedQuestion } from "./shared";

/**
 * How a question was answered: an offered answer (or, for a text question, written text), "Type it
 * yourself" with the user's own words, or "Skip, let BLAXZY decide" with an optional rough idea.
 * The draft stores them as "answer", "other" and "unsure".
 */
type Mode = "answer" | "other" | "unsure";

/** The draft keeps the mode beside the answer, under `<question id>:mode`. */
const modeKey = (id: string) => `${id}:mode`;

/** The key that picks each offered answer, and the letter on its card. */
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

interface Answer {
  mode: Mode | null;
  text: string;
}

function readAnswer(question: GuidedQuestion, answers: Record<string, string>): Answer {
  const text = answers[question.id] ?? "";
  const stored = answers[modeKey(question.id)];
  if (stored === "other" || stored === "unsure") return { mode: stored, text };
  if (question.kind === "choice") {
    return (question.options ?? []).some((o) => o.value === text)
      ? { mode: "answer", text }
      : { mode: null, text: "" };
  }
  return text.trim() ? { mode: "answer", text } : { mode: null, text: "" };
}

function isAnswered({ mode, text }: Answer): boolean {
  if (mode === "unsure") return true;
  return mode !== null && text.trim().length > 0;
}

/** The answer in a few words, as the prompt gives it to the writer. */
function answerWords(question: GuidedQuestion, answer: Answer): string {
  const text = answer.text.trim();
  if (answer.mode === "unsure") return text ? `Not sure: ${text}` : "Not sure";
  if (answer.mode === "other") return text || "Something else";
  if (question.kind === "choice") {
    return question.options?.find((o) => o.value === text)?.label ?? text;
  }
  return text;
}

/** The answer as the casting sheet types it in; null while unanswered. */
function sheetWords(question: GuidedQuestion, answer: Answer): string | null {
  if (!isAnswered(answer)) return null;
  if (answer.mode === "unsure") {
    const idea = answer.text.trim();
    return idea ? `Roughly: ${idea}` : "BLAXZY decides";
  }
  return answerWords(question, answer);
}

/** True when a key press belongs to a field, a menu or a dialog rather than to the questions. */
function typingElsewhere(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest("input, textarea, select, [role='dialog'], [role='menu']")) return true;
  return false;
}

/**
 * The guided questions as a casting session: the casting sheet on the leading side (every field a
 * question, any field opens it again), one question on the other, its offered answers as lettered
 * cards (the letter key picks one). Every question also takes the user's own words or "let BLAXZY
 * decide" with a rough idea. The last question's main button makes the image. No image preview.
 */
export function GuidedFlow({
  projectId,
  assetId,
  assetName,
  assetDescription,
  questions,
  maxAnswer,
  maxPrompt,
  price,
  balance,
  initial,
  onSave,
  onClear,
  onMethod,
}: {
  projectId: string;
  assetId: string;
  assetName: string;
  /** The script's description of the asset, quoted on the sheet. */
  assetDescription: string | null;
  questions: GuidedQuestion[];
  maxAnswer: number;
  maxPrompt: number;
  price: number | null;
  balance: number;
  initial: GuidedDraft | null;
  onSave: (draft: GuidedDraft) => void;
  onClear: () => void;
  /** Leaves the questions for another way of adding the image. */
  onMethod: (method: "prompt" | "upload") => void;
}) {
  const { moveOn, shown } = useAssetScreen();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const freeField = useRef<HTMLTextAreaElement>(null);
  const [answers, setAnswers] = useState<Record<string, string>>(initial?.answers ?? {});
  const total = questions.length;
  // Older drafts may stand on the summary that followed the last question: open that question.
  const [step, setStep] = useState(Math.min(initial?.step ?? 0, Math.max(total - 1, 0)));
  const [error, setError] = useState<string | null>(null);
  // The field whose answer was just picked, so the sheet types it in.
  const [typedId, setTypedId] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  const moved = useRef(false);
  const wantFreeFocus = useRef(false);

  const question = questions[step] ?? null;
  const last = step === total - 1;
  const answer: Answer = question ? readAnswer(question, answers) : { mode: null, text: "" };

  // After moving between questions, put focus on the new question's control. The first question
  // takes focus too when the user opened the questions (not when the page was first shown).
  useEffect(() => {
    if (!moved.current && !(shown.current && focusIsFree())) return;
    const area = body.current;
    if (!area) return;
    const target =
      area.querySelector<HTMLElement>('[data-option][aria-pressed="true"]') ??
      area.querySelector<HTMLElement>("[data-option], textarea");
    target?.focus({ preventScroll: true });
    if (!moved.current) keepTitleVisible();
  }, [step, shown]);

  // "Type it yourself" and "Skip, let BLAXZY decide" open a field: it takes focus when opened.
  useEffect(() => {
    if (!wantFreeFocus.current) return;
    wantFreeFocus.current = false;
    freeField.current?.focus();
  }, [answer.mode]);

  function save(next: Record<string, string>, nextStep = step) {
    setAnswers(next);
    onSave({ answers: next, step: nextStep });
  }

  function go(next: number, nextAnswers = answers) {
    moved.current = true;
    setError(null);
    setStep(next);
    onSave({ answers: nextAnswers, step: next });
  }

  function set(value: Answer) {
    if (!question) return;
    setError(null);
    const next = { ...answers, [question.id]: value.text };
    if (value.mode === "other" || value.mode === "unsure") next[modeKey(question.id)] = value.mode;
    else delete next[modeKey(question.id)];
    save(next);
  }

  /** Picks one of the offered answers; picking it again takes it back. */
  function pick(value: string, toggle: boolean) {
    if (!question) return;
    if (toggle && answer.mode === "answer" && answer.text === value) {
      set({ mode: null, text: "" });
      return;
    }
    setTypedId(question.id);
    set({ mode: "answer", text: value });
  }

  /** Opens or closes "Type it yourself" or "Skip, let BLAXZY decide". */
  function pickFree(mode: "other" | "unsure") {
    if (answer.mode === mode) {
      set({ mode: question?.kind === "text" ? "answer" : null, text: "" });
      return;
    }
    wantFreeFocus.current = true;
    setTypedId(mode === "unsure" ? (question?.id ?? null) : null);
    set({ mode, text: "" });
  }

  // The letter keys pick an offered answer while focus is on the questions (or nowhere), never
  // while the user types in a field or works in a menu or dialog.
  const letterPick = useRef<(index: number) => void>(() => {});
  useEffect(() => {
    letterPick.current = (index) => {
      const option = question?.kind === "choice" ? question.options?.[index] : undefined;
      if (!option || sending) return;
      pick(option.value, false);
    };
  });
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length !== 1 || typingElsewhere(e.target)) return;
      const active = document.activeElement;
      const inside = root.current?.contains(active) ?? false;
      if (!inside && !focusIsFree()) return;
      const index = LETTERS.indexOf(e.key.toUpperCase());
      if (index === -1) return;
      letterPick.current(index);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  /** Checks the question on screen; says what is missing when it cannot be left yet. */
  function currentIsValid(): boolean {
    if (!question) return false;
    if (!isAnswered(answer) && !question.optional) {
      setError(
        answer.mode === "other"
          ? "Describe it in your own words, or pick another answer."
          : question.kind === "choice"
            ? "Choose an answer, or let BLAXZY decide."
            : "Write an answer, or let BLAXZY decide.",
      );
      return false;
    }
    if (answer.text.trim().length > maxAnswer) {
      setError(`Keep the answer under ${formatNumber(maxAnswer)} characters.`);
      return false;
    }
    return true;
  }

  function next() {
    if (!currentIsValid()) return;
    if (last) generate();
    else go(step + 1);
  }

  function generate() {
    const missing = questions.findIndex((q) => !q.optional && !isAnswered(readAnswer(q, answers)));
    if (missing !== -1) {
      go(missing);
      setError("Answer this one first, or let BLAXZY decide.");
      return;
    }
    // The guided answers take an offered answer for a choice question. When a choice was answered
    // in the user's own words (typed, or left to BLAXZY), the answers go as one written prompt.
    const guided: Record<string, string> = {};
    const lines: string[] = [];
    let ownWords = false;
    for (const q of questions) {
      const a = readAnswer(q, answers);
      if (!isAnswered(a)) continue;
      const words = answerWords(q, a);
      lines.push(`${q.label} ${words}`);
      if (q.kind === "choice" && a.mode !== "answer") ownWords = true;
      guided[q.id] = q.kind === "choice" ? a.text.trim() : words;
    }
    const prompt = lines.join("\n");
    if (ownWords && prompt.length > maxPrompt) {
      setError(
        `Your answers are longer than ${formatNumber(maxPrompt)} characters. Shorten one of them.`,
      );
      return;
    }
    setError(null);
    startSending(async () => {
      const result = ownWords
        ? await startFromPromptAction(projectId, assetId, prompt)
        : await startFromGuidedAction(projectId, assetId, guided);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onClear();
      moveOn(result.data, `Creating ${assetName}’s image`);
    });
  }

  const affordable = canAfford(price, balance);
  const freeHint =
    answer.mode === "other"
      ? "Describe it in your own words."
      : "Any rough idea? BLAXZY fills in the rest.";
  const submitOnShortcut = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      next();
    }
  };

  return (
    <div ref={root} data-dossier className="@container flex flex-1 flex-col">
      <div className="grid flex-1 gap-x-14 gap-y-10 @5xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <CastingDossier
          name={assetName}
          description={assetDescription}
          rows={questions.map((q) => ({
            id: q.id,
            label: q.short,
            value: sheetWords(q, readAnswer(q, answers)),
          }))}
          step={step}
          typedId={typedId}
          disabled={sending}
          onJump={(i) => go(i)}
          className="in-1 self-start @5xl:sticky @5xl:top-[calc(var(--toolbar-h)+1.5rem)]"
        />

        <div ref={body} className="flex min-w-0 flex-col">
          {question ? (
            <SwapFade swapKey={question.id} className="flex flex-col gap-8">
              <div className="flex flex-col gap-3">
                <h2
                  id={`${id}-title`}
                  className="text-display text-balance break-words @5xl:text-[3.75rem] @5xl:leading-[1.04] @5xl:tracking-[-0.03em]"
                >
                  {question.label}
                </h2>
                {question.kind === "choice" ? (
                  <p className="max-w-(--measure) text-body text-pretty text-label-2">
                    {question.hint}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-5">
                {question.kind === "choice" ? (
                  <div
                    role="group"
                    aria-labelledby={`${id}-title`}
                    className="grid grid-cols-1 gap-3 @xl:grid-cols-2"
                  >
                    {(question.options ?? []).map((option, i) => {
                      const selected = answer.mode === "answer" && answer.text === option.value;
                      const letter = LETTERS[i];
                      return (
                        <button
                          key={option.value}
                          type="button"
                          data-option
                          aria-pressed={selected}
                          aria-keyshortcuts={letter}
                          disabled={sending}
                          onClick={() => pick(option.value, true)}
                          className={cn(
                            "flex min-h-20 press enter flex-col justify-between gap-4 rounded-inset border p-4 text-left focus-ring @xl:min-h-28",
                            selected
                              ? "border-brand bg-brand/12"
                              : "border-separator-opaque bg-elevated hover:bg-elevated-2",
                          )}
                          style={stagger(i, 40)}
                        >
                          {letter ? (
                            <span
                              aria-hidden="true"
                              className={cn(
                                "font-script text-meta",
                                selected ? "text-brand" : "text-label-3",
                              )}
                            >
                              {letter}
                            </span>
                          ) : null}
                          <span className="text-control-lg text-pretty text-label">
                            {option.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : answer.mode !== "unsure" ? (
                  <Textarea
                    aria-labelledby={`${id}-title`}
                    aria-invalid={error ? true : undefined}
                    placeholder={question.hint}
                    value={answer.text}
                    onChange={(e) => set({ mode: "answer", text: e.target.value })}
                    onKeyDown={submitOnShortcut}
                    minRows={3}
                    maxRows={10}
                    textStyle="script"
                    disabled={sending}
                  />
                ) : null}

                <div
                  className="flex enter flex-wrap gap-x-6 gap-y-2 text-body"
                  style={stagger(question.options?.length ?? 1, 40)}
                >
                  {question.kind === "choice" ? (
                    <TextLink
                      render={<button type="button" disabled={sending} />}
                      aria-pressed={answer.mode === "other"}
                      onClick={() => pickFree("other")}
                    >
                      Type it yourself
                    </TextLink>
                  ) : null}
                  <TextLink
                    render={<button type="button" disabled={sending} />}
                    aria-pressed={answer.mode === "unsure"}
                    onClick={() => pickFree("unsure")}
                  >
                    Skip, let BLAXZY decide
                  </TextLink>
                </div>

                {answer.mode === "other" || answer.mode === "unsure" ? (
                  <Textarea
                    ref={freeField}
                    aria-label={freeHint}
                    placeholder={freeHint}
                    value={answer.text}
                    onChange={(e) => set({ mode: answer.mode, text: e.target.value })}
                    onKeyDown={submitOnShortcut}
                    minRows={2}
                    maxRows={10}
                    textStyle="script"
                    disabled={sending}
                    className="swap-in"
                  />
                ) : null}
              </div>
            </SwapFade>
          ) : null}

          <div className="mt-auto flex flex-col gap-3 pt-10">
            <ErrorLine>{error}</ErrorLine>
            {last ? <PriceLine price={price} balance={balance} action="image" /> : null}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
              <Button
                variant="primary"
                size="large"
                loading={last && sending}
                pendingLabel="Creating the image"
                disabled={last && !affordable}
                onClick={next}
              >
                {last ? "Generate Image" : "Next"}
              </Button>
              {step > 0 ? (
                <Button
                  variant="plain"
                  size="large"
                  onClick={() => go(step - 1)}
                  disabled={sending}
                >
                  Back
                </Button>
              ) : null}
              <p className="flex flex-wrap items-center gap-x-2 text-secondary text-label-2 @lg:ml-auto">
                <TextLink
                  render={<button type="button" disabled={sending} />}
                  onClick={() => onMethod("prompt")}
                >
                  Write a prompt
                </TextLink>
                <span aria-hidden="true">·</span>
                <TextLink
                  render={<button type="button" disabled={sending} />}
                  onClick={() => onMethod("upload")}
                >
                  Upload an image
                </TextLink>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
