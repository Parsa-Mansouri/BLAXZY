"use client";

import { ArrowRight } from "lucide-react";
import { Button } from "@/ui";
import { useCreateProject } from "./use-create-project";

/**
 * "Start a New Film": one button that creates the project and opens its Style stage. With
 * `emphasis` (the library is empty) it is the screen's white button.
 */
export function StartFilm({ emphasis = false }: { emphasis?: boolean }) {
  const { pending, create } = useCreateProject();
  return (
    <Button
      variant={emphasis ? "primary" : "dark"}
      size="large"
      loading={pending}
      onClick={create}
      trailingIcon={<ArrowRight aria-hidden="true" strokeWidth={1.5} />}
    >
      Start a New Film
    </Button>
  );
}
