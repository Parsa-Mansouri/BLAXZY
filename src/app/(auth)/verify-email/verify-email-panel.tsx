"use client";

import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { callAuth } from "@/lib/auth-call";
import { describeAuthFailure } from "@/lib/auth-errors";
import { Button, GroupedList, GroupedListField, Input } from "@/ui";
import { AuthHeading, AuthLink, AuthLinks } from "../_components/auth-parts";
import { CheckEmail } from "../_components/check-email";

/** Landing page for "your email is not verified": explains it and sends a new link. */
export function VerifyEmailPanel() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("Enter an email address such as name@example.com.");
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
        title="Check Your Email"
        intro="Open the link in the email to confirm your address."
        callbackURL="/dashboard"
        onBack={() => setSentTo(null)}
        backLabel="Use a Different Email"
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading title="Verify Email">
        Confirm your address with the link in the email. To get a new link, enter your email.
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
          Send Link
        </Button>
      </form>
      <AuthLinks>
        <AuthLink href="/login">Back to Sign In</AuthLink>
      </AuthLinks>
    </div>
  );
}
