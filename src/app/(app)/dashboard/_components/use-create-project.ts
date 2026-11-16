"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/ui";
import { createProjectAction } from "../actions";

/**
 * Creates a project at once, with no title (Claude names it from the first story), and opens it
 * at its Style stage. Shared by Home, Projects and the sidebar.
 */
export function useCreateProject() {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function create() {
    if (pending) return;
    startTransition(async () => {
      const result = await createProjectAction();
      if (result.ok) {
        router.push(`/projects/${result.id}`);
      } else {
        toast.danger("The project could not be created", result.error);
      }
    });
  }

  return { pending, create };
}
