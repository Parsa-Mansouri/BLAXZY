"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { callAuth } from "@/lib/auth-call";
import { describeAuthFailure } from "@/lib/auth-errors";
import { Button, Field, Input } from "@/ui";
import { FormMessage } from "@/app/_components/form-message";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("That does not look like an email address. Check for a missing @ or dot.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await callAuth((fetchOptions) =>
      authClient.requestPasswordReset({
        email: email.trim(),
        redirectTo: "/reset-password",
        fetchOptions,
      }),
    );
    setSubmitting(false);
    // Only rate limiting and network problems are shown; the answer never depends on whether
    // the email has an account.
    if (!result.ok && (result.failure.status === 429 || result.failure.status === 0)) {
      setError(describeAuthFailure(result.failure, "generic"));
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <span className="flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent-text [&_svg]:size-6">
            <MailCheck aria-hidden="true" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
          <p className="text-sm text-fg-muted">
            If there is an account for{" "}
            <strong className="font-medium text-fg">{email.trim()}</strong>, a reset link is on its
            way. It works for one hour.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <Button variant="secondary" onClick={() => setDone(false)}>
            Try a different email
          </Button>
          <Button variant="ghost" href="/login">
            Back to sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="text-sm text-fg-muted">
          Enter your email and we will send you a link to choose a new password.
        </p>
      </div>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <Field label="Email" required>
          <Input
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="you@example.com"
            autoFocus
          />
        </Field>
        {error ? <FormMessage tone="error">{error}</FormMessage> : null}
        <Button type="submit" size="lg" loading={submitting}>
          Send reset link
        </Button>
      </form>
      <p className="text-center text-sm text-fg-muted">
        Remembered it?{" "}
        <Link href="/login" className="rounded-xs text-accent-text focus-ring hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
