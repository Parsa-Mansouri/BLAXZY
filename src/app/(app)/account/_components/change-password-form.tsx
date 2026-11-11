"use client";

import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { callAuth } from "@/lib/auth-call";
import { describeAuthFailure } from "@/lib/auth-errors";
import { Button, stagger, useToast } from "@/ui";
import { FormMessage } from "@/app/_components/form-message";
import { AuthPasswordField } from "@/app/(auth)/_components/auth-fields";

/** Password row: one Change Password button that opens the two fields in place. */
export function ChangePasswordForm({
  minPasswordLength,
  maxPasswordLength,
}: {
  minPasswordLength: number;
  maxPasswordLength: number;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [currentError, setCurrentError] = useState<string | undefined>();
  const [nextError, setNextError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function close() {
    setOpen(false);
    setCurrent("");
    setNext("");
    setCurrentError(undefined);
    setNextError(undefined);
    setError(null);
  }

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
      close();
      toast.success("Password changed", "Your other devices were signed out.");
    } else if (result.failure.code === "INVALID_PASSWORD") {
      setCurrentError(describeAuthFailure(result.failure, "change-password"));
    } else {
      setError(describeAuthFailure(result.failure, "change-password"));
    }
  }

  return (
    <section aria-labelledby="acc-password" className="flex enter flex-col" style={stagger(0, 380)}>
      <h2 id="acc-password" className="mb-4 text-section">
        Password
      </h2>
      <div className="border-y border-separator py-4">
        {open ? (
          <form
            onSubmit={onSubmit}
            noValidate
            className="flex max-w-[400px] swap-in flex-col gap-5"
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
          <Button variant="outlined" onClick={() => setOpen(true)}>
            Change Password
          </Button>
        )}
      </div>
    </section>
  );
}
