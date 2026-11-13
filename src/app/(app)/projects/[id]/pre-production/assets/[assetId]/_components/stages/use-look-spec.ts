"use client";

import { useState } from "react";
import type { LookReviewInput } from "../../actions";
import { EMPTY_SPEC_DRAFT, type SpecDraft } from "../spec-card";
import type { useReview } from "./use-review";

/** The spec card's draft on a look under review, and what it adds to a rejection. */
export function useLookSpec(
  review: ReturnType<typeof useReview>,
  target: { kind: "look"; id: string },
) {
  const [spec, setSpec] = useState<SpecDraft>(EMPTY_SPEC_DRAFT);
  const [specErrorLocal, setSpecError] = useState<string | null>(null);

  /** What the spec card adds to a rejection: changed values and answers. */
  function specInput(): Pick<LookReviewInput, "specEdits" | "clarifyAnswers"> {
    const edits = Object.entries(spec.edits).map(([field, value]) => ({
      field,
      value: value.trim(),
    }));
    return {
      ...(edits.length > 0 ? { specEdits: edits } : {}),
      ...(Object.keys(spec.clarify).length > 0 ? { clarifyAnswers: spec.clarify } : {}),
    };
  }

  function sendSpec() {
    const blank = Object.entries(spec.edits).find(([, value]) => !value.trim());
    if (blank) {
      setSpecError("Write the new value, or undo the change.");
      return;
    }
    setSpecError(null);
    review.run(target, { decision: "rejected", ...specInput() }, "spec");
  }

  function changeSpec(next: SpecDraft) {
    setSpecError(null);
    setSpec(next);
  }

  return { spec, specErrorLocal, specInput, sendSpec, changeSpec };
}
