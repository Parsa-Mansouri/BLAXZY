/**
 * - `invalid_file`: type, extension or size not allowed for the purpose (safe to show the user).
 * - `not_found`: no such file for this user (also used when it belongs to someone else, or when
 *   the upload was abandoned).
 * - `not_uploaded`: confirm was called before the bytes reached the store.
 * - `upload_mismatch`: the stored object differs from what was declared (size, type or content
 *   signature); it was discarded.
 * - `too_many_uploads`: the user has too many unfinished upload tickets (safe to show the user).
 */
export type StorageErrorCode =
  "invalid_file" | "not_found" | "not_uploaded" | "upload_mismatch" | "too_many_uploads";

export class StorageError extends Error {
  constructor(
    readonly code: StorageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StorageError";
  }
}
