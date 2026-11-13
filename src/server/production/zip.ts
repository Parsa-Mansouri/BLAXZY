/**
 * A minimal ZIP writer for stored (uncompressed) entries, written as a stream. MP4s do not
 * compress, so storing them keeps the work to copying bytes, and every entry's size is known up
 * front: the archive's exact length is computed before a byte is written (an upload needs it).
 *
 * Each entry's CRC-32 is needed in its local header, before its data. It is computed by a first
 * streaming pass over the entry (`crc32Of`), so the archive itself is written in one pass with no
 * data descriptors (readable by every unzip tool) and never held in memory.
 *
 * Archives that fit classic ZIP limits are written as classic ZIP. Beyond them (an entry or an
 * offset above 4 GiB - 2, or more than 65,534 entries) the ZIP64 extensions are used where needed:
 * a ZIP64 extra field in the local and central headers of the entries that need it, and a ZIP64
 * end of central directory record with its locator. `storedZipSize` and `storedZipStream` share
 * one layout, so the computed size is the streamed size byte for byte.
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

/**
 * The largest values written in the classic 32-bit and 16-bit fields; anything larger goes to the
 * ZIP64 fields (and the classic field holds the 0xFFFFFFFF / 0xFFFF marker). Injectable so tests
 * can exercise ZIP64 without gigabytes.
 */
export type ZipLimits = { max32: number; max16: number };
export const CLASSIC_ZIP_LIMITS: ZipLimits = { max32: 0xffff_fffe, max16: 0xfffe };

/** The largest archive this writer produces (entries and offsets must stay exact JS integers). */
export const ZIP_MAX_BYTES = Number.MAX_SAFE_INTEGER;

const LOCAL_HEADER = 30;
const CENTRAL_HEADER = 46;
const END_RECORD = 22;
const ZIP64_END_RECORD = 56;
const ZIP64_LOCATOR = 20;
/** Local ZIP64 extra: id, length, original size, compressed size. */
const ZIP64_LOCAL_EXTRA = 4 + 16;
/** Bit 11: names are UTF-8. */
const FLAG_UTF8 = 0x0800;
const MARK32 = 0xffff_ffff;
const MARK16 = 0xffff;

export class ZipLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipLimitError";
  }
}

type EntryLayout = {
  name: Buffer;
  size: number;
  offset: number;
  /** The local header carries a ZIP64 extra (sizes). */
  local64: boolean;
  /** Central header: sizes and/or offset in the ZIP64 extra. */
  size64: boolean;
  offset64: boolean;
};

type Layout = {
  entries: EntryLayout[];
  directoryOffset: number;
  directorySize: number;
  /** The archive ends with the ZIP64 end record and locator before the classic end record. */
  end64: boolean;
  total: number;
};

function localLength(e: Pick<EntryLayout, "name" | "local64">): number {
  return LOCAL_HEADER + e.name.length + (e.local64 ? ZIP64_LOCAL_EXTRA : 0);
}

function centralExtraLength(e: Pick<EntryLayout, "size64" | "offset64">): number {
  const fields = (e.size64 ? 2 : 0) + (e.offset64 ? 1 : 0);
  return fields === 0 ? 0 : 4 + 8 * fields;
}

function centralLength(e: EntryLayout): number {
  return CENTRAL_HEADER + e.name.length + centralExtraLength(e);
}

function layout(entries: readonly { name: string; size: number }[], limits: ZipLimits): Layout {
  const out: EntryLayout[] = [];
  let offset = 0;
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new ZipLimitError(`ZIP entry ${entry.name} has an invalid size.`);
    }
    const name = Buffer.from(entry.name, "utf8");
    if (name.length > 0xffff) throw new ZipLimitError(`ZIP entry name too long: ${entry.name}`);
    const size64 = entry.size > limits.max32;
    const e: EntryLayout = {
      name,
      size: entry.size,
      offset,
      local64: size64,
      size64,
      offset64: offset > limits.max32,
    };
    out.push(e);
    offset += localLength(e) + entry.size;
  }
  const directoryOffset = offset;
  const directorySize = out.reduce((sum, e) => sum + centralLength(e), 0);
  const end64 =
    out.length > limits.max16 || directorySize > limits.max32 || directoryOffset > limits.max32;
  const total =
    directoryOffset + directorySize + (end64 ? ZIP64_END_RECORD + ZIP64_LOCATOR : 0) + END_RECORD;
  if (!Number.isSafeInteger(total) || total > ZIP_MAX_BYTES) {
    throw new ZipLimitError("The ZIP would be too large.");
  }
  return { entries: out, directoryOffset, directorySize, end64, total };
}

/** The archive's exact size for these entries (names in UTF-8). */
export function storedZipSize(
  entries: readonly { name: string; size: number }[],
  limits: ZipLimits = CLASSIC_ZIP_LIMITS,
): number {
  return layout(entries, limits).total;
}

/**
 * The archive's exact size; throws `ZipLimitError` when it would be larger than `maxBytes`
 * (default: the most this writer can produce).
 */
export function assertZipFits(
  entries: readonly { name: string; size: number }[],
  maxBytes: number = ZIP_MAX_BYTES,
): number {
  const size = storedZipSize(entries);
  if (size > maxBytes) throw new ZipLimitError("The ZIP would be larger than allowed.");
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

function u64(value: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(value));
  return b;
}

function localHeader(e: EntryLayout, crc: number, stamp: { time: number; date: number }) {
  const header = Buffer.alloc(LOCAL_HEADER);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(e.local64 ? 45 : 10, 4); // version needed: 4.5 (ZIP64) or 1.0 (stored)
  header.writeUInt16LE(FLAG_UTF8, 6);
  header.writeUInt16LE(0, 8); // method: stored
  header.writeUInt16LE(stamp.time, 10);
  header.writeUInt16LE(stamp.date, 12);
  header.writeUInt32LE(crc >>> 0, 14);
  header.writeUInt32LE(e.local64 ? MARK32 : e.size, 18);
  header.writeUInt32LE(e.local64 ? MARK32 : e.size, 22);
  header.writeUInt16LE(e.name.length, 26);
  header.writeUInt16LE(e.local64 ? ZIP64_LOCAL_EXTRA : 0, 28); // extra length
  if (!e.local64) return Buffer.concat([header, e.name]);
  const extra = Buffer.alloc(4);
  extra.writeUInt16LE(0x0001, 0); // ZIP64 extended information
  extra.writeUInt16LE(16, 2);
  return Buffer.concat([header, e.name, extra, u64(e.size), u64(e.size)]);
}

function centralHeader(e: EntryLayout, crc: number, stamp: { time: number; date: number }) {
  const zip64 = e.size64 || e.offset64;
  const extraLength = centralExtraLength(e);
  const header = Buffer.alloc(CENTRAL_HEADER);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE((3 << 8) | (zip64 ? 45 : 20), 4); // made by: Unix, 2.0 (4.5 with ZIP64)
  header.writeUInt16LE(e.local64 ? 45 : 10, 6);
  header.writeUInt16LE(FLAG_UTF8, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(stamp.time, 12);
  header.writeUInt16LE(stamp.date, 14);
  header.writeUInt32LE(crc >>> 0, 16);
  header.writeUInt32LE(e.size64 ? MARK32 : e.size, 20);
  header.writeUInt32LE(e.size64 ? MARK32 : e.size, 24);
  header.writeUInt16LE(e.name.length, 28);
  header.writeUInt16LE(extraLength, 30); // extra
  header.writeUInt16LE(0, 32); // comment
  header.writeUInt16LE(0, 34); // disk
  header.writeUInt16LE(0, 36); // internal attributes
  header.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external: a regular file, rw-r--r--
  header.writeUInt32LE(e.offset64 ? MARK32 : e.offset, 42);
  if (extraLength === 0) return Buffer.concat([header, e.name]);
  // The ZIP64 extra holds only the fields whose classic value is the marker, in this order.
  const extra = Buffer.alloc(4);
  extra.writeUInt16LE(0x0001, 0);
  extra.writeUInt16LE(extraLength - 4, 2);
  const fields = [
    ...(e.size64 ? [u64(e.size), u64(e.size)] : []),
    ...(e.offset64 ? [u64(e.offset)] : []),
  ];
  return Buffer.concat([header, e.name, extra, ...fields]);
}

function endRecords(plan: Layout): Buffer {
  const count = plan.entries.length;
  const parts: Buffer[] = [];
  if (plan.end64) {
    const record = Buffer.alloc(ZIP64_END_RECORD);
    record.writeUInt32LE(0x06064b50, 0);
    record.writeBigUInt64LE(BigInt(ZIP64_END_RECORD - 12), 4); // size of the rest of the record
    record.writeUInt16LE((3 << 8) | 45, 12); // made by
    record.writeUInt16LE(45, 14); // version needed
    record.writeUInt32LE(0, 16); // this disk
    record.writeUInt32LE(0, 20); // disk with the directory
    record.writeBigUInt64LE(BigInt(count), 24); // entries on this disk
    record.writeBigUInt64LE(BigInt(count), 32); // entries in total
    record.writeBigUInt64LE(BigInt(plan.directorySize), 40);
    record.writeBigUInt64LE(BigInt(plan.directoryOffset), 48);
    const locator = Buffer.alloc(ZIP64_LOCATOR);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeUInt32LE(0, 4); // disk with the ZIP64 end record
    locator.writeBigUInt64LE(BigInt(plan.directoryOffset + plan.directorySize), 8);
    locator.writeUInt32LE(1, 16); // disks in total
    parts.push(record, locator);
  }
  const end = Buffer.alloc(END_RECORD);
  const count16 = plan.end64 ? MARK16 : count;
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(count16, 8);
  end.writeUInt16LE(count16, 10);
  end.writeUInt32LE(plan.end64 ? MARK32 : plan.directorySize, 12);
  end.writeUInt32LE(plan.end64 ? MARK32 : plan.directoryOffset, 16);
  end.writeUInt16LE(0, 20);
  parts.push(end);
  return Buffer.concat(parts);
}

/**
 * The archive as a stream of exactly `storedZipSize(entries, limits)` bytes. Each entry is opened
 * when the stream reaches it; an entry whose data is not exactly `size` bytes fails the stream.
 */
export function storedZipStream(
  entries: readonly StoredEntry[],
  at = new Date(),
  limits: ZipLimits = CLASSIC_ZIP_LIMITS,
): Readable {
  const plan = layout(entries, limits);
  const stamp = dosDateTime(at);
  async function* generate(): AsyncGenerator<Uint8Array> {
    const central: Buffer[] = [];
    for (const [i, entry] of entries.entries()) {
      const e = plan.entries[i] as EntryLayout;
      const header = localHeader(e, entry.crc, stamp);
      central.push(centralHeader(e, entry.crc, stamp));
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
    }
    yield Buffer.concat(central);
    yield endRecords(plan);
  }
  return Readable.from(generate(), { objectMode: false });
}
