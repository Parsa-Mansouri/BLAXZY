"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { callAuth } from "@/lib/auth-call";
import { describeAuthFailure } from "@/lib/auth-errors";
import { PASSWORD_CHANGE_CODE_HEADER } from "@/server/auth/constants";
import { Button, stagger } from "@/ui";
import { FormMessage } from "@/app/_components/form-message";
import { AuthPasswordField } from "@/app/(auth)/_components/auth-fields";
import { CodeEntry, type CodeEntryStatus } from "@/app/(auth)/_components/code-entry";
import { sendPasswordChangeCodeAction } from "../actions";
import { SavedMark } from "./saved-mark";

const RESEND_COOLDOWN_SECONDS = 30;
/** How long a wrong code stays on screen (red, shaking) before the cells clear. */
const ERROR_HOLD_MS = 650;
/** Time for the success fold-into-a-check before the row closes. */
const SUCCESS_HOLD_MS = 1100;
/** Codes after which the current code is dead and only a new one helps. */
const NEEDS_NEW_CODE = new Set(["OTP_EXPIRED", "TOO_MANY_ATTEMPTS"]);
/** Codes that are about the emailed code, not the passwords. */
const CODE_PROBLEMS = new Set(["INVALID_OTP", "OTP_EXPIRED", "TOO_MANY_ATTEMPTS"]);

type Step = "passwords" | "code";

/**
 * Password row: one Change button that opens the two fields in place. Saving emails a six-digit
 * code to the account; the change goes through once that code is entered (it submits itself on
 * the sixth digit).
 */
export function ChangePasswordForm({
  minPasswordLength,
  maxPasswordLength,
  open,
  onOpenChange,
}: {
  minPasswordLength: number;
  maxPasswordLength: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const statusId = useId();
  const [step, setStep] = useState<Step>("passwords");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [currentError, setCurrentError] = useState<string | undefined>();
  const [nextError, setNextError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [changed, setChanged] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  /** A code that passed the code check but met a wrong current password: reused on retry. */
  const [heldCode, setHeldCode] = useState<string | null>(null);
  const [status, setStatus] = useState<CodeEntryStatus>("idle");
  const [errorTick, setErrorTick] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
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

  function close() {
    onOpenChange(false);
    setStep("passwords");
    setCurrent("");
    setNext("");
    setCurrentError(undefined);
    setNextError(undefined);
    setError(null);
    setCode("");
    setHeldCode(null);
    setStatus("idle");
    setNotice(null);
    verifying.current = false;
  }

  async function sendCode(): Promise<boolean> {
    setSending(true);
    const result = await sendPasswordChangeCodeAction();
    setSending(false);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    setSentTo(result.email);
    setCooldown(RESEND_COOLDOWN_SECONDS);
    return true;
  }

  /** Sends the change with `otp`; returns to the password step if a password is the problem. */
  async function change(otp: string) {
    if (verifying.current) return;
    verifying.current = true;
    setStatus("verifying");
    setError(null);
    setNotice(null);
    const result = await callAuth((fetchOptions) =>
      authClient.changePassword({
        currentPassword: current,
        newPassword: next,
        fetchOptions: { ...fetchOptions, headers: { [PASSWORD_CHANGE_CODE_HEADER]: otp } },
      }),
    );
    if (result.ok) {
      setStatus("success");
      later(() => {
        close();
        setChanged(true);
      }, SUCCESS_HOLD_MS);
      return;
    }
    const { failure } = result;
    const codeProblem = failure.code ? CODE_PROBLEMS.has(failure.code) : false;
    if (!codeProblem && step === "code") {
      // The code was right; a password was not. Keep the code for the retry.
      setHeldCode(otp);
      setStep("passwords");
      setStatus("idle");
      verifying.current = false;
      if (failure.code === "INVALID_PASSWORD") {
        setCurrentError(describeAuthFailure(failure, "change-password"));
      } else {
        setError(describeAuthFailure(failure, "change-password"));
      }
      return;
    }
    if (codeProblem) setHeldCode(null);
    if (step === "passwords") {
      // A held code that has since expired: ask for a new one.
      setStep("code");
      setCode("");
      setStatus("idle");
      verifying.current = false;
      setError(describeAuthFailure(failure, "change-password"));
      if (failure.code && NEEDS_NEW_CODE.has(failure.code)) setCooldown(0);
      return;
    }
    setStatus("error");
    setErrorTick((tick) => tick + 1);
    setError(describeAuthFailure(failure, "change-password"));
    if (failure.code && NEEDS_NEW_CODE.has(failure.code)) setCooldown(0);
    later(() => {
      setCode("");
      setStatus("idle");
      verifying.current = false;
    }, ERROR_HOLD_MS);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setCurrentError(current ? undefined : "Enter your current password.");
    let nextProblem: string | undefined;
    if (next.length < minPasswordLength) {
      nextProblem = `Use at least ${minPasswordLength} characters. This has ${next.length}.`;
    } else if (next.length > maxPasswordLength) {
      nextProblem = `Use at most ${maxPasswordLength} characters.`;
    } else if (next === current) {
      nextProblem = "This is the current password. Choose a different one.";
    }
    setNextError(nextProblem);
    if (!current || nextProblem) return;

    if (heldCode) {
      setPending(true);
      await change(heldCode);
      setPending(false);
      return;
    }
    setPending(true);
    const sent = await sendCode();
    setPending(false);
    if (!sent) return;
    setCode("");
    setStatus("idle");
    setStep("code");
  }

  async function resend() {
    setError(null);
    if (await sendCode()) {
      setCode("");
      setNotice("A new code was sent. Codes from earlier emails no longer work.");
    }
  }

  const statusText =
    status === "verifying"
      ? "Checking the code…"
      : status === "success"
        ? "Password changed. Signing out your other devices…"
        : "";

  return (
    <section
      aria-labelledby="acc-password"
      className="flex enter flex-col gap-3"
      style={stagger(0, 380)}
    >
      <h2 id="acc-password" className="text-section">
        Password
      </h2>
      <div className="py-1">
        {open && step === "code" ? (
          <div className="flex max-w-(--form-w) swap-in flex-col gap-5">
            <p className="text-body text-label-2">
              To confirm the change, enter the six-digit code we sent to{" "}
              <span className="text-label">{sentTo}</span>. It expires in 10 minutes.
            </p>
            <CodeEntry
              value={code}
              onChange={setCode}
              onComplete={change}
              status={status}
              errorTick={errorTick}
              describedBy={statusId}
            />
            <p
              id={statusId}
              role="status"
              aria-live="polite"
              className="-mt-2 min-h-[21px] text-callout text-label-3"
            >
              {statusText}
            </p>
            {error ? <FormMessage tone="error">{error}</FormMessage> : null}
            {notice ? <FormMessage tone="success">{notice}</FormMessage> : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outlined"
                size="small"
                onClick={resend}
                loading={sending}
                disabled={cooldown > 0 || status === "verifying" || status === "success"}
                className="tabular-nums"
              >
                {cooldown > 0 ? `Send New Code in ${cooldown}s` : "Send New Code"}
              </Button>
              <Button
                type="button"
                variant="plain"
                size="small"
                onClick={close}
                disabled={status === "verifying" || status === "success"}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : open ? (
          <form
            onSubmit={onSubmit}
            noValidate
            className="flex max-w-(--form-w) swap-in flex-col gap-5"
          >
            <AuthPasswordField
              label="Current Password"
              value={current}
              onChange={setCurrent}
              autoComplete="current-password"
              error={currentError}
              autoFocus
            />
            <AuthPasswordField
              label="New Password"
              value={next}
              onChange={setNext}
              autoComplete="new-password"
              error={nextError}
              hint={`Use at least ${minPasswordLength} characters. We email you a code to confirm the change, and other devices are signed out.`}
            />
            {error ? <FormMessage tone="error">{error}</FormMessage> : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="primary" size="small" loading={pending}>
                {heldCode ? "Save" : "Continue"}
              </Button>
              <Button type="button" variant="plain" size="small" onClick={close} disabled={pending}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex swap-in flex-wrap items-center gap-x-6 gap-y-3">
            <Button
              variant="outlined"
              onClick={() => {
                setChanged(false);
                onOpenChange(true);
              }}
              aria-label="Change Password"
            >
              Change
            </Button>
            {changed ? (
              <SavedMark>Password changed. Other devices were signed out.</SavedMark>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
