"use client";

import { useState, useTransition } from "react";
import { Alert, Button, Field, Input, Sheet, useToast } from "@/ui";
import type { GalleryItem } from "../../_components/gallery-item";
import { removeAssetAction, renameAssetAction } from "../actions";

const MAX_NAME = 200;

/** Renames an asset from its card. The old name is kept, so the script still finds it. */
export function RenameAssetSheet({
  projectId,
  item,
  onClose,
  onDone,
}: {
  projectId: string;
  item: GalleryItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(item.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give it a name.");
      return;
    }
    if (trimmed === item.name) {
      onClose();
      return;
    }
    setError(null);
    startSaving(async () => {
      const result = await renameAssetAction(projectId, item.id, trimmed);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(`Renamed to ${trimmed}.`);
      onClose();
      onDone();
    });
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
      size="sm"
      title="Rename"
      description="The old name is kept too, so the script still points here."
      footer={
        <>
          <Button variant="plain" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            Rename
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Name" error={error}>
          <Input
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            maxLength={MAX_NAME}
            autoComplete="off"
          />
        </Field>
      </form>
    </Sheet>
  );
}

/** Removes an asset from its card, after asking. */
export function RemoveAssetAlert({
  projectId,
  item,
  onClose,
  onDone,
}: {
  projectId: string;
  item: GalleryItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [removing, startRemoving] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function remove() {
    setError(null);
    startRemoving(async () => {
      const result = await removeAssetAction(projectId, item.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(`${item.name} removed.`);
      onClose();
      onDone();
    });
  }

  return (
    <Alert
      open
      onOpenChange={(next) => {
        if (!next && !removing) onClose();
      }}
      title={`Remove “${item.name}”?`}
      message="It no longer appears in Pre-production. Its images and sheets are kept."
      confirmLabel="Remove"
      onConfirm={remove}
      loading={removing}
      error={error}
    />
  );
}
