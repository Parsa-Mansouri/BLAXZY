"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { callAuth } from "@/lib/auth-call";
import { describeAuthFailure } from "@/lib/auth-errors";
import { Button, stagger } from "@/ui";
import { AuthField } from "../_components/auth-fields";
import { AuthLink, AuthLinks, AuthScreen } from "../_components/auth-parts";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
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
      <AuthScreen
        title={["Check Your", "Email"]}
        label="Check your email"
        description={
          <>
            If there is an account for <span className="text-label">{email.trim()}</span>, a reset
            link is on its way. It expires in one hour.
          </>
        }
      >
        <div className="flex enter flex-wrap items-center gap-x-4 gap-y-3" style={stagger(0)}>
          <Button variant="outlined" size="large" onClick={() => setDone(false)}>
            Use a Different Email
          </Button>
          <Button variant="plain" size="large" render={<Link href="/login" />}>
            Back to Sign In
          </Button>
        </div>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      title={["Reset", "Password"]}
      label="Reset password"
      description="Enter the email for your account to receive a link for choosing a new password."
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <AuthField
          label="Email"
          name="email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          placeholder="you@example.com"
          error={error ?? undefined}
          autoFocus
          style={stagger(0)}
        />
        <div className="mt-3 flex enter flex-col items-start gap-6" style={stagger(1)}>
          <Button type="submit" variant="primary" size="large" loading={submitting}>
            Send Reset Link
          </Button>
          <AuthLinks>
            <AuthLink href="/login">Back to Sign In</AuthLink>
          </AuthLinks>
        </div>
      </form>
    </AuthScreen>
  );
}
