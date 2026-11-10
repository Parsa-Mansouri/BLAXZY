"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Field, Input } from "@/ui";
import { createProjectAction } from "../actions";

const FORM_ID = "new-project-form";

export function NewProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    startTransition(async () => {
      const result = await createProjectAction(title);
      if (result.ok) {
        router.push(`/projects/${result.id}`);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (!next) {
          setTitle("");
          setError(undefined);
        }
        onOpenChange(next);
      }}
      title="Start a project"
      description="Give your film a working title. Next, you will choose its look."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} variant="primary" loading={pending}>
            Create project
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit} noValidate>
        <Field label="Title" required error={error} hint="You can change this any time.">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Midnight in Tabriz"
            maxLength={200}
            autoFocus
            autoComplete="off"
          />
        </Field>
      </form>
    </Dialog>
  );
}
