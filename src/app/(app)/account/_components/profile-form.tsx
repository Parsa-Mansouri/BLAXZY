"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { callAuth } from "@/lib/auth-call";
import { describeAuthFailure } from "@/lib/auth-errors";
import { Button, GroupedList, GroupedListField, GroupedListRow, Input, useToast } from "@/ui";

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState(name);
  const [saved, setSaved] = useState(name);
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Enter your name.");
      return;
    }
    setError(undefined);
    setPending(true);
    const result = await callAuth((fetchOptions) =>
      authClient.updateUser({ name: trimmed, fetchOptions }),
    );
    setPending(false);
    if (result.ok) {
      setValue(trimmed);
      setSaved(trimmed);
      toast.success("Name saved");
      router.refresh();
    } else {
      setError(describeAuthFailure(result.failure, "generic"));
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <GroupedList
        header="Profile"
        footer="Your email address is how you sign in. It cannot be changed here."
      >
        <GroupedListField label="Name" required error={error}>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="name"
            maxLength={100}
          />
        </GroupedListField>
        <GroupedListRow label="Email">{email}</GroupedListRow>
      </GroupedList>
      <div className="flex justify-end">
        <Button
          type="submit"
          variant="standard"
          loading={pending}
          disabled={value.trim() === saved}
        >
          Save
        </Button>
      </div>
    </form>
  );
}
