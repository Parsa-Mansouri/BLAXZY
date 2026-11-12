"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Button, FocusLayout, OptionRow, SelectRow, SwapFade, Textarea, stagger } from "@/ui";
import type { GuidedDraft } from "../_lib/guided-draft";
import { startFromGuidedAction, startFromPromptAction } from "../actions";
import { DrawnTick } from "../../../_components/drawn-tick";
import { ToggleChip } from "../../../_components/toggle-chip";
import { focusIsFree, keepTitleVisible, useAssetScreen } from "./asset-context";
import { ErrorLine, PriceLine, canAfford, formatNumber, type GuidedQuestion } from "./shared";

/**
 * How a question was answered: an offered answer (or, for a text question, written text), "Not what you have in mind?"
 * with the user's own words, or "I'm not sure" with an optional rough idea.
 */
type Mode = "answer" | "other" | "unsure";

/** The draft keeps the mode beside the answer, under `<question id>:mode`. */
const modeKey = (id: string) => `${id}:mode`;

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

/** The answer in a few words, as the list and the prompt show it. */
function answerWords(question: GuidedQuestion, answer: Answer): string {
  const text = answer.text.trim();
  if (answer.mode === "unsure") return text ? `Not sure: ${text}` : "Not sure";
  if (answer.mode === "other") return text || "Something else";
  if (question.kind === "choice") {
    return question.options?.find((o) => o.value === text)?.label ?? text;
  }
  return text;
}

/**
 * The guided questions: the answers on the left (any row opens its question again), one question
 * on the right. Every question offers "I'm not sure", and a choice also "Not what you have in mind?", each with a box
 * for the user's own words. There is no live image preview.
 */
export function GuidedFlow({
  projectId,
  assetId,
  assetName,
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
  const { refresh, shown } = useAssetScreen();
  const id = useId();
  const body = useRef<HTMLDivElement>(null);
  const [answers, setAnswers] = useState<Record<string, string>>(initial?.answers ?? {});
  const [step, setStep] = useState(Math.min(initial?.step ?? 0, questions.length));
  const [error, setError] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  const moved = useRef(false);

  const total = questions.length;
  const onSummary = step >= total;
  const question = onSummary ? null : questions[step];
  const answer: Answer = question ? readAnswer(question, answers) : { mode: null, text: "" };

  // After moving between questions, put focus on the new question's control. The first question
  // takes focus too when the user opened the questions (not when the page was first shown).
  useEffect(() => {
    if (!moved.current && !(shown.current && focusIsFree())) return;
    const root = body.current;
    if (!root) return;
    const target =
      root.querySelector<HTMLElement>('[aria-pressed="true"]') ??
      root.querySelector<HTMLElement>("[data-step-focus], [aria-pressed], textarea");
    target?.focus({ preventScroll: true });
    if (!moved.current) keepTitleVisible();
  }, [step, shown]);

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

  /** Picks "Not what you have in mind?" or "I'm not sure", keeping the words already written for it. */
  function pickFree(mode: "other" | "unsure") {
    if (answer.mode === mode) {
      // A text question's "I'm not sure" toggles back to writing the answer.
      if (question?.kind === "text") set({ mode: "answer", text: "" });
      return;
    }
    set({ mode, text: "" });
  }

  function next() {
    if (!question) return;
    if (!isAnswered(answer) && !question.optional) {
      setError(
        answer.mode === "other"
          ? "Describe it in your own words, or pick another answer."
          : question.kind === "choice"
            ? "Choose an answer, or pick I’m not sure."
            : "Write an answer, or pick I’m not sure.",
      );
      return;
    }
    if (answer.text.trim().length > maxAnswer) {
      setError(`Keep the answer under ${formatNumber(maxAnswer)} characters.`);
      return;
    }
    go(step + 1);
  }

  function skip() {
    if (!question) return;
    const rest = { ...answers };
    delete rest[question.id];
    delete rest[modeKey(question.id)];
    setAnswers(rest);
    go(step + 1, rest);
  }

  function generate() {
    const missing = questions.findIndex((q) => !q.optional && !isAnswered(readAnswer(q, answers)));
    if (missing !== -1) {
      go(missing);
      setError("Answer this one first, or pick I’m not sure.");
      return;
    }
    // The guided answers take an offered answer for a choice question. When a choice was answered
    // in the user's own words ("Not what you have in mind?", "I'm not sure"), the answers go as one written prompt.
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
      refresh();
    });
  }

  const affordable = canAfford(price, balance);
  const freeHint =
    answer.mode === "other"
      ? "Describe it in your own words."
      : "Tell us what you are picturing, even roughly.";

  return (
    <FocusLayout
      listLabel="Your answers"
      fill
      list={questions.map((q, i) => {
        const a = readAnswer(q, answers);
        const done = isAnswered(a);
        return (
          <SelectRow
            key={q.id}
            label={<span className="line-clamp-2">{q.label}</span>}
            value={done ? <span className="line-clamp-2">{answerWords(q, a)}</span> : undefined}
            trailing={
              done ? (
                <>
                  <DrawnTick className="text-label" />
                  <span className="sr-only">, answered</span>
                </>
              ) : undefined
            }
            active={i === step}
            disabled={sending}
            onClick={() => (i === step ? undefined : go(i))}
            className="enter"
            style={stagger(i)}
          />
        );
      })}
    >
      <div ref={body} className="flex flex-1 flex-col gap-12">
        {question ? (
          <SwapFade swapKey={question.id} className="flex flex-1 flex-col gap-7">
            <h2 id={`${id}-title`} className="text-display text-balance break-words">
              {question.label}
            </h2>
            <div className="flex flex-col gap-3">
              {question.kind === "choice" ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-3">
                  {(question.options ?? []).map((option, i) => (
                    <OptionRow
                      key={option.value}
                      selected={answer.mode === "answer" && answer.text === option.value}
                      onSelect={() => set({ mode: "answer", text: option.value })}
                      disabled={sending}
                      className="min-h-16 enter"
                      style={stagger(i, 40)}
                    >
                      {option.label}
                    </OptionRow>
                  ))}
                </div>
              ) : answer.mode !== "unsure" ? (
                <Textarea
                  aria-labelledby={`${id}-title`}
                  aria-invalid={error ? true : undefined}
                  placeholder={question.hint}
                  value={answer.text}
                  onChange={(e) => set({ mode: "answer", text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      next();
                    }
                  }}
                  minRows={3}
                  maxRows={10}
                  textStyle="script"
                  disabled={sending}
                />
              ) : null}
              <div
                className="flex enter flex-wrap gap-2"
                style={stagger(question.options?.length ?? 1, 40)}
              >
                {question.kind === "choice" ? (
                  <ToggleChip
                    on={answer.mode === "other"}
                    onClick={() => pickFree("other")}
                    disabled={sending}
                  >
                    Not what you have in mind?
                  </ToggleChip>
                ) : null}
                <ToggleChip
                  on={answer.mode === "unsure"}
                  onClick={() => pickFree("unsure")}
                  disabled={sending}
                >
                  I’m not sure
                </ToggleChip>
              </div>
              {answer.mode === "other" || answer.mode === "unsure" ? (
                <Textarea
                  aria-label={freeHint}
                  placeholder={freeHint}
                  value={answer.text}
                  onChange={(e) => set({ mode: answer.mode, text: e.target.value })}
                  minRows={3}
                  maxRows={10}
                  textStyle="script"
                  disabled={sending}
                  className="swap-in"
                />
              ) : null}
            </div>
            <div className="mt-auto flex flex-col gap-3 pt-4">
              <ErrorLine>{error}</ErrorLine>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <Button variant="primary" size="large" onClick={next}>
                  Continue
                </Button>
                {question.optional ? (
                  <Button variant="plain" size="large" onClick={skip}>
                    Skip
                  </Button>
                ) : null}
                {step > 0 ? (
                  <Button variant="plain" size="large" onClick={() => go(step - 1)}>
                    Back
                  </Button>
                ) : null}
              </div>
            </div>
          </SwapFade>
        ) : (
          <SwapFade swapKey="done" className="flex flex-1 flex-col gap-7">
            <div className="flex flex-col gap-3">
              <h2
                id={`${id}-title`}
                tabIndex={-1}
                data-step-focus
                className="text-display text-balance break-words outline-none"
              >
                Ready to create {assetName}’s image?
              </h2>
              <p className="max-w-(--measure) text-body text-pretty text-label-2">
                Press any answer in the list to change it before the image is made.
              </p>
            </div>
            <div className="mt-auto flex flex-col gap-3 pt-4">
              <PriceLine price={price} balance={balance} action="image" />
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <Button
                  variant="primary"
                  size="large"
                  loading={sending}
                  disabled={!affordable}
                  onClick={generate}
                >
                  Generate Image
                </Button>
                <Button
                  variant="plain"
                  size="large"
                  onClick={() => go(total - 1)}
                  disabled={sending}
                >
                  Back
                </Button>
              </div>
              <ErrorLine>{error}</ErrorLine>
            </div>
          </SwapFade>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <Button variant="plain" onClick={() => onMethod("prompt")} disabled={sending}>
            Write a Prompt
          </Button>
          <Button variant="plain" onClick={() => onMethod("upload")} disabled={sending}>
            Upload an Image
          </Button>
        </div>
      </div>
    </FocusLayout>
  );
}
