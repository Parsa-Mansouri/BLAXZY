"use client";

import { ChangeRequestBox } from "@/ui";
import type { PackKind } from "../../assets/[assetId]/_lib/sheet-review";

/**
 * Sends a locked location pack or prop sheet back to its design step with the user's words: once
 * locked, its views change only through a new design.
 */
export function DesignRoutePanel({
  kind,
  maxText,
  sending,
  serverError,
  onSubmit,
  onCancel,
}: {
  kind: PackKind;
  maxText: number;
  sending: boolean;
  serverError: string | null;
  onSubmit: (input: { note: string; designChange: true }) => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex max-w-(--measure) flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-heading-sm text-balance">Change the design</h2>
        <p className="text-secondary text-pretty text-label-2">
          {kind === "location" ? "The location" : "The prop"} goes back to its design step with your
          words. Once you accept the new design, its views are planned again and locked once more.
        </p>
      </div>
      <ChangeRequestBox
        maxLength={maxText}
        label="What should change in the design?"
        placeholder={
          kind === "location"
            ? "Make the room smaller, with one tall window and a stone floor."
            : "Make the handle brass instead of silver."
        }
        submitLabel="Change the Design"
        sending={sending}
        serverError={serverError}
        onSubmit={(note) => onSubmit({ note, designChange: true })}
        onCancel={onCancel}
      />
    </div>
  );
}
