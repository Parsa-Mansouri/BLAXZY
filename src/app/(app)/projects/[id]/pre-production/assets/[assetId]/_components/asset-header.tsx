"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Ellipsis } from "lucide-react";
import type { AssetStage } from "@/server/assets";
import {
  Alert,
  Badge,
  Button,
  Field,
  IconButton,
  Input,
  Menu,
  MenuItem,
  MenuSeparator,
  Sheet,
  Textarea,
  type BadgeTone,
} from "@/ui";
import { stageLabel } from "../_lib/asset-view";
import { removeAssetAction, updateDetailsAction } from "../actions";
import { ErrorLine, formatNumber, type AssetInfo } from "./shared";

const TONES: Partial<Record<AssetStage, BadgeTone>> = { ready: "success", failed: "danger" };

/** Back to the category, the asset's name and status, its description and its actions. */
export function AssetHeader({
  projectId,
  asset,
  kindName,
  category,
  stage,
  busy,
  limits,
}: {
  projectId: string;
  asset: AssetInfo;
  kindName: string;
  category: { href: string; label: string };
  stage: AssetStage;
  busy: boolean;
  limits: { name: number; description: number };
}) {
  const [dialog, setDialog] = useState<"edit" | "remove" | null>(null);

  return (
    <header className="flex flex-col gap-4">
      <div>
        <Link
          href={category.href}
          className="-ml-1 inline-flex items-center gap-0.5 rounded-control py-0.5 pr-1.5 text-body text-label-2 focus-ring transition-colors duration-(--dur-fast) hover:text-label"
        >
          <ChevronLeft aria-hidden="true" className="size-(--icon)" />
          {category.label}
        </Link>
      </div>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h2 className="text-large-title text-balance break-words">{asset.name}</h2>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-callout text-label-2">
            <span>{kindName}</span>
            {asset.removed ? (
              <Badge>Removed</Badge>
            ) : (
              <Badge tone={TONES[stage] ?? "neutral"}>{stageLabel(stage)}</Badge>
            )}
          </div>
        </div>
        {asset.removed ? null : (
          <Menu
            align="end"
            trigger={
              <IconButton
                label={`Actions for ${asset.name}`}
                tooltip={false}
                variant="standard"
                size="large"
                icon={<Ellipsis />}
                className="rounded-full"
              />
            }
          >
            <MenuItem onClick={() => setDialog("edit")}>Edit Details…</MenuItem>
            <MenuSeparator />
            <MenuItem destructive disabled={busy} onClick={() => setDialog("remove")}>
              Remove Asset…
            </MenuItem>
          </Menu>
        )}
      </div>
      {asset.description ? (
        <p className="max-w-(--measure) text-reading text-pretty text-label-2">
          {asset.description}
        </p>
      ) : null}

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
    </header>
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
  const router = useRouter();
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
      router.refresh();
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
          <Button variant="prominent" loading={saving} onClick={save}>
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
