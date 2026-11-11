"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { callAuth } from "@/lib/auth-call";
import { describeAuthFailure } from "@/lib/auth-errors";
import { Button, stagger } from "@/ui";
import { FormMessage } from "@/app/_components/form-message";
import { AuthPasswordField } from "../_components/auth-fields";
import { AuthScreen } from "../_components/auth-parts";

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
      <AuthScreen
        title={["Password", "Changed"]}
        label="Password changed"
        description="You were signed out on every device. Sign in with the new password."
      >
        <div className="enter" style={stagger(0)}>
          <Button variant="primary" size="large" render={<Link href="/login" />}>
            Sign In
          </Button>
        </div>
      </AuthScreen>
    );
  }

  if (linkBroken) {
    return (
      <AuthScreen
        title={["Link", "Expired"]}
        label="Link expired"
        description="Reset links expire after one hour and work only once. Request a new link and use it straight away."
      >
        <div className="enter" style={stagger(0)}>
          <Button variant="primary" size="large" render={<Link href="/forgot-password" />}>
            Request New Link
          </Button>
        </div>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      title={["Choose a", "New Password"]}
      label="Choose a new password"
      description="Saving signs you out on every device."
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <AuthPasswordField
          label="New Password"
          name="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          error={fieldError}
          hint={`Use at least ${minPasswordLength} characters.`}
          autoFocus
          style={stagger(0)}
        />
        {error ? <FormMessage tone="error">{error}</FormMessage> : null}
        <div className="mt-3 enter" style={stagger(1)}>
          <Button type="submit" variant="primary" size="large" loading={submitting}>
            Save Password
          </Button>
        </div>
      </form>
    </AuthScreen>
  );
}
