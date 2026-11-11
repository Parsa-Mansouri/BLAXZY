import { StorageError } from "./errors";
import { fileExtension } from "./sanitize";

const MB = 1024 * 1024;

type PurposeRule = {
  maxBytes: number;
  /** Allowed MIME types and the extensions each may carry. */
  types: Readonly<Record<string, readonly string[]>>;
};

/** What may be stored for each purpose. Add a purpose here before using it. */
export const FILE_PURPOSES = {
  script_document: {
    maxBytes: 10 * MB,
    types: {
      "text/plain": ["txt"],
      "text/markdown": ["md"],
      "text/x-markdown": ["md"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
      "application/pdf": ["pdf"],
    },
  },
  asset_image: {
    maxBytes: 25 * MB,
    types: {
      "image/png": ["png"],
      "image/jpeg": ["jpg", "jpeg"],
      "image/webp": ["webp"],
    },
  },
  /** A look image produced by a generation provider. */
  generated_image: {
    maxBytes: 50 * MB,
    types: {
      "image/png": ["png"],
      "image/jpeg": ["jpg", "jpeg"],
      "image/webp": ["webp"],
    },
  },
  /** An asset sheet (character, prop or location sheet) produced by a generation provider. */
  sheet_image: {
    maxBytes: 50 * MB,
    types: {
      "image/png": ["png"],
      "image/jpeg": ["jpg", "jpeg"],
      "image/webp": ["webp"],
    },
  },
  /** A voice asset's recording, uploaded by the user. */
  asset_audio: {
    maxBytes: 25 * MB,
    types: {
      "audio/mpeg": ["mp3"],
      "audio/mp3": ["mp3"],
      "audio/wav": ["wav"],
      "audio/x-wav": ["wav"],
      "audio/wave": ["wav"],
      "audio/mp4": ["m4a"],
      "audio/x-m4a": ["m4a"],
      "audio/m4a": ["m4a"],
    },
  },
} as const satisfies Record<string, PurposeRule>;

export type FilePurpose = keyof typeof FILE_PURPOSES;

/** `Text/Plain; charset=utf-8` → `text/plain`. */
export function normalizeMimeType(mimeType: string): string {
  return (mimeType.split(";")[0] ?? "").trim().toLowerCase();
}

/**
 * Check a file against its purpose's allowlist (MIME type, matching extension, size).
 * Returns the normalized MIME type; throws `StorageError("invalid_file")`.
 */
export function checkFileAllowed(input: {
  purpose: FilePurpose;
  name: string;
  mimeType: string;
  sizeBytes: number;
}): string {
  const rule: PurposeRule | undefined = FILE_PURPOSES[input.purpose];
  if (!rule) throw new StorageError("invalid_file", `Unknown file purpose "${input.purpose}"`);
  const mimeType = normalizeMimeType(input.mimeType);
  const extensions = rule.types[mimeType];
  if (!extensions) {
    throw new StorageError(
      "invalid_file",
      `Files of type "${mimeType || "unknown"}" are not allowed here`,
    );
  }
  if (!extensions.includes(fileExtension(input.name))) {
    throw new StorageError(
      "invalid_file",
      `The file name must end in ${extensions.map((e) => `.${e}`).join(" or ")}`,
    );
  }
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new StorageError("invalid_file", "The file is empty");
  }
  if (input.sizeBytes > rule.maxBytes) {
    throw new StorageError(
      "invalid_file",
      `The file is too large (maximum ${Math.floor(rule.maxBytes / MB)} MB)`,
    );
  }
  return mimeType;
}
