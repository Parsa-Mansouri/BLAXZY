"use client";

import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { Button, SwapFade, TextLink, Textarea, isTypingTarget, stagger } from "@/ui";
import type { GuidedDraft } from "../_lib/guided-draft";
import { startFromGuidedAction } from "../actions";
import { AnswerTiles, LETTERS, QUESTION_TITLE } from "./answer-tiles";
import { focusIsFree, keepTitleVisible, useAssetScreen } from "./asset-context";
import { CastingDossier } from "./casting-dossier";
import { PriceLine, type GuidedQuestion } from "./shared";
import { ErrorLine } from "@/app/(app)/_components/values";
import { canAfford, formatNumber } from "@/app/(app)/_lib/format";

/**
 * How a question was answered: an offered answer (or, for a text question, written text), "Not
 * what you have in mind?" with the user's own words, or "I'm not sure" (the designer decides).
 * The draft stores them as "answer", "other" and "unsure".
 */
type Mode = "answer" | "other" | "unsure";

/** The draft keeps the mode beside the answer, under `<question id>:mode`. */
const modeKey = (id: string) => `${id}:mode`;

interface Answer {
  mode: Mode | null;
  text: string;
}

/**
 * The answer on file for a question. A question never touched shows the answer the script
 * suggests (`prefill`): an offered one is picked, any other text is the user's own words.
 */
function readAnswer(question: GuidedQuestion, answers: Record<string, string>): Answer {
  const stored = answers[question.id];
  const mode = answers[modeKey(question.id)];
  if (stored === undefined && mode === undefined && question.prefill) {
    const offered = (question.options ?? []).some((o) => o.value === question.prefill);
    return question.kind === "choice" && !offered
      ? { mode: "other", text: question.prefill }
      : { mode: "answer", text: question.prefill };
  }
  const text = stored ?? "";
  if (mode === "unsure") return { mode: "unsure", text: "" };
  if (mode === "other") return { mode: "other", text };
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

/** Advanced questions (the prop's extra detail) may always be left empty. */
const isOptional = (question: GuidedQuestion) =>
  question.optional === true || question.advanced === true;

/** The answer as the casting sheet types it in; null while unanswered. */
function sheetWords(question: GuidedQuestion, answer: Answer): string | null {
  if (!isAnswered(answer)) return null;
  if (answer.mode === "unsure") return "BLAXZY decides";
  const text = answer.text.trim();
  if (answer.mode === "answer" && question.kind === "choice") {
    return question.options?.find((o) => o.value === text)?.label ?? text;
  }
  return text;
}

/** True when a key press belongs to a field, a menu or a dialog rather than to the questions. */
const typingElsewhere = (target: EventTarget | null) =>
  isTypingTarget(target, "input, textarea, select, [role='dialog'], [role='menu']");

/**
 * The guided questions as a casting session: the casting sheet on the leading side (every field a
 * question, any field opens it again), one question on the other, its offered answers as lettered
 * cards (the letter key picks one). Every question also takes the user's own words ("Not what you
 * have in mind?") or "I'm not sure", which leaves it to the designer. The questions the script
 * already answers were dropped by the server; a suggested answer is picked in advance. Optional
 * extra detail (the prop's Advanced block) waits behind "Add more detail" after the last main
 * question, whose main button makes the image.
 */
export function GuidedFlow({
  projectId,
  assetId,
  assetName,
  assetDescription,
  questions,
  aiDecides,
  maxAnswer,
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
  /** The answer that means "I'm not sure". */
  aiDecides: string;
  maxAnswer: number;
  price: number | null;
  balance: number;
  initial: GuidedDraft | null;
  onSave: (draft: GuidedDraft) => void;
  onClear: () => void;
  /** Leaves the questions for another way of adding the image. */
  onMethod: (method: "prompt" | "photos") => void;
}) {
  const { moveOn, shown } = useAssetScreen();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const freeField = useRef<HTMLTextAreaElement>(null);
  const [answers, setAnswers] = useState<Record<string, string>>(initial?.answers ?? {});
  const main = questions.filter((q) => !q.advanced);
  const extra = questions.filter((q) => q.advanced);
  // The extra detail opens when asked for, or when a saved draft already answered some of it.
  const [detailed, setDetailed] = useState(
    main.length === 0 || extra.some((q) => (initial?.answers[q.id] ?? "").trim().length > 0),
  );
  const sequence = detailed ? [...main, ...extra] : main;
  const total = sequence.length;
  // Older drafts may stand past the end (the summary that once followed): open the last question.
  const [step, setStep] = useState(Math.min(initial?.step ?? 0, Math.max(total - 1, 0)));
  const [error, setError] = useState<string | null>(null);
  // The field whose answer was just picked, so the sheet types it in.
  const [typedId, setTypedId] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  const moved = useRef(false);
  const wantFreeFocus = useRef(false);

  const question = sequence[step] ?? null;
  const last = step === total - 1;
  const canAddDetail = !detailed && extra.length > 0 && last;
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

  // "Not what you have in mind?" opens a field: it takes focus when opened.
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

  /** Opens or closes "Not what you have in mind?" (the user's own words). */
  function pickOwnWords() {
    if (answer.mode === "other") {
      set({ mode: null, text: "" });
      return;
    }
    wantFreeFocus.current = true;
    setTypedId(null);
    set({ mode: "other", text: "" });
  }

  /** "I'm not sure": the designer decides. Choosing it again takes it back. */
  function pickUnsure() {
    if (!question) return;
    if (answer.mode === "unsure") {
      set({ mode: question.kind === "text" ? "answer" : null, text: "" });
      return;
    }
    setTypedId(question.id);
    set({ mode: "unsure", text: "" });
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
    if (!isAnswered(answer) && !isOptional(question)) {
      setError(
        answer.mode === "other"
          ? "Describe it in your own words, or pick an answer."
          : question.kind === "choice"
            ? "Choose an answer, or choose I’m not sure."
            : "Write an answer, or choose I’m not sure.",
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

  function addDetail() {
    if (!currentIsValid()) return;
    setDetailed(true);
    go(step + 1);
  }

  function generate() {
    const missing = sequence.findIndex(
      (q) => !isOptional(q) && !isAnswered(readAnswer(q, answers)),
    );
    if (missing !== -1) {
      go(missing);
      setError("Answer this one first, or choose I’m not sure.");
      return;
    }
    // Every answer goes as it is: an offered answer, the user's own words, or "I'm not sure".
    const guided: Record<string, string> = {};
    for (const q of sequence) {
      const a = readAnswer(q, answers);
      if (!isAnswered(a)) continue;
      guided[q.id] = a.mode === "unsure" ? aiDecides : a.text.trim();
    }
    setError(null);
    startSending(async () => {
      const result = await startFromGuidedAction(projectId, assetId, guided);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onClear();
      moveOn(result.data, `Creating ${assetName}’s image`);
    });
  }

  const affordable = canAfford(price, balance);
  const submitOnShortcut = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      next();
    }
  };
  const optional = question ? isOptional(question) : false;

  return (
    <div ref={root} data-dossier className="@container flex flex-1 flex-col">
      <div className="grid flex-1 gap-x-14 gap-y-10 @5xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <CastingDossier
          name={assetName}
          description={assetDescription}
          rows={sequence.map((q) => ({
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
                {question.advanced ? (
                  <p className="font-mono text-meta tracking-caps text-label-2 uppercase">
                    More detail · Optional
                  </p>
                ) : null}
                <h2 id={`${id}-title`} className={QUESTION_TITLE}>
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
                  <AnswerTiles
                    labelledBy={`${id}-title`}
                    options={question.options ?? []}
                    selected={answer.mode === "answer" ? answer.text : null}
                    disabled={sending}
                    onPick={(value) => pick(value, true)}
                  />
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
                ) : (
                  <p className="max-w-(--measure) swap-in text-body text-pretty text-label-2">
                    BLAXZY decides this from the script and the film’s style.
                  </p>
                )}

                <div
                  className="flex enter flex-wrap gap-x-6 gap-y-2 text-body"
                  style={stagger(question.options?.length ?? 1, 40)}
                >
                  {question.kind === "choice" ? (
                    <TextLink
                      render={<button type="button" disabled={sending} />}
                      aria-pressed={answer.mode === "other"}
                      onClick={pickOwnWords}
                    >
                      Not what you have in mind?
                    </TextLink>
                  ) : null}
                  <TextLink
                    render={<button type="button" disabled={sending} />}
                    aria-pressed={answer.mode === "unsure"}
                    onClick={pickUnsure}
                  >
                    I’m not sure
                  </TextLink>
                </div>

                {answer.mode === "other" ? (
                  <Textarea
                    ref={freeField}
                    aria-label="Describe it in your own words"
                    placeholder="Describe it in your own words."
                    value={answer.text}
                    onChange={(e) => set({ mode: "other", text: e.target.value })}
                    onKeyDown={submitOnShortcut}
                    minRows={2}
                    maxRows={10}
                    textStyle="script"
                    disabled={sending}
                    className="swap-in"
                  />
                ) : null}
                {answer.mode === "unsure" && question.kind === "choice" ? (
                  <p className="swap-in text-secondary text-pretty text-label-2">
                    BLAXZY decides this from the script and the film’s style.
                  </p>
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
                {last ? "Generate Image" : optional && !isAnswered(answer) ? "Skip" : "Next"}
              </Button>
              {canAddDetail ? (
                <Button variant="plain" size="large" onClick={addDetail} disabled={sending}>
                  Add More Detail
                </Button>
              ) : null}
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
                  onClick={() => onMethod("photos")}
                >
                  Use photos
                </TextLink>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
