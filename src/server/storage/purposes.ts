import { StorageError } from "./errors";
import { fileExtension } from "./sanitize";

const MB = 1024 * 1024;
const GB = 1024 * MB;

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
  /** A screenshot or still the user gives as a reference for the film's look or genre (Style). */
  style_reference: {
    maxBytes: 15 * MB,
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
  /** A video clip (block draft or final) produced by a generation provider. */
  generated_video: {
    maxBytes: 2 * GB,
    types: { "video/mp4": ["mp4"] },
  },
  /** The still shown before a video plays (a frame of a generated clip). */
  video_poster: {
    maxBytes: 10 * MB,
    types: {
      "image/jpeg": ["jpg", "jpeg"],
      "image/png": ["png"],
    },
  },
  /** A keyframe of a generated clip, extracted for the video review (JPEG, about 768 px). */
  review_frame: {
    maxBytes: 5 * MB,
    types: { "image/jpeg": ["jpg", "jpeg"] },
  },
  /**
   * A ZIP of a project's finished clips, written by streaming. `putFileBytes` switches to a
   * multipart upload for large streams, so this may exceed S3's 5 GB single-PUT cap.
   */
  export_zip: {
    maxBytes: 20 * GB,
    types: {
      "application/zip": ["zip"],
      "application/x-zip-compressed": ["zip"],
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

/* -------------------------------------------------------------------------- */
/* Content signatures (magic bytes)                                            */
/* -------------------------------------------------------------------------- */

/** How many leading bytes the signature check reads from an object. */
export const SIGNATURE_SAMPLE_BYTES = 4096;

type SignatureCheck = (sample: Uint8Array, complete: boolean) => boolean;

function startsWith(sample: Uint8Array, bytes: readonly number[], offset = 0): boolean {
  return bytes.every((byte, i) => sample[offset + i] === byte);
}

const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

const isPng: SignatureCheck = (s) => startsWith(s, [0x89, 0x50, 0x4e, 0x47]);
const isJpeg: SignatureCheck = (s) => startsWith(s, [0xff, 0xd8, 0xff]);
const isWebp: SignatureCheck = (s) =>
  startsWith(s, ascii("RIFF")) && startsWith(s, ascii("WEBP"), 8);
const isWav: SignatureCheck = (s) =>
  startsWith(s, ascii("RIFF")) && startsWith(s, ascii("WAVE"), 8);
/** ISO base media (MP4, M4A): a `ftyp` box right after its 4-byte size. */
const isIsoBaseMedia: SignatureCheck = (s) => startsWith(s, ascii("ftyp"), 4);
const isMp3: SignatureCheck = (s) =>
  startsWith(s, ascii("ID3")) || (s[0] === 0xff && ((s[1] ?? 0) & 0xe0) === 0xe0);
const isPdf: SignatureCheck = (s) => {
  const head = s.subarray(0, 1024);
  const needle = ascii("%PDF-");
  for (let i = 0; i + needle.length <= head.length; i++)
    if (startsWith(head, needle, i)) return true;
  return false;
};
/** A local file header (`PK\x03\x04`). */
const isZipArchive: SignatureCheck = (s) => startsWith(s, [0x50, 0x4b, 0x03, 0x04]);
/** The exports bundle may legitimately be an empty archive (`PK\x05\x06`). */
const isZipOrEmptyZip: SignatureCheck = (s) =>
  isZipArchive(s, true) || startsWith(s, [0x50, 0x4b, 0x05, 0x06]);
/** No NUL bytes and valid UTF-8 (a character cut off by the end of the sample is tolerated). */
const isUtf8Text: SignatureCheck = (s, complete) => {
  if (s.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(s, { stream: !complete });
    return true;
  } catch {
    return false;
  }
};

/** One check per allowed MIME type; `purposes.test.ts` asserts every allowed type has one. */
export const CONTENT_SIGNATURES: Readonly<Record<string, SignatureCheck>> = {
  "text/plain": isUtf8Text,
  "text/markdown": isUtf8Text,
  "text/x-markdown": isUtf8Text,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": isZipArchive,
  "application/pdf": isPdf,
  "image/png": isPng,
  "image/jpeg": isJpeg,
  "image/webp": isWebp,
  "video/mp4": isIsoBaseMedia,
  "application/zip": isZipOrEmptyZip,
  "application/x-zip-compressed": isZipOrEmptyZip,
  "audio/mpeg": isMp3,
  "audio/mp3": isMp3,
  "audio/wav": isWav,
  "audio/x-wav": isWav,
  "audio/wave": isWav,
  "audio/mp4": isIsoBaseMedia,
  "audio/x-m4a": isIsoBaseMedia,
  "audio/m4a": isIsoBaseMedia,
};

/**
 * Whether the leading bytes of a file fit its (normalized) MIME type. `complete` says the sample
 * is the whole file (matters for UTF-8 text cut mid-character). Unknown types never match.
 */
export function matchesContentSignature(
  mimeType: string,
  sample: Uint8Array,
  complete: boolean,
): boolean {
  const check = CONTENT_SIGNATURES[normalizeMimeType(mimeType)];
  return check ? check(sample, complete) : false;
}
