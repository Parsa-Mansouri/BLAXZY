"use client";

import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { callAuth } from "@/lib/auth-call";
import { describeAuthFailure } from "@/lib/auth-errors";
import { Button, useToast } from "@/ui";
import { FormMessage } from "@/app/_components/form-message";
import { PasswordField } from "@/app/_components/password-field";

export function ChangePasswordForm({
  minPasswordLength,
  maxPasswordLength,
}: {
  minPasswordLength: number;
  maxPasswordLength: number;
}) {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [currentError, setCurrentError] = useState<string | undefined>();
  const [nextError, setNextError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setCurrentError(current ? undefined : "Enter your current password.");
    let nextProblem: string | undefined;
    if (next.length < minPasswordLength) {
      nextProblem = `Your new password needs at least ${minPasswordLength} characters. It has ${next.length}.`;
    } else if (next.length > maxPasswordLength) {
      nextProblem = `Your new password can be at most ${maxPasswordLength} characters. Shorten it.`;
    } else if (next === current) {
      nextProblem = "Your new password is the same as the current one. Choose a different one.";
    }
    setNextError(nextProblem);
    if (!current || nextProblem) return;

    setPending(true);
    const result = await callAuth((fetchOptions) =>
      authClient.changePassword({ currentPassword: current, newPassword: next, fetchOptions }),
    );
    setPending(false);
    if (result.ok) {
      setCurrent("");
      setNext("");
      toast.success("Password changed", "You were signed out on all your other devices.");
    } else if (result.failure.code === "INVALID_PASSWORD") {
      setCurrentError(describeAuthFailure(result.failure, "change-password"));
    } else {
      setError(describeAuthFailure(result.failure, "change-password"));
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <PasswordField
        label="Current password"
        value={current}
        onChange={setCurrent}
        autoComplete="current-password"
        error={currentError}
      />
      <PasswordField
        label="New password"
        value={next}
        onChange={setNext}
        autoComplete="new-password"
        minLength={minPasswordLength}
        error={nextError}
      />
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
      <div>
        <Button type="submit" variant="primary" loading={pending}>
          Change password
        </Button>
      </div>
    </form>
  );
}
