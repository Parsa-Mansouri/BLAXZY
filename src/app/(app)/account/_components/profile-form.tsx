"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { callAuth } from "@/lib/auth-call";
import { describeAuthFailure } from "@/lib/auth-errors";
import { Button, Input, useToast } from "@/ui";

/** Profile rows. The name edits in place (Edit, then Save or Cancel); the email is how you sign in. */
export function ProfileForm({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const toast = useToast();
  const [saved, setSaved] = useState(name);
  const [draft, setDraft] = useState(name);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  function startEditing() {
    setDraft(saved);
    setError(undefined);
    setEditing(true);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) {
      setError("Enter your name.");
      return;
    }
    if (trimmed === saved) {
      setEditing(false);
      return;
    }
    setError(undefined);
    setPending(true);
    const result = await callAuth((fetchOptions) =>
      authClient.updateUser({ name: trimmed, fetchOptions }),
    );
    setPending(false);
    if (result.ok) {
      setSaved(trimmed);
      setEditing(false);
      toast.success("Name saved");
      router.refresh();
    } else {
      setError(describeAuthFailure(result.failure, "generic"));
    }
  }

  return (
    <section aria-labelledby="acc-profile" className="flex in-2 flex-col">
      <h2 id="acc-profile" className="mb-4 text-section">
        Profile
      </h2>
      {editing ? (
        <form
          onSubmit={onSubmit}
          noValidate
          className="flex swap-in flex-wrap items-start gap-x-6 gap-y-3 border-t border-separator py-4"
        >
          <label htmlFor="acc-name" className="w-24 shrink-0 pt-2.5 text-secondary text-label-2">
            Name
          </label>
          <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <Input
                id="acc-name"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoComplete="name"
                maxLength={100}
                autoFocus
                aria-invalid={error ? true : undefined}
                className="min-w-0 flex-[1_1_200px]"
              />
              <Button type="submit" variant="primary" size="small" loading={pending}>
                Save
              </Button>
              <Button
                type="button"
                variant="plain"
                size="small"
                onClick={() => setEditing(false)}
                disabled={pending}
              >
                Cancel
              </Button>
            </div>
            {error ? (
              <p role="alert" className="text-secondary text-red">
                {error}
              </p>
            ) : null}
          </div>
        </form>
      ) : (
        <div className="flex min-h-10 swap-in flex-wrap items-center gap-x-6 gap-y-3 border-t border-separator py-4">
          <div className="w-24 shrink-0 text-secondary text-label-2">Name</div>
          <div className="min-w-0 flex-[1_1_200px] text-row font-medium [overflow-wrap:anywhere]">
            {saved}
          </div>
          <Button variant="plain" size="small" onClick={startEditing} aria-label="Edit name">
            Edit
          </Button>
        </div>
      )}
      <div className="flex min-h-10 flex-wrap items-center gap-x-6 gap-y-3 border-y border-separator py-4">
        <div className="w-24 shrink-0 text-secondary text-label-2">Email</div>
        <div className="min-w-0 flex-[1_1_200px] text-row font-medium [overflow-wrap:anywhere]">
          {email}
        </div>
      </div>
    </section>
  );
}
