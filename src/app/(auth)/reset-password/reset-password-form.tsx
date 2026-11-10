"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { callAuth } from "@/lib/auth-call";
import { describeAuthFailure } from "@/lib/auth-errors";
import { Button, GroupedList } from "@/ui";
import { FormMessage } from "@/app/_components/form-message";
import { PasswordField } from "@/app/_components/password-field";
import { AuthHeading } from "../_components/auth-parts";

export function ResetPasswordForm({
  token,
  minPasswordLength,
  maxPasswordLength,
}: {
  /** Null when the link is missing, expired or already used. */
  token: string | null;
  minPasswordLength: number;
  maxPasswordLength: number;
}) {
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [linkBroken, setLinkBroken] = useState(token === null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setError(null);
    if (password.length < minPasswordLength) {
      setFieldError(`Use at least ${minPasswordLength} characters. This has ${password.length}.`);
      return;
    }
    if (password.length > maxPasswordLength) {
      setFieldError(`Use at most ${maxPasswordLength} characters.`);
      return;
    }
    setFieldError(undefined);
    setSubmitting(true);
    const result = await callAuth((fetchOptions) =>
      authClient.resetPassword({ newPassword: password, token, fetchOptions }),
    );
    setSubmitting(false);
    if (result.ok) {
      setDone(true);
    } else if (result.failure.code === "INVALID_TOKEN") {
      setLinkBroken(true);
    } else {
      setError(describeAuthFailure(result.failure, "reset"));
    }
  }

  if (done) {
    return (
      <div className="flex flex-col gap-8">
        <AuthHeading title="Password Changed">
          You were signed out on every device. Sign in with the new password.
        </AuthHeading>
        <Button variant="prominent" size="large" render={<Link href="/login" />} className="w-full">
          Sign In
        </Button>
      </div>
    );
  }

  if (linkBroken) {
    return (
      <div className="flex flex-col gap-8">
        <AuthHeading title="Link Expired">
          Reset links expire after one hour and work only once. Request a new link and use it
          straight away.
        </AuthHeading>
        <Button
          variant="prominent"
          size="large"
          render={<Link href="/forgot-password" />}
          className="w-full"
        >
          Request New Link
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading title="Choose a New Password" />
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <GroupedList
          size="large"
          footer={`Use at least ${minPasswordLength} characters. Saving signs you out on every device.`}
        >
          <PasswordField
            label="New"
            name="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            error={fieldError}
            autoFocus
          />
        </GroupedList>
        {error ? <FormMessage tone="error">{error}</FormMessage> : null}
        <Button
          type="submit"
          variant="prominent"
          size="large"
          loading={submitting}
          className="mt-2 w-full"
        >
          Save Password
        </Button>
      </form>
    </div>
  );
}
