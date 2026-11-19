"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { callAuth } from "@/lib/auth-call";
import { describeAuthFailure } from "@/lib/auth-errors";
import { Button, stagger } from "@/ui";
import { FormMessage } from "@/app/_components/form-message";
import { AuthScreen } from "./auth-parts";
import { CodeEntry, type CodeEntryStatus } from "./code-entry";

const RESEND_COOLDOWN_SECONDS = 30;
const CODE_LENGTH = 6;
/** How long a wrong code stays on screen (red, shaking) before the cells clear. */
const ERROR_HOLD_MS = 650;
/** Time for the success fold-into-a-check before leaving the page. */
const SUCCESS_HOLD_MS = 1100;

/** Codes after which the current code is dead and only a new one helps. */
const NEEDS_NEW_CODE = new Set(["OTP_EXPIRED", "TOO_MANY_ATTEMPTS"]);

export interface CheckEmailProps {
  email: string;
  /** One string per title line. */
  title: string[];
  /** One sentence under the title. */
  intro: string;
  /** Where to go once the code is right (the user is signed in by then). */
  callbackURL: string;
  onBack: () => void;
  backLabel: string;
}

/**
 * "Check your email" state: the six-digit verification code goes in here. A right code verifies
 * the address, signs the user in and opens `callbackURL`; a new code can be sent after a cooldown.
 */
export function CheckEmail({
  email,
  title,
  intro,
  callbackURL,
  onBack,
  backLabel,
}: CheckEmailProps) {
  const router = useRouter();
  const statusId = useId();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<CodeEntryStatus>("idle");
  const [errorTick, setErrorTick] = useState(0);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const verifying = useRef(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  function later(run: () => void, ms: number) {
    timers.current.push(window.setTimeout(run, ms));
  }

  async function verify(otp: string) {
    if (verifying.current) return;
    verifying.current = true;
    setStatus("verifying");
    setMessage(null);
    const result = await callAuth((fetchOptions) =>
      authClient.emailOtp.verifyEmail({ email, otp, fetchOptions }),
    );
    if (result.ok) {
      setStatus("success");
      later(() => {
        router.replace(callbackURL);
        router.refresh();
      }, SUCCESS_HOLD_MS);
      return;
    }
    const { failure } = result;
    setStatus("error");
    setErrorTick((tick) => tick + 1);
    setMessage({ tone: "error", text: describeAuthFailure(failure, "generic") });
    if (failure.code && NEEDS_NEW_CODE.has(failure.code)) setCooldown(0);
    later(() => {
      setCode("");
      setStatus("idle");
      verifying.current = false;
    }, ERROR_HOLD_MS);
  }

  async function resend() {
    setSending(true);
    setMessage(null);
    const result = await callAuth((fetchOptions) =>
      authClient.emailOtp.sendVerificationOtp({
        email,
        type: "email-verification",
        fetchOptions,
      }),
    );
    setSending(false);
    if (result.ok) {
      setMessage({
        tone: "success",
        text: "A new code was sent. Codes from earlier emails no longer work.",
      });
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setCode("");
    } else {
      setMessage({ tone: "error", text: describeAuthFailure(result.failure, "generic") });
    }
  }

  const statusText =
    status === "verifying"
      ? "Checking the code…"
      : status === "success"
        ? "Email verified. Signing you in…"
        : "";

  return (
    <AuthScreen
      title={title}
      label="Enter the verification code"
      description={
        <>
          {intro} The code was sent to <span className="text-label">{email}</span> and expires in 10
          minutes. If it has not arrived, check your spam folder.
        </>
      }
    >
      <CodeEntry
        value={code}
        onChange={setCode}
        onComplete={verify}
        status={status}
        errorTick={errorTick}
        length={CODE_LENGTH}
        describedBy={statusId}
      />
      <p
        id={statusId}
        role="status"
        aria-live="polite"
        className="-mt-1 min-h-[21px] text-callout text-label-3"
      >
        {statusText}
      </p>
      {message ? <FormMessage tone={message.tone}>{message.text}</FormMessage> : null}
      <div className="flex enter flex-wrap items-center gap-x-4 gap-y-3" style={stagger(8)}>
        <Button
          variant="outlined"
          size="large"
          onClick={resend}
          loading={sending}
          disabled={cooldown > 0 || status === "verifying" || status === "success"}
          className="tabular-nums"
        >
          {cooldown > 0 ? `Send New Code in ${cooldown}s` : "Send New Code"}
        </Button>
        <Button variant="plain" size="large" onClick={onBack} disabled={status === "success"}>
          {backLabel}
        </Button>
      </div>
    </AuthScreen>
  );
}
