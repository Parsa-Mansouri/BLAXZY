"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { callAuth } from "@/lib/auth-call";
import { describeAuthFailure } from "@/lib/auth-errors";
import { Button, GroupedList, GroupedListField, Input } from "@/ui";
import { AuthHeading, AuthLink, AuthLinks } from "../_components/auth-parts";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("Enter an email address such as name@example.com.");
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
      <div className="flex flex-col gap-8">
        <AuthHeading title="Check Your Email">
          If there is an account for <span className="text-label">{email.trim()}</span>, a reset
          link is on its way. It expires in one hour.
        </AuthHeading>
        <div className="flex flex-col gap-3">
          <Button variant="standard" size="large" onClick={() => setDone(false)} className="w-full">
            Use a Different Email
          </Button>
          <Button variant="plain" size="large" render={<Link href="/login" />} className="w-full">
            Back to Sign In
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading title="Reset Password">
        Enter the email for your account to receive a link for choosing a new password.
      </AuthHeading>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <GroupedList size="large">
          <GroupedListField label="Email" required error={error ?? undefined}>
            <Input
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
            />
          </GroupedListField>
        </GroupedList>
        <Button
          type="submit"
          variant="prominent"
          size="large"
          loading={submitting}
          className="mt-2 w-full"
        >
          Send Reset Link
        </Button>
      </form>
      <AuthLinks>
        <AuthLink href="/login">Back to Sign In</AuthLink>
      </AuthLinks>
    </div>
  );
}
