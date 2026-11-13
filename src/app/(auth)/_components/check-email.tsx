"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { callAuth } from "@/lib/auth-call";
import { describeAuthFailure } from "@/lib/auth-errors";
import { Button, stagger } from "@/ui";
import { FormMessage } from "@/app/_components/form-message";
import { AuthScreen } from "./auth-parts";

const RESEND_COOLDOWN_SECONDS = 30;

export interface CheckEmailProps {
  email: string;
  /** One string per title line. */
  title: string[];
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
        text: "A new link was sent. Earlier links also work until they expire.",
      });
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } else {
      setMessage({ tone: "error", text: describeAuthFailure(result.failure, "generic") });
    }
  }

  return (
    <AuthScreen
      title={title}
      label="Check your email"
      description={
        <>
          {intro} The link was sent to <span className="text-label">{email}</span> and expires in
          one hour. If it has not arrived, check your spam folder.
        </>
      }
    >
      {message ? <FormMessage tone={message.tone}>{message.text}</FormMessage> : null}
      <div className="flex enter flex-wrap items-center gap-x-4 gap-y-3" style={stagger(0)}>
        <Button
          variant="outlined"
          size="large"
          onClick={resend}
          loading={sending}
          disabled={cooldown > 0}
          className="tabular-nums"
        >
          {cooldown > 0 ? `Send New Link in ${cooldown}s` : "Send New Link"}
        </Button>
        <Button variant="plain" size="large" onClick={onBack}>
          {backLabel}
        </Button>
      </div>
    </AuthScreen>
  );
}
