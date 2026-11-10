"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { callAuth } from "@/lib/auth-call";
import { describeAuthFailure } from "@/lib/auth-errors";
import { Button, Field, Input, useToast } from "@/ui";

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
      setError("Enter the name you want to be called.");
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
      toast.success("Name updated");
      router.refresh();
    } else {
      setError(describeAuthFailure(result.failure, "generic"));
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <Field label="Name" required error={error}>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="name"
          maxLength={100}
        />
      </Field>
      <Field label="Email" hint="Your email is how you sign in. It cannot be changed here.">
        <Input value={email} readOnly disabled />
      </Field>
      <div>
        <Button type="submit" variant="primary" loading={pending} disabled={value.trim() === saved}>
          Save name
        </Button>
      </div>
    </form>
  );
}
