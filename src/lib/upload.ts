/**
 * Browser uploads straight to object storage through a presigned ticket: the XHR PUT, the file
 * checks every picker shares, and the whole create-ticket, PUT, confirm sequence as one call that
 * never throws and always leaves the caller something to show.
 */

/** What the server's create-ticket action returns. */
export type UploadTicket = {
  uploadUrl: string;
  /** Sent exactly as given: some are signed (for example `If-None-Match: *`). */
  headers: Record<string, string>;
  fileId: string;
};

export type StepResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Why a PUT did not complete. `status` is set for an HTTP answer. */
export class UploadError extends Error {
  constructor(
    readonly kind: "network" | "timeout" | "abort" | "http",
    readonly status?: number,
  ) {
    super(`upload ${kind}${status ? ` ${status}` : ""}`);
    this.name = "UploadError";
  }
}

/** Ten minutes: a slow link and a large file, not a hung connection. */
export const DEFAULT_PUT_TIMEOUT_MS = 10 * 60 * 1000;

export type PutOptions = {
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
};

/** PUTs the file to the presigned URL with the ticket's headers, reporting progress. */
export function putFile(
  url: string,
  headers: Record<string, string>,
  file: File,
  { onProgress, signal, timeoutMs = DEFAULT_PUT_TIMEOUT_MS }: PutOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadError("abort"));
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    const done = () => signal?.removeEventListener("abort", onAbort);
    xhr.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.timeout = timeoutMs;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.((event.loaded / event.total) * 100);
    };
    xhr.onload = () => {
      done();
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new UploadError("http", xhr.status));
    };
    xhr.onerror = () => {
      done();
      reject(new UploadError("network"));
    };
    xhr.ontimeout = () => {
      done();
      reject(new UploadError("timeout"));
    };
    xhr.onabort = () => {
      done();
      reject(new UploadError("abort"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    xhr.send(file);
  });
}

/** The file's extension, lower case, without the dot ("" when there is none). */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/** The MIME type for the file's extension in `types`, or "" when it is not allowed. */
export function fileMime(
  file: Pick<File, "name">,
  types: Readonly<Record<string, string>>,
): string {
  return types[fileExtension(file.name)] ?? "";
}

export type FileProblemOptions = {
  /** Allowed extensions (without the dot) to MIME types. */
  types: Readonly<Record<string, string>>;
  maxBytes: number;
  /** The sentences shown for each problem. */
  messages: { type: string; empty: string; size: string };
};

/** Why the file cannot be uploaded (type, empty, too large), or null when it can. */
export function fileProblem(
  file: Pick<File, "name" | "size">,
  { types, maxBytes, messages }: FileProblemOptions,
): string | null {
  if (!types[fileExtension(file.name)]) return messages.type;
  if (file.size === 0) return messages.empty;
  if (file.size > maxBytes) return messages.size;
  return null;
}

export type UploadOutcome<C> =
  { ok: true; fileId: string; confirmed: C } | { ok: false; error: string; aborted?: boolean };

export type UploadViaTicketOptions<C> = {
  createTicket: () => Promise<StepResult<UploadTicket>>;
  file: File;
  /** Runs once the bytes are stored (retried once if it throws, with the same file id). */
  confirm: (fileId: string) => Promise<StepResult<C>>;
  onProgress?: (percent: number) => void;
  /** "uploading" before the PUT, "confirming" after it. */
  onPhase?: (phase: "uploading" | "confirming") => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Shown when the PUT fails; the default suits any picker. */
  uploadFailedMessage?: string;
  /** Replaceable for tests. */
  put?: typeof putFile;
};

const GENERIC_ERROR = "Something went wrong. Check your connection and try again.";
const DEFAULT_UPLOAD_FAILED = "The upload failed. Check your connection and try again.";
const ABORTED = "The upload was cancelled.";

/**
 * Create ticket, PUT, confirm, in that order. Never throws: every step is guarded and the result
 * says what to show. A PUT that fails on the network or a 5xx is tried once more with the same
 * ticket; a 412 (the object already exists, for instance when the first answer was lost) counts
 * as uploaded. The confirm step is retried once with the same file id when it throws. An abort
 * at any point returns `{ ok: false, aborted: true }` without running the next step.
 */
export async function uploadViaTicket<C>(
  opts: UploadViaTicketOptions<C>,
): Promise<UploadOutcome<C>> {
  const { file, signal, onProgress, onPhase } = opts;
  const put = opts.put ?? putFile;
  const aborted = (): UploadOutcome<C> => ({ ok: false, error: ABORTED, aborted: true });
  if (signal?.aborted) return aborted();

  let ticket: StepResult<UploadTicket>;
  try {
    ticket = await opts.createTicket();
  } catch {
    return signal?.aborted ? aborted() : { ok: false, error: GENERIC_ERROR };
  }
  if (signal?.aborted) return aborted();
  if (!ticket.ok) return { ok: false, error: ticket.error };
  const { uploadUrl, headers, fileId } = ticket.data;

  onPhase?.("uploading");
  let stored = false;
  for (let attempt = 0; attempt < 2 && !stored; attempt++) {
    try {
      await put(uploadUrl, headers, file, { onProgress, signal, timeoutMs: opts.timeoutMs });
      stored = true;
    } catch (error) {
      if (signal?.aborted || (error instanceof UploadError && error.kind === "abort")) {
        return aborted();
      }
      if (error instanceof UploadError && error.status === 412) {
        stored = true;
        break;
      }
      const retryable =
        error instanceof UploadError && (error.kind !== "http" || (error.status ?? 0) >= 500);
      if (!retryable || attempt === 1) {
        return { ok: false, error: opts.uploadFailedMessage ?? DEFAULT_UPLOAD_FAILED };
      }
    }
  }

  onPhase?.("confirming");
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) return aborted();
    try {
      const confirmed = await opts.confirm(fileId);
      if (signal?.aborted) return aborted();
      if (!confirmed.ok) return { ok: false, error: confirmed.error };
      return { ok: true, fileId, confirmed: confirmed.data };
    } catch {
      // Tried once more below with the same file id.
    }
  }
  return signal?.aborted ? aborted() : { ok: false, error: GENERIC_ERROR };
}
