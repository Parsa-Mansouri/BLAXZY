"use client";

import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, PageHeader, Toolbar } from "@/ui";
import { useCreateProject } from "../../dashboard/_components/use-create-project";

/** New Project (NewProject.dc.html): a big underlined working title, then Create or Cancel. */
export function NewProjectForm() {
  const router = useRouter();
  const { title, setTitle, error, setError, pending, ready, create } = useCreateProject();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    create();
  }

  return (
    <>
      <Toolbar />
      <div className="px-(--content-x) pt-8 pb-18">
        <PageHeader title="New Project" className="mb-16" />
        <form onSubmit={onSubmit} noValidate className="flex max-w-[920px] flex-col">
          <div className="in-1 border-b border-separator-opaque pb-4 focus-within:border-label-2">
            <input
              type="text"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setError(undefined);
              }}
              aria-label="Working title of the new film"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "new-project-error" : "new-project-note"}
              placeholder="Give it a working title"
              maxLength={200}
              autoComplete="off"
              autoFocus
              className="w-full min-w-0 bg-transparent text-[40px] leading-[48px] font-medium tracking-[-0.03em] text-label outline-none placeholder:text-label-3 max-sm:text-heading-sm"
            />
          </div>
          {error ? (
            <p id="new-project-error" role="alert" className="mt-4 text-secondary text-red">
              {error}
            </p>
          ) : (
            <p id="new-project-note" className="mt-4 in-2 text-body text-label-2">
              You choose the style next.
            </p>
          )}
          <div className="mt-10 flex in-3 flex-wrap items-center gap-x-5 gap-y-3">
            <Button
              type="submit"
              variant="primary"
              size="large"
              loading={pending}
              aria-disabled={!ready || undefined}
              className={!ready ? "bg-selected text-label-3 hover:bg-selected" : undefined}
            >
              Create Project
            </Button>
            <Button
              type="button"
              variant="plain"
              size="large"
              onClick={() => router.push("/projects")}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
