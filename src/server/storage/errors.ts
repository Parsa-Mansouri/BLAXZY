/**
 * - `invalid_file`: type, extension or size not allowed for the purpose (safe to show the user).
 * - `not_found`: no such file for this user (also used when it belongs to someone else).
 * - `not_uploaded`: confirm was called before the bytes reached the store.
 * - `upload_mismatch`: the stored object differs from what was declared; it was discarded.
 */
export type StorageErrorCode = "invalid_file" | "not_found" | "not_uploaded" | "upload_mismatch";

export class StorageError extends Error {
  constructor(
    readonly code: StorageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StorageError";
  }
}
