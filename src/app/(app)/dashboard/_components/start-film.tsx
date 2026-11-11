"use client";

import type { FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { Spinner, cn } from "@/ui";
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
      <div className="flex items-center gap-4 border-b border-separator-opaque pb-3 focus-within:border-label-2">
        <input
          type="text"
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
          className="min-w-0 flex-1 bg-transparent text-heading-sm font-medium tracking-[-0.02em] text-label outline-none placeholder:text-label-3"
        />
        <button
          type="submit"
          aria-label="Create the project"
          aria-disabled={!ready || pending}
          className={cn(
            "flex size-11 shrink-0 press items-center justify-center rounded-full focus-ring aria-disabled:cursor-default",
            emphasis && ready ? "bg-accent text-on-accent" : "bg-selected text-label",
            !ready && "text-label-2",
          )}
        >
          {pending ? (
            <Spinner label="Creating" />
          ) : (
            <ArrowRight aria-hidden="true" className="size-[18px]" />
          )}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-secondary text-red">
          {error}
        </p>
      ) : null}
    </form>
  );
}
