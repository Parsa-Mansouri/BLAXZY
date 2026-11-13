/**
 * The owner's suggested reason codes for revise mode (dami_script_writer_v0.2.md, section 5).
 * The codes, labels and hints live in `@/lib/script-reasons` (the request-changes sheet imports
 * them there); this module re-exports them and adds the `instruction` the dami receives, stored
 * as the fix request's instruction.
 */
import {
  WRITER_REASON_VIEWS,
  type WriterReasonCode,
  type WriterReasonView,
} from "@/lib/script-reasons";

export {
  isWriterReasonCode,
  issueTypeFor,
  WRITER_PREFERENCE_REASONS,
  WRITER_REASON_CODES,
  WRITER_TECHNICAL_REASONS,
  type WriterReasonCode,
} from "@/lib/script-reasons";

export type WriterReason = Omit<WriterReasonView, "hint"> & {
  /** What the code asks for, in a sentence (stored as the fix request's instruction). */
  instruction: string;
};

export const WRITER_REASONS: readonly WriterReason[] = WRITER_REASON_VIEWS.map(
  ({ code, type, label, hint }) => ({ code, type, label, instruction: hint }),
);

export function writerReason(code: WriterReasonCode): WriterReason {
  return WRITER_REASONS.find((r) => r.code === code) as WriterReason;
}
