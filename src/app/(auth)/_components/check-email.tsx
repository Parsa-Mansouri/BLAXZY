"use client";

import { useEffect, useState } from "react";
import { MailCheck } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { callAuth } from "@/lib/auth-call";
import { describeAuthFailure } from "@/lib/auth-errors";
import { Button, Hint } from "@/ui";
import { FormMessage } from "@/app/_components/form-message";

const RESEND_COOLDOWN_SECONDS = 30;

export interface CheckEmailProps {
  email: string;
  title: string;
  /** One calm sentence under the title. */
  intro: string;
  callbackURL: string;
  onBack: () => void;
  backLabel: string;
}

/** "Check your email" state with a resend button (cooldown so people do not hammer it). */
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
        text: "A new link is on its way. The old one no longer works.",
      });
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } else {
      setMessage({ tone: "error", text: describeAuthFailure(result.failure, "generic") });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <span className="flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent-text [&_svg]:size-6">
          <MailCheck aria-hidden="true" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-fg-muted">
          {intro} We sent a link to <strong className="font-medium text-fg">{email}</strong>. It
          works for one hour.
        </p>
      </div>
      <Hint tone="info">Nothing there? Look in your spam folder, then ask for a new link.</Hint>
      {message ? <FormMessage tone={message.tone}>{message.text}</FormMessage> : null}
      <div className="flex flex-col gap-3">
        <Button variant="secondary" onClick={resend} loading={sending} disabled={cooldown > 0}>
          {cooldown > 0 ? `Send a new link in ${cooldown}s` : "Send a new link"}
        </Button>
        <Button variant="ghost" onClick={onBack}>
          {backLabel}
        </Button>
      </div>
    </div>
  );
}
