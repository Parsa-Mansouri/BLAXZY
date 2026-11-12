"use client";

import type { FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { IconButton, Input } from "@/ui";
import { useCreateProject } from "./use-create-project";

/**
 * "Start a New Film": one big underlined title field and a round arrow (Home.dc.html). With
 * `emphasis` (the library is empty) the arrow is the screen's white button.
 */
export function StartFilm({ emphasis = false }: { emphasis?: boolean }) {
  const { title, setTitle, error, setError, pending, ready, create } = useCreateProject();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    create();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <Input
        variant="line"
        value={title}
        onChange={(event) => {
          setTitle(event.target.value);
          setError(undefined);
        }}
        aria-label="Name of the new film"
        aria-invalid={error ? true : undefined}
        placeholder="Give it a working title"
        maxLength={200}
        autoComplete="off"
        trailing={
          <IconButton
            type="submit"
            label="Create the project"
            tooltip={false}
            variant={emphasis ? "primary" : "dark"}
            size="large"
            loading={pending}
            disabled={!ready}
            icon={<ArrowRight aria-hidden="true" strokeWidth={1.5} />}
          />
        }
      />
      {error ? (
        <p role="alert" className="text-secondary text-red">
          {error}
        </p>
      ) : null}
    </form>
  );
}
