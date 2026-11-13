import { describe, expect, it } from "vitest";
import { afterExportPoll, MAX_EXPORT_POLL_FAILURES } from "./export-poll";

describe("afterExportPoll", () => {
  it("tolerates failures until the limit", () => {
    let failures = 0;
    for (let i = 1; i < MAX_EXPORT_POLL_FAILURES; i++) {
      const out = afterExportPoll(failures, false);
      expect(out.giveUp).toBe(false);
      failures = out.failures;
    }
    expect(afterExportPoll(failures, false).giveUp).toBe(true);
  });

  it("a success clears the run", () => {
    expect(afterExportPoll(2, true)).toEqual({ failures: 0, giveUp: false });
  });
});
