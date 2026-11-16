"use client";

import { useSpend } from "@/app/(app)/_components/spend-confirm";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import type { LookView } from "@/server/assets";
import { Button, TextLink, Textarea, stagger } from "@/ui";
import { answerQuestionAction } from "../actions";
import { AnswerTiles, QUESTION_TITLE } from "./answer-tiles";
import { StageHeading, useAssetScreen } from "./asset-context";
import { Caps } from "./desk";
import { ErrorLine } from "@/app/(app)/_components/values";
import { formatNumber } from "@/app/(app)/_lib/format";

type Question = NonNullable<LookView["spec"]>["questions"][number];

/** How one question was answered: an offered answer, the user's own words, or "I'm not sure". */
type Reply = { mode: "answer" | "other" | "unsure"; text: string } | null;

/** One of the designer's questions in the guided flow's style. */
function QuestionBlock({
  question,
  reply,
  index,
  disabled,
  onReply,
}: {
  question: Question;
  reply: Reply;
  index: number;
  disabled: boolean;
  onReply: (reply: Reply) => void;
}) {
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const own = reply?.mode === "other";
  const wantFocus = useRef(false);
  useEffect(() => {
    if (!own || !wantFocus.current) return;
    wantFocus.current = false;
    field.current?.focus();
  }, [own]);
  const options = question.options.map((o) => ({ value: o, label: o }));

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex enter flex-col gap-6"
      style={stagger(index, 80)}
    >
      <h3 id={`${id}-title`} className={QUESTION_TITLE}>
        {question.question}
      </h3>
      {options.length > 0 ? (
        <AnswerTiles
          labelledBy={`${id}-title`}
          options={options}
          selected={reply?.mode === "answer" ? reply.text : null}
          disabled={disabled}
          onPick={(value) =>
            onReply(
              reply?.mode === "answer" && reply.text === value
                ? null
                : { mode: "answer", text: value },
            )
          }
        />
      ) : null}
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-body">
        <TextLink
          render={<button type="button" disabled={disabled} />}
          aria-pressed={own}
          onClick={() => {
            if (own) {
              onReply(null);
              return;
            }
            wantFocus.current = true;
            onReply({ mode: "other", text: "" });
          }}
        >
          Not what you have in mind?
        </TextLink>
        <TextLink
          render={<button type="button" disabled={disabled} />}
          aria-pressed={reply?.mode === "unsure"}
          onClick={() => onReply(reply?.mode === "unsure" ? null : { mode: "unsure", text: "" })}
        >
          I’m not sure
        </TextLink>
      </div>
      {own ? (
        <Textarea
          ref={field}
          aria-label="Describe it in your own words"
          placeholder="Describe it in your own words."
          value={reply.text}
          onChange={(e) => onReply({ mode: "other", text: e.target.value })}
          minRows={2}
          maxRows={8}
          textStyle="script"
          disabled={disabled}
          className="swap-in"
        />
      ) : null}
      {reply?.mode === "unsure" ? (
        <p className="swap-in text-secondary text-pretty text-label-2">
          The designer goes with “{question.default}”.
        </p>
      ) : null}
    </section>
  );
}

/**
 * The prop designer stopped to ask something it cannot design without: its question large, in
 * the guided flow's style (offered answers as lettered cards, the user's own words, or "I'm not
 * sure", which takes the designer's default). Answering carries the design on.
 */
export function NeedsAnswerStage({
  projectId,
  assetId,
  assetName,
  look,
  aiDecides,
  maxAnswer,
}: {
  projectId: string;
  assetId: string;
  assetName: string;
  look: LookView;
  aiDecides: string;
  maxAnswer: number;
}) {
  const { moveOn } = useAssetScreen();
  const spend = useSpend();
  const spec = look.spec;
  const all = spec?.questions ?? [];
  const blocking = all.filter((q) => q.blocking);
  const questions = blocking.length > 0 ? blocking : all;
  const [replies, setReplies] = useState<Record<string, Reply>>({});
  const [error, setError] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  const lines = [spec?.summary, ...(spec?.assumptions ?? [])].filter(
    (line): line is string => typeof line === "string" && line.trim().length > 0,
  );

  function send() {
    const answers: Record<string, string> = {};
    for (const q of questions) {
      const reply = replies[q.id];
      const text = reply?.text.trim() ?? "";
      if (!reply || (reply.mode !== "unsure" && !text)) {
        setError(
          reply?.mode === "other"
            ? "Describe it in your own words, or pick an answer."
            : "Choose an answer, or choose I’m not sure.",
        );
        return;
      }
      if (text.length > maxAnswer) {
        setError(`Keep the answer under ${formatNumber(maxAnswer)} characters.`);
        return;
      }
      answers[q.id] = reply.mode === "unsure" ? aiDecides : text;
    }
    setError(null);
    startSending(async () => {
      const result = await spend.run({
        target: { kind: "asset", assetId, step: "look" },
        title: "Create this image?",
        description: `The designer draws ${assetName} with your answer.`,
        confirmLabel: "Create image",
        submit: (expectedCredits) =>
          answerQuestionAction(projectId, look.id, answers, assetId, expectedCredits),
      });
      if (result === null) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      moveOn(result.data, `Designing ${assetName} with your answer`);
    });
  }

  return (
    <div className="@container flex flex-1 flex-col">
      <div className="grid flex-1 gap-x-14 gap-y-10 @5xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <aside className="flex in-1 flex-col gap-5 self-start @5xl:sticky @5xl:top-[calc(var(--toolbar-h)+1.5rem)]">
          <div className="flex flex-col gap-3">
            <Caps>The designer asks</Caps>
            <StageHeading className="text-heading text-balance break-words">
              One question before {assetName} is drawn.
            </StageHeading>
            <p className="max-w-(--measure) text-body text-pretty text-label-2">
              The script does not say, and the answer changes the object itself. Nothing is drawn
              until you answer.
            </p>
          </div>
          {lines.length > 0 ? (
            <ul className="flex max-w-(--measure) flex-col gap-2 border-l-2 border-outline-quiet pl-5">
              {lines.slice(0, 4).map((line) => (
                <li key={line} className="text-secondary text-pretty text-label-2">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
        </aside>

        <div className="flex min-w-0 flex-col gap-12">
          {questions.map((q, i) => (
            <QuestionBlock
              key={q.id}
              question={q}
              index={i}
              reply={replies[q.id] ?? null}
              disabled={sending}
              onReply={(reply) => {
                setError(null);
                setReplies((all) => ({ ...all, [q.id]: reply }));
              }}
            />
          ))}
          <div className="mt-auto flex flex-col items-start gap-3">
            <ErrorLine>{error}</ErrorLine>
            <Button variant="primary" size="large" loading={sending} onClick={send}>
              Continue Designing
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
