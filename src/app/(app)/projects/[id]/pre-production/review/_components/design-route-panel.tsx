"use client";

import { useState } from "react";
import type { FixSelection } from "@/server/damis";
import type { ClientReviewOption } from "@/lib/review-option";
import { Button, Field, Textarea } from "@/ui";
import { buildDesignChange, type PackKind } from "../../assets/[assetId]/_lib/sheet-review";
import { Caps } from "../../assets/[assetId]/_components/desk";
import { ErrorLine } from "@/app/(app)/_components/values";

/**
 * Sends a locked location pack or prop sheet back to its design step (the owner's LSX01 or
 * ASX01) with the user's words: once locked, its views change only through a new design.
 */
export function DesignRoutePanel({
  kind,
  route,
  maxText,
  sending,
  serverError,
  onSubmit,
  onCancel,
}: {
  kind: PackKind;
  route: ClientReviewOption | null;
  maxText: number;
  sending: boolean;
  serverError: string | null;
  onSubmit: (input: { selections: FixSelection[]; note: string }) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const given = text.trim().length > 0;

  function submit() {
    const built = buildDesignChange(route, text, maxText);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    onSubmit({ selections: built.selections, note: "" });
  }

  return (
    <div className="flex max-w-(--measure) flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-heading-sm text-balance">Change the design</h2>
        <p className="text-secondary text-pretty text-label-2">
          {kind === "location" ? "The location" : "The prop"} goes back to its design step with your
          words. Once you accept the new design, its views are planned again and locked once more.
        </p>
      </div>
      <Field label={<Caps>What should change in the design?</Caps>}>
        <Textarea
          value={text}
          onChange={(e) => {
            setError(null);
            setText(e.target.value);
          }}
          minRows={2}
          maxRows={8}
          disabled={sending}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Button
          variant={given ? "primary" : "dark"}
          size="large"
          loading={sending}
          disabled={!route}
          onClick={submit}
        >
          Change the Design
        </Button>
        <Button variant="plain" size="large" onClick={onCancel} disabled={sending}>
          Cancel
        </Button>
      </div>
      <ErrorLine>{error ?? serverError}</ErrorLine>
    </div>
  );
}
