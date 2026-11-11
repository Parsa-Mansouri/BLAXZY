"use client";

import { useState, useTransition } from "react";
import { Alert, Button, Field, Select, Sheet, useToast } from "@/ui";
import type { GalleryItem } from "../../_components/gallery-item";
import { mergeAssetsAction } from "../actions";

/** Picks two assets of the category, names which one is kept, and merges the other into it. */
export function MergeAssets({
  open,
  onOpenChange,
  projectId,
  items,
  onMerged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  items: GalleryItem[];
  onMerged: () => void;
}) {
  const toast = useToast();
  const [keepId, setKeepId] = useState<string | null>(null);
  const [mergeId, setMergeId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [merging, startMerging] = useTransition();

  const kept = items.find((i) => i.id === keepId) ?? null;
  const merged = items.find((i) => i.id === mergeId) ?? null;
  const options = (exclude: string | null) =>
    items.filter((i) => i.id !== exclude).map((i) => ({ value: i.id, label: i.name }));

  function reset() {
    setKeepId(null);
    setMergeId(null);
    setError(null);
    setConfirming(false);
  }

  function changeOpen(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function review() {
    if (!kept || !merged) {
      setError("Choose the two assets first.");
      return;
    }
    setError(null);
    onOpenChange(false);
    setConfirming(true);
  }

  function confirm() {
    if (!kept || !merged) return;
    setError(null);
    startMerging(async () => {
      const result = await mergeAssetsAction(projectId, kept.id, merged.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(`${merged.name} merged into ${kept.name}.`);
      reset();
      onMerged();
    });
  }

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={changeOpen}
        title="Merge Two Assets"
        description="Use this when the script gives one thing two names. Everything that mentions the second now points to the first."
        footer={
          <>
            <Button variant="plain" onClick={() => changeOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={review}>
              Review Merge
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Keep">
            <Select
              options={options(mergeId)}
              value={keepId}
              onValueChange={(v) => {
                setKeepId(v);
                setError(null);
              }}
              placeholder="Choose an asset"
              size="large"
              aria-label="Asset to keep"
            />
          </Field>
          <Field label="Merge Into It">
            <Select
              options={options(keepId)}
              value={mergeId}
              onValueChange={(v) => {
                setMergeId(v);
                setError(null);
              }}
              placeholder="Choose an asset"
              size="large"
              aria-label="Asset to merge"
            />
          </Field>
          {error ? (
            <p role="alert" className="text-secondary text-red">
              {error}
            </p>
          ) : null}
        </div>
      </Sheet>
      <Alert
        open={confirming}
        onOpenChange={(next) => {
          if (!next) reset();
        }}
        title={kept && merged ? `Merge ${merged.name} Into ${kept.name}?` : "Merge?"}
        message={
          kept && merged
            ? `${kept.name} is kept. ${merged.name} is removed, and its shots point to ${kept.name}.`
            : undefined
        }
        confirmLabel="Merge"
        onConfirm={confirm}
        loading={merging}
        error={error}
      />
    </>
  );
}
