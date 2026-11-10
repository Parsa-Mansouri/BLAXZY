"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { callAuth } from "@/lib/auth-call";
import { describeAuthFailure } from "@/lib/auth-errors";
import { Button, Hint } from "@/ui";
import { FormMessage } from "@/app/_components/form-message";
import { AuthHeading } from "./auth-parts";

const RESEND_COOLDOWN_SECONDS = 30;

export interface CheckEmailProps {
  email: string;
  title: string;
  /** One sentence under the title. */
  intro: string;
  callbackURL: string;
  onBack: () => void;
  backLabel: string;
}

/** "Check your email" state with a resend button (with a cooldown so it is not pressed twice). */
export function CheckEmail({
  email,
  title,
  intro,
  callbackURL,
  onBack,
  backLabel,
}: CheckEmailProps) {
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function resend() {
    setSending(true);
    setMessage(null);
    const result = await callAuth((fetchOptions) =>
      authClient.sendVerificationEmail({ email, callbackURL, fetchOptions }),
    );
    setSending(false);
    if (result.ok) {
      setMessage({
        tone: "success",
        text: "A new link was sent. The previous link no longer works.",
      });
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } else {
      setMessage({ tone: "error", text: describeAuthFailure(result.failure, "generic") });
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading title={title}>
        {intro} The link was sent to <span className="text-label">{email}</span> and expires in one
        hour.
      </AuthHeading>
      <div className="flex flex-col gap-3">
        {message ? <FormMessage tone={message.tone}>{message.text}</FormMessage> : null}
        <Button
          variant="standard"
          size="large"
          onClick={resend}
          loading={sending}
          disabled={cooldown > 0}
          className="w-full tabular-nums"
        >
          {cooldown > 0 ? `Send New Link in ${cooldown}s` : "Send New Link"}
        </Button>
        <Button variant="plain" size="large" onClick={onBack} className="w-full">
          {backLabel}
        </Button>
      </div>
      <Hint className="text-center">If the email has not arrived, check your spam folder.</Hint>
    </div>
  );
}
