"use client";

import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, PageHeader, Toolbar } from "@/ui";
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
      <div className="flex flex-1 flex-col px-(--content-x) pt-8 pb-18">
        <PageHeader title="Name Your Film" />
        <form onSubmit={onSubmit} noValidate className="flex flex-1 flex-col">
          <div className="my-auto flex flex-col gap-4 py-10">
            <Input
              variant="line"
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
              className="in-1"
              inputClassName="-ml-[0.04em] text-hero-title tracking-tight"
            />
            {error ? (
              <p id="new-project-error" role="alert" className="text-secondary text-red">
                {error}
              </p>
            ) : (
              <p id="new-project-note" className="in-2 text-body text-label-2">
                You choose the style next.
              </p>
            )}
          </div>
          <div className="flex in-3 flex-wrap items-center gap-x-5 gap-y-3">
            <Button
              type="submit"
              variant="primary"
              size="large"
              loading={pending}
              disabled={!ready}
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
