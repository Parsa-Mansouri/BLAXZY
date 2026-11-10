"use client";

import { useState, type FormEvent } from "react";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { callAuth } from "@/lib/auth-call";
import { describeAuthFailure } from "@/lib/auth-errors";
import { Button } from "@/ui";
import { FormMessage } from "@/app/_components/form-message";
import { PasswordField } from "@/app/_components/password-field";

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
      setFieldError(
        `Your password needs at least ${minPasswordLength} characters. It has ${password.length}.`,
      );
      return;
    }
    if (password.length > maxPasswordLength) {
      setFieldError(`Your password can be at most ${maxPasswordLength} characters. Shorten it.`);
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
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <span className="flex size-12 items-center justify-center rounded-full bg-success-soft text-success [&_svg]:size-6">
            <CircleCheck aria-hidden="true" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">Password changed</h1>
          <p className="text-sm text-fg-muted">
            You were signed out everywhere for safety. Sign in with your new password.
          </p>
        </div>
        <Button size="lg" href="/login">
          Go to sign in
        </Button>
      </div>
    );
  }

  if (linkBroken) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <span className="flex size-12 items-center justify-center rounded-full bg-warning-soft text-warning [&_svg]:size-6">
            <TriangleAlert aria-hidden="true" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">This link does not work</h1>
          <p className="text-sm text-fg-muted">
            Reset links expire after one hour and only work once. Ask for a new one and use it
            straight away.
          </p>
        </div>
        <Button size="lg" href="/forgot-password">
          Get a new link
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
        <p className="text-sm text-fg-muted">You will be signed out on all your devices.</p>
      </div>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <PasswordField
          label="New password"
          name="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          minLength={minPasswordLength}
          error={fieldError}
        />
        {error ? <FormMessage tone="error">{error}</FormMessage> : null}
        <Button type="submit" size="lg" loading={submitting}>
          Save new password
        </Button>
      </form>
    </div>
  );
}
