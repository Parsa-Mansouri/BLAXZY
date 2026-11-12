"use client";

import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { callAuth } from "@/lib/auth-call";
import { describeAuthFailure } from "@/lib/auth-errors";
import { Button, stagger } from "@/ui";
import { FormMessage } from "@/app/_components/form-message";
import { AuthPasswordField } from "@/app/(auth)/_components/auth-fields";
import { SavedMark } from "./saved-mark";

/** Password row: one Change button that opens the two fields in place. */
export function ChangePasswordForm({
  minPasswordLength,
  maxPasswordLength,
  open,
  onOpenChange,
}: {
  minPasswordLength: number;
  maxPasswordLength: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [currentError, setCurrentError] = useState<string | undefined>();
  const [nextError, setNextError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [changed, setChanged] = useState(false);

  function close() {
    onOpenChange(false);
    setCurrent("");
    setNext("");
    setCurrentError(undefined);
    setNextError(undefined);
    setError(null);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
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
      close();
      setChanged(true);
    } else if (result.failure.code === "INVALID_PASSWORD") {
      setCurrentError(describeAuthFailure(result.failure, "change-password"));
    } else {
      setError(describeAuthFailure(result.failure, "change-password"));
    }
  }

  return (
    <section
      aria-labelledby="acc-password"
      className="flex enter flex-col gap-3"
      style={stagger(0, 380)}
    >
      <h2 id="acc-password" className="text-section">
        Password
      </h2>
      <div className="py-1">
        {open ? (
          <form
            onSubmit={onSubmit}
            noValidate
            className="flex max-w-(--form-w) swap-in flex-col gap-5"
          >
            <AuthPasswordField
              label="Current Password"
              value={current}
              onChange={setCurrent}
              autoComplete="current-password"
              error={currentError}
              autoFocus
            />
            <AuthPasswordField
              label="New Password"
              value={next}
              onChange={setNext}
              autoComplete="new-password"
              error={nextError}
              hint={`Use at least ${minPasswordLength} characters. Changing the password signs you out on your other devices.`}
            />
            {error ? <FormMessage tone="error">{error}</FormMessage> : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="primary" size="small" loading={pending}>
                Save
              </Button>
              <Button type="button" variant="plain" size="small" onClick={close} disabled={pending}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex swap-in flex-wrap items-center gap-x-6 gap-y-3">
            <Button
              variant="outlined"
              onClick={() => {
                setChanged(false);
                onOpenChange(true);
              }}
              aria-label="Change Password"
            >
              Change
            </Button>
            {changed ? (
              <SavedMark>Password changed. Other devices were signed out.</SavedMark>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
