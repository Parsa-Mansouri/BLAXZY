/**
 * The upload steps shared by the script, style and asset actions: issue a ticket (the browser
 * then PUTs the bytes straight to storage) and map storage errors on confirmation. Not a
 * `"use server"` file: actions import it.
 */
import { createUpload, StorageError } from "@/server/storage";
import { TOO_MANY_UPLOADS, type ActionResult } from "./action";

export interface UploadTicketData {
  fileId: string;
  uploadUrl: string;
  headers: Record<string, string>;
}

type CreateUploadInput = Parameters<typeof createUpload>[0];

/**
 * Records the file as pending and returns where the browser sends its bytes. A file the purpose
 * does not allow answers `invalidFile`; too many unfinished uploads answers `TOO_MANY_UPLOADS`.
 * Other errors are thrown (the action wrapper logs them).
 */
export async function issueUploadTicket(
  input: CreateUploadInput,
  invalidFile: string,
): Promise<ActionResult<UploadTicketData>> {
  try {
    const ticket = await createUpload(input);
    return {
      ok: true,
      data: { fileId: ticket.fileId, uploadUrl: ticket.uploadUrl, headers: ticket.headers },
    };
  } catch (error) {
    if (error instanceof StorageError) {
      if (error.code === "invalid_file") return { ok: false, error: invalidFile };
      if (error.code === "too_many_uploads") return { ok: false, error: TOO_MANY_UPLOADS };
    }
    throw error;
  }
}

/**
 * For `ActionOptions.mapError` on an action that confirms an upload: any storage error (the
 * bytes never arrived, or differ from what was declared) answers `incomplete`.
 */
export function uploadIncomplete(incomplete: string): (error: unknown) => string | null {
  return (error) => (error instanceof StorageError ? incomplete : null);
}
