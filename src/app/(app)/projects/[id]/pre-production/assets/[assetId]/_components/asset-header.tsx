"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ActionMenuButton,
  Alert,
  Button,
  Field,
  Input,
  PageHeader,
  Sheet,
  StatusLine,
  Textarea,
} from "@/ui";
import { removeAssetAction, updateDetailsAction } from "../actions";
import { useAssetScreen } from "./asset-context";
import { type AssetInfo } from "./shared";
import { ErrorLine } from "@/app/(app)/_components/values";
import { formatNumber } from "@/app/(app)/_lib/format";

/** The asset's name (in its own case) as the page title, its state and description, its menu. */
export function AssetHeader({
  projectId,
  asset,
  kindName,
  category,
  busy,
  limits,
}: {
  projectId: string;
  asset: AssetInfo;
  kindName: string;
  category: { href: string; label: string };
  busy: boolean;
  limits: { name: number; description: number };
}) {
  const [dialog, setDialog] = useState<"edit" | "remove" | null>(null);

  return (
    <div data-asset-title className="scroll-mt-[calc(var(--toolbar-h)+1rem)]">
      <PageHeader
        // While the guided questions show, the casting sheet carries the name and description: the
        // title stays for screen readers only (the page's h1) and the menu keeps its place.
        className="group-has-[[data-dossier]]/asset:mb-4 group-has-[[data-dossier]]/asset:justify-end group-has-[[data-dossier]]/asset:[&>div:first-child]:sr-only"
        keepCase
        title={asset.name}
        description={
          <div className="flex flex-col gap-2">
            {asset.removed ? <StatusLine tone="none">{kindName} · Removed</StatusLine> : null}
            {asset.description ? (
              <p className="line-clamp-3 max-w-(--measure) text-body text-pretty text-label-2">
                {asset.description}
              </p>
            ) : null}
          </div>
        }
        actions={
          asset.removed ? undefined : (
            <ActionMenuButton
              label={`Actions for ${asset.name}`}
              variant="outlined"
              size="regular"
              reveal={false}
              actions={[
                [{ id: "edit", label: "Edit Details…", onSelect: () => setDialog("edit") }],
                [
                  {
                    id: "remove",
                    label: "Remove Asset…",
                    destructive: true,
                    disabled: busy,
                    onSelect: () => setDialog("remove"),
                  },
                ],
              ]}
            />
          )
        }
      />

      {dialog === "edit" ? (
        <EditDetailsSheet
          projectId={projectId}
          asset={asset}
          limits={limits}
          onClose={() => setDialog(null)}
        />
      ) : null}
      <RemoveAlert
        open={dialog === "remove"}
        projectId={projectId}
        asset={asset}
        categoryHref={category.href}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}

function EditDetailsSheet({
  projectId,
  asset,
  limits,
  onClose,
}: {
  projectId: string;
  asset: AssetInfo;
  limits: { name: number; description: number };
  onClose: () => void;
}) {
  const { refresh } = useAssetScreen();
  const [name, setName] = useState(asset.name);
  const [description, setDescription] = useState(asset.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Give the asset a name.");
      return;
    }
    if (trimmed.length > limits.name) {
      setNameError(`Keep the name under ${formatNumber(limits.name)} characters.`);
      return;
    }
    if (description.trim().length > limits.description) {
      setError(`Keep the description under ${formatNumber(limits.description)} characters.`);
      return;
    }
    setError(null);
    startSaving(async () => {
      const result = await updateDetailsAction(projectId, asset.id, {
        name: trimmed,
        description: description.trim(),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onClose();
      refresh();
    });
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
      title="Edit Details"
      description="The name and description are used when images and shots are made."
      footer={
        <>
          <Button variant="plain" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Name" error={nameError}>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(null);
            }}
            maxLength={limits.name}
            autoComplete="off"
          />
        </Field>
        <Field label="Description" optional>
          <Textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setError(null);
            }}
            minRows={4}
            maxRows={10}
          />
        </Field>
        <ErrorLine>{error}</ErrorLine>
      </form>
    </Sheet>
  );
}

function RemoveAlert({
  open,
  projectId,
  asset,
  categoryHref,
  onClose,
}: {
  open: boolean;
  projectId: string;
  asset: AssetInfo;
  categoryHref: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [removing, startRemoving] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function remove() {
    setError(null);
    startRemoving(async () => {
      const result = await removeAssetAction(projectId, asset.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(categoryHref);
    });
  }

  return (
    <Alert
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setError(null);
          onClose();
        }
      }}
      title={`Remove “${asset.name}”?`}
      message="It no longer appears in Pre-production. Its images and sheets are kept."
      confirmLabel="Remove"
      onConfirm={remove}
      loading={removing}
      error={error}
    />
  );
}
