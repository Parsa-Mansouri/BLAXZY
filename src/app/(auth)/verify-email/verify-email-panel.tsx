"use client";

import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { callAuth } from "@/lib/auth-call";
import { describeAuthFailure } from "@/lib/auth-errors";
import { Button, stagger } from "@/ui";
import { AuthField } from "../_components/auth-fields";
import { AuthLink, AuthLinks, AuthScreen } from "../_components/auth-parts";
import { CheckEmail } from "../_components/check-email";

/** Landing page for "your email is not verified": explains it and sends a new code. */
export function VerifyEmailPanel() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

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
      authClient.emailOtp.sendVerificationOtp({
        email: email.trim(),
        type: "email-verification",
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
        title={["Check Your", "Email"]}
        intro="Enter the six-digit code from the email to confirm your address."
        callbackURL="/dashboard"
        onBack={() => setSentTo(null)}
        backLabel="Use a Different Email"
      />
    );
  }

  return (
    <AuthScreen
      title={["Verify", "Email"]}
      label="Verify email"
      description="Confirm your address with a six-digit code. Enter your email and we will send you one."
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
            Send Code
          </Button>
          <AuthLinks>
            <AuthLink href="/login">Back to Sign In</AuthLink>
          </AuthLinks>
        </div>
      </form>
    </AuthScreen>
  );
}
