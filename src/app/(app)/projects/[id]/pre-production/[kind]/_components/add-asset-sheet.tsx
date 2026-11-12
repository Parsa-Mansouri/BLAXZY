"use client";

import { useState, useTransition } from "react";
import { Button, Field, Input, Sheet, Textarea, useToast } from "@/ui";
import { ASSET_KIND_LABELS, type AssetKindKey } from "../../../_lib/asset-kinds";
import { addAssetAction } from "../actions";

const MAX_DESCRIPTION = 4000;

/** Adds an asset the detection missed: a name and, optionally, a description. */
export function AddAssetSheet({
  open,
  onOpenChange,
  projectId,
  kind,
  onAdded,
  prefill,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  kind: AssetKindKey;
  onAdded: () => void;
  /** Starting name and description (a thing the detector could not find in the script). */
  prefill?: { name: string; description: string };
}) {
  const toast = useToast();
  const [name, setName] = useState(prefill?.name ?? "");
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const noun = ASSET_KIND_LABELS.find((k) => k.kind === kind)?.one ?? "asset";

  function changeOpen(next: boolean) {
    if (!next) {
      setName("");
      setDescription("");
      setError(null);
    }
    onOpenChange(next);
  }

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give it a name.");
      return;
    }
    setError(null);
    startSaving(async () => {
      const result = await addAssetAction(projectId, kind, { name: trimmed, description });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(`${result.data.name} added.`);
      changeOpen(false);
      onAdded();
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={changeOpen}
      title={`Add ${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun.replace(/^./, (c) => c.toUpperCase())}`}
      description="For something the script mentions and detection missed."
      footer={
        <>
          <Button variant="plain" onClick={() => changeOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={submit}>
            Add
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Name" required error={error}>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            maxLength={200}
            autoComplete="off"
          />
        </Field>
        <Field
          label="Description"
          optional
          hint="What it looks like, or what it does in the story."
        >
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            minRows={3}
            maxRows={6}
            maxLength={MAX_DESCRIPTION}
          />
        </Field>
      </form>
    </Sheet>
  );
}
