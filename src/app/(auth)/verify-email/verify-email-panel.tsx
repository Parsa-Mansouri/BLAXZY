"use client";

import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { callAuth } from "@/lib/auth-call";
import { describeAuthFailure } from "@/lib/auth-errors";
import { Button, Field, Input } from "@/ui";
import { FormMessage } from "@/app/_components/form-message";
import { CheckEmail } from "../_components/check-email";

/** Landing page for "your email is not verified": explains and lets the user ask for a link. */
export function VerifyEmailPanel() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("That does not look like an email address. Check for a missing @ or dot.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await callAuth((fetchOptions) =>
      authClient.sendVerificationEmail({
        email: email.trim(),
        callbackURL: "/dashboard",
        fetchOptions,
      }),
    );
    setSubmitting(false);
    if (result.ok || (result.failure.status !== 429 && result.failure.status !== 0)) {
      setSentTo(email.trim());
    } else {
      setError(describeAuthFailure(result.failure, "generic"));
    }
  }

  if (sentTo) {
    return (
      <CheckEmail
        email={sentTo}
        title="Check your email"
        intro="Open the link to confirm your address."
        callbackURL="/dashboard"
        onBack={() => setSentTo(null)}
        backLabel="Use a different email"
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Verify your email</h1>
        <p className="text-sm text-fg-muted">
          Confirm your address with the link we email you. Lost it? Enter your email for a new one.
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
          Send a link
        </Button>
        <Button variant="ghost" href="/login">
          Back to sign in
        </Button>
      </form>
    </div>
  );
}
