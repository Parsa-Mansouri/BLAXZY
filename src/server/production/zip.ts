/**
 * A minimal ZIP writer for stored (uncompressed) entries, written as a stream. MP4s do not
 * compress, so storing them keeps the work to copying bytes, and every entry's size is known up
 * front: the archive's exact length is computed before a byte is written (an upload needs it).
 *
 * Each entry's CRC-32 is needed in its local header, before its data. It is computed by a first
 * streaming pass over the entry (`crc32Of`), so the archive itself is written in one pass with no
 * data descriptors (readable by every unzip tool) and never held in memory.
 *
 * Classic ZIP only (no ZIP64): at most 65,535 entries and 4 GiB - 1 in total.
 */
import { Readable } from "node:stream";
import { crc32 } from "node:zlib";

export type StoredEntry = {
  /** Path inside the archive (UTF-8). */
  name: string;
  /** Exact byte length of the data. */
  size: number;
  /** CRC-32 of the data. */
  crc: number;
  /** Opens the data (bytes in memory for small entries, a stream for large ones). */
  open: () => Promise<Readable | Uint8Array>;
};

export const ZIP_MAX_BYTES = 0xffff_ffff;
export const ZIP_MAX_ENTRIES = 0xffff;

const LOCAL_HEADER = 30;
const CENTRAL_HEADER = 46;
const END_RECORD = 22;
/** Bit 11: names are UTF-8. */
const FLAG_UTF8 = 0x0800;

export class ZipLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipLimitError";
  }
}

/** The archive's exact size for these entries (names in UTF-8). */
export function storedZipSize(entries: readonly { name: string; size: number }[]): number {
  let total = END_RECORD;
  for (const entry of entries) {
    const nameLength = Buffer.byteLength(entry.name, "utf8");
    total += LOCAL_HEADER + nameLength + entry.size + CENTRAL_HEADER + nameLength;
  }
  return total;
}

/** Throws `ZipLimitError` when the entries do not fit a classic ZIP. */
export function assertZipFits(entries: readonly { name: string; size: number }[]): number {
  if (entries.length > ZIP_MAX_ENTRIES) {
    throw new ZipLimitError(`A ZIP holds at most ${ZIP_MAX_ENTRIES} files.`);
  }
  const size = storedZipSize(entries);
  if (size > ZIP_MAX_BYTES) throw new ZipLimitError("The ZIP would be larger than 4 GB.");
  return size;
}

/** CRC-32 of a stream or bytes, streaming (constant memory). */
export async function crc32Of(
  source: Readable | Uint8Array,
): Promise<{ crc: number; size: number }> {
  if (source instanceof Uint8Array) return { crc: crc32(source), size: source.byteLength };
  let crc = 0;
  let size = 0;
  for await (const chunk of source) {
    const bytes = chunk as Uint8Array;
    crc = crc32(bytes, crc);
    size += bytes.byteLength;
  }
  return { crc, size };
}

/** MS-DOS time and date of a moment (local fields of UTC, as most tools do for UTC servers). */
function dosDateTime(at: Date): { time: number; date: number } {
  const year = Math.max(1980, at.getUTCFullYear());
  return {
    time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | Math.floor(at.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
  };
}

function localHeader(name: Buffer, entry: StoredEntry, stamp: { time: number; date: number }) {
  const header = Buffer.alloc(LOCAL_HEADER);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(10, 4); // version needed: 1.0 (stored)
  header.writeUInt16LE(FLAG_UTF8, 6);
  header.writeUInt16LE(0, 8); // method: stored
  header.writeUInt16LE(stamp.time, 10);
  header.writeUInt16LE(stamp.date, 12);
  header.writeUInt32LE(entry.crc >>> 0, 14);
  header.writeUInt32LE(entry.size, 18);
  header.writeUInt32LE(entry.size, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28); // extra length
  return Buffer.concat([header, name]);
}

function centralHeader(
  name: Buffer,
  entry: StoredEntry,
  offset: number,
  stamp: { time: number; date: number },
) {
  const header = Buffer.alloc(CENTRAL_HEADER);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix, 2.0
  header.writeUInt16LE(10, 6);
  header.writeUInt16LE(FLAG_UTF8, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(stamp.time, 12);
  header.writeUInt16LE(stamp.date, 14);
  header.writeUInt32LE(entry.crc >>> 0, 16);
  header.writeUInt32LE(entry.size, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30); // extra
  header.writeUInt16LE(0, 32); // comment
  header.writeUInt16LE(0, 34); // disk
  header.writeUInt16LE(0, 36); // internal attributes
  header.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external: a regular file, rw-r--r--
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, name]);
}

/**
 * The archive as a stream of exactly `storedZipSize(entries)` bytes. Each entry is opened when
 * the stream reaches it; an entry whose data is not exactly `size` bytes fails the stream.
 */
export function storedZipStream(entries: readonly StoredEntry[], at = new Date()): Readable {
  assertZipFits(entries);
  const stamp = dosDateTime(at);
  async function* generate(): AsyncGenerator<Uint8Array> {
    const central: Buffer[] = [];
    let offset = 0;
    for (const entry of entries) {
      const name = Buffer.from(entry.name, "utf8");
      const header = localHeader(name, entry, stamp);
      central.push(centralHeader(name, entry, offset, stamp));
      yield header;
      const data = await entry.open();
      let written = 0;
      if (data instanceof Uint8Array) {
        written = data.byteLength;
        yield data;
      } else {
        for await (const chunk of data) {
          const bytes = chunk as Uint8Array;
          written += bytes.byteLength;
          if (written > entry.size) break;
          yield bytes;
        }
        data.destroy();
      }
      if (written !== entry.size) {
        throw new Error(`ZIP entry ${entry.name} has ${written} bytes, expected ${entry.size}`);
      }
      offset += header.length + entry.size;
    }
    const directory = Buffer.concat(central);
    const end = Buffer.alloc(END_RECORD);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);
    yield directory;
    yield end;
  }
  return Readable.from(generate(), { objectMode: false });
}
