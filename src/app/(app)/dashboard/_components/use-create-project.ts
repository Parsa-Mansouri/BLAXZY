"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProjectAction } from "../actions";

/** Creates a project from a working title, then opens it. Shared by Home and New Project. */
export function useCreateProject() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  const ready = title.trim().length > 0;

  function create() {
    if (!ready || pending) return;
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

  return { title, setTitle, error, setError, pending, ready, create };
}
