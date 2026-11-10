"use client";

import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { callAuth } from "@/lib/auth-call";
import { describeAuthFailure } from "@/lib/auth-errors";
import { Button, GroupedList, useToast } from "@/ui";
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
      nextProblem = `Use at least ${minPasswordLength} characters. This has ${next.length}.`;
    } else if (next.length > maxPasswordLength) {
      nextProblem = `Use at most ${maxPasswordLength} characters.`;
    } else if (next === current) {
      nextProblem = "This is the current password. Choose a different one.";
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
      toast.success("Password changed", "Your other devices were signed out.");
    } else if (result.failure.code === "INVALID_PASSWORD") {
      setCurrentError(describeAuthFailure(result.failure, "change-password"));
    } else {
      setError(describeAuthFailure(result.failure, "change-password"));
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <GroupedList
        header="Password"
        footer={`Use at least ${minPasswordLength} characters. Changing the password signs you out on your other devices.`}
      >
        <PasswordField
          label="Current"
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
          error={currentError}
        />
        <PasswordField
          label="New"
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          error={nextError}
        />
      </GroupedList>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
      <div className="flex justify-end">
        <Button type="submit" variant="standard" loading={pending}>
          Change Password
        </Button>
      </div>
    </form>
  );
}
