"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Check } from "lucide-react";
import { Button, Hint, ProgressBar, Textarea, cn } from "@/ui";
import type { GuidedDraft } from "../_lib/guided-draft";
import { startFromGuidedAction } from "../actions";
import { focusIsFree, keepTitleVisible, useAssetScreen } from "./asset-context";
import { ErrorLine, PriceLine, canAfford, formatNumber, type GuidedQuestion } from "./shared";

/** One question at a time, then a summary of the answers before the image is generated. */
export function GuidedFlow({
  projectId,
  assetId,
  assetName,
  questions,
  maxAnswer,
  price,
  balance,
  initial,
  onSave,
  onClear,
  onExit,
}: {
  projectId: string;
  assetId: string;
  assetName: string;
  questions: GuidedQuestion[];
  maxAnswer: number;
  price: number | null;
  balance: number;
  initial: GuidedDraft | null;
  onSave: (draft: GuidedDraft) => void;
  onClear: () => void;
  onExit: () => void;
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
  const answer = question ? (answers[question.id] ?? "") : "";

  // After moving between questions, put focus on the new question's control. The first question
  // takes focus too when the user opened the questions (not when the page was first shown).
  useEffect(() => {
    if (!moved.current && !(shown.current && focusIsFree())) return;
    const root = body.current;
    if (!root) return;
    const target =
      root.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ??
      root.querySelector<HTMLElement>('[role="radio"], textarea, [data-step-focus]');
    target?.focus({ preventScroll: true });
    if (!moved.current) keepTitleVisible();
  }, [step, shown]);

  function go(next: number, nextAnswers = answers) {
    moved.current = true;
    setError(null);
    setStep(next);
    onSave({ answers: nextAnswers, step: next });
  }

  function update(value: string) {
    if (!question) return;
    setError(null);
    const next = { ...answers, [question.id]: value };
    setAnswers(next);
    onSave({ answers: next, step });
  }

  function next() {
    if (!question) return;
    const value = answer.trim();
    if (!value && !question.optional) {
      setError(
        question.kind === "choice"
          ? "Choose an answer to continue."
          : "Write an answer to continue. A few words are enough.",
      );
      return;
    }
    if (value.length > maxAnswer) {
      setError(`Keep the answer under ${formatNumber(maxAnswer)} characters.`);
      return;
    }
    go(step + 1);
  }

  function skip() {
    if (!question) return;
    const rest = { ...answers };
    delete rest[question.id];
    setAnswers(rest);
    go(step + 1, rest);
  }

  function back() {
    if (step === 0) onExit();
    else go(step - 1);
  }

  function generate() {
    setError(null);
    const trimmed: Record<string, string> = {};
    for (const q of questions) {
      const value = (answers[q.id] ?? "").trim();
      if (value) trimmed[q.id] = value;
    }
    startSending(async () => {
      const result = await startFromGuidedAction(projectId, assetId, trimmed);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onClear();
      refresh();
    });
  }

  const affordable = canAfford(price, balance);

  return (
    <section aria-labelledby={`${id}-title`} className="flex max-w-2xl flex-col gap-8">
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-callout text-label-2 tabular-nums">
            {onSummary ? "Your Answers" : `${step + 1} of ${total}`}
          </p>
          <Button variant="plain" onClick={onExit} disabled={sending} className="-mr-3">
            Other Ways to Add an Image
          </Button>
        </div>
        <ProgressBar
          value={(Math.min(step, total) / total) * 100}
          aria-label="Questions answered"
          className="max-w-xs"
        />
      </div>

      <div ref={body} className="flex flex-col gap-6">
        {question ? (
          <>
            <div className="flex flex-col gap-1.5">
              <h3 id={`${id}-title`} className="text-title-1 text-balance">
                {question.label}
              </h3>
              {question.kind === "choice" ? (
                <p id={`${id}-hint`} className="text-reading text-pretty text-label-2">
                  {question.hint}
                </p>
              ) : null}
              {question.optional ? <p className="text-callout text-label-2">Optional</p> : null}
            </div>

            {question.kind === "choice" ? (
              <RadioGroup
                aria-labelledby={`${id}-title`}
                aria-describedby={`${id}-hint`}
                value={answer}
                onValueChange={(value) => update(String(value))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    next();
                  }
                }}
                className="flex flex-col"
              >
                {(question.options ?? []).map((option) => (
                  <Radio.Root
                    key={option.value}
                    value={option.value}
                    className={cn(
                      "group relative flex min-h-(--row-h-lg) w-full items-center gap-3 rounded-control px-3 text-left outline-none select-none",
                      "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
                      "before:pointer-events-none before:absolute before:inset-x-3 before:top-0 before:h-(--hairline) before:bg-separator first:before:hidden",
                      "transition-colors duration-(--dur-fast) hover:bg-fill-4",
                      "data-[checked]:bg-selection data-[checked]:before:hidden [&[data-checked]+*]:before:hidden",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-full bg-fill-2 transition-colors duration-(--dur-fast)",
                        "group-data-[checked]:bg-accent group-data-[checked]:text-on-accent",
                      )}
                    >
                      <Check
                        className="size-3 opacity-0 group-data-[checked]:opacity-100"
                        strokeWidth={3}
                      />
                    </span>
                    <span className="text-reading text-label">{option.label}</span>
                  </Radio.Root>
                ))}
              </RadioGroup>
            ) : (
              <Textarea
                aria-labelledby={`${id}-title`}
                aria-describedby={`${id}-hint`}
                aria-invalid={error ? true : undefined}
                value={answer}
                onChange={(e) => update(e.target.value)}
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
            )}

            {question.kind === "text" ? <Hint id={`${id}-hint`}>{question.hint}</Hint> : null}
            <ErrorLine>{error}</ErrorLine>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button variant="prominent" size="large" onClick={next}>
                {step === total - 1 ? "Review Answers" : "Next"}
              </Button>
              <Button size="large" onClick={back}>
                Back
              </Button>
              {question.optional ? (
                <Button variant="plain" size="large" onClick={skip}>
                  Skip
                </Button>
              ) : null}
              {question.kind === "text" ? (
                <span className="hidden text-callout text-label-3 shell:inline">
                  Ctrl or ⌘ Enter for Next
                </span>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <h3
                id={`${id}-title`}
                tabIndex={-1}
                data-step-focus
                className="text-title-1 outline-none"
              >
                Ready to Create {assetName}
              </h3>
              <p className="text-reading text-label-2">
                Check your answers. The image is made from these and the script’s description.
              </p>
            </div>

            <dl className="flex flex-col">
              {questions.map((q, index) => {
                const value = (answers[q.id] ?? "").trim();
                return (
                  <div
                    key={q.id}
                    className="flex items-start gap-4 py-3 hairline-t first:shadow-none"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <dt className="text-callout text-label-2">{q.label}</dt>
                      <dd
                        className={cn(
                          "text-reading break-words whitespace-pre-wrap",
                          value ? "text-label" : "text-label-2",
                        )}
                      >
                        {value || "Skipped"}
                      </dd>
                    </div>
                    <Button
                      variant="plain"
                      onClick={() => go(index)}
                      disabled={sending}
                      aria-label={`Change answer: ${q.label}`}
                      className="-mr-3 shrink-0"
                    >
                      Change
                    </Button>
                  </div>
                );
              })}
            </dl>

            <div className="flex flex-col gap-3 pt-2">
              <PriceLine price={price} balance={balance} action="image" />
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="prominent"
                  size="large"
                  loading={sending}
                  disabled={!affordable}
                  onClick={generate}
                >
                  Generate Image
                </Button>
                <Button size="large" onClick={back} disabled={sending}>
                  Back
                </Button>
              </div>
              <ErrorLine>{error}</ErrorLine>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
