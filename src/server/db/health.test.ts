import { afterEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();
vi.mock("./client", () => ({ getDb: () => ({ execute }) }));

import { isDatabaseHealthy } from "./health";

afterEach(() => execute.mockReset());

describe("isDatabaseHealthy", () => {
  it("is true when the query succeeds", async () => {
    execute.mockResolvedValue({ rows: [{ "?column?": 1 }] });
    await expect(isDatabaseHealthy()).resolves.toBe(true);
  });

  it("is false when the query fails, without throwing", async () => {
    execute.mockRejectedValue(new Error("connection refused: secret-host"));
    await expect(isDatabaseHealthy()).resolves.toBe(false);
  });

  it("is false when getDb itself throws", async () => {
    execute.mockImplementation(() => {
      throw new Error("bad env");
    });
    await expect(isDatabaseHealthy()).resolves.toBe(false);
  });

  it("is false when the query hangs past the timeout", async () => {
    execute.mockReturnValue(new Promise(() => undefined));
    await expect(isDatabaseHealthy(20)).resolves.toBe(false);
  });
});
