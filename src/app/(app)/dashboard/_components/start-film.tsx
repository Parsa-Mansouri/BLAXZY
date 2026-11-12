"use client";

import type { FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { AnimatedPlaceholder, IconButton, Input } from "@/ui";
import { useCreateProject } from "./use-create-project";

/** Working titles the empty field writes, one after another; it rests on the first. */
const EXAMPLE_TITLES = [
  "Give it a working title",
  "The Lighthouse Keeper",
  "Night Ferry",
  "Salt",
  "What the River Took",
] as const;

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
      {/* The overlay stops 60px short of the right edge: the 44px arrow and its 16px gap. */}
      <AnimatedPlaceholder
        lines={EXAMPLE_TITLES}
        empty={title.length === 0}
        variant="line"
        overlayClassName="right-15"
      >
        <Input
          variant="line"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            setError(undefined);
          }}
          aria-label="Name of the new film"
          aria-invalid={error ? true : undefined}
          placeholder={EXAMPLE_TITLES[0]}
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
      </AnimatedPlaceholder>
      {error ? (
        <p role="alert" className="text-secondary text-red">
          {error}
        </p>
      ) : null}
    </form>
  );
}
