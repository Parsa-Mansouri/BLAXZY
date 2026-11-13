import "dotenv/config";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withAdvisoryLock } from "./migrate";

// Not the real migration key, so this never blocks a real run.
const KEY = 7_162_538_999;
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("withAdvisoryLock", () => {
  let a: Client;
  let b: Client;
  beforeAll(async () => {
    a = new Client({ connectionString: url });
    b = new Client({ connectionString: url });
    await Promise.all([a.connect(), b.connect()]);
  });
  afterAll(async () => {
    await Promise.all([a.end(), b.end()]);
  });

  it("runs the function and releases the lock afterwards", async () => {
    await expect(withAdvisoryLock(a, KEY, 1000, async () => 42)).resolves.toBe(42);
    await expect(withAdvisoryLock(b, KEY, 1000, async () => "again")).resolves.toBe("again");
  });

  it("makes a second runner wait, then time out, while the lock is held", async () => {
    let release: () => void = () => undefined;
    const held = withAdvisoryLock(
      a,
      KEY,
      1000,
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    await new Promise((r) => setTimeout(r, 100));
    await expect(withAdvisoryLock(b, KEY, 600, async () => "never")).rejects.toThrow(/lock/);
    release();
    await held;
  });

  it("releases the lock when the function throws", async () => {
    await expect(
      withAdvisoryLock(a, KEY, 1000, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(withAdvisoryLock(b, KEY, 1000, async () => "ok")).resolves.toBe("ok");
  });
});
