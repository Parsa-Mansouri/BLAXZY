import { describe, expect, it } from "vitest";
import { cutsFromTimes, parseShowinfoTimes } from "./frames";

const LINE = (n: number, t: string) =>
  `[Parsed_showinfo_1 @ 000001] n:   ${n} pts: ${Math.round(Number(t) * 12800)} pts_time:${t}    duration:512 duration_time:0.04 fmt:yuv420p`;

describe("parseShowinfoTimes", () => {
  it("reads pts_time from the per-frame showinfo lines only", () => {
    const stderr = [
      "ffmpeg version 7.1 Copyright (c) 2000-2024",
      "Input #0, mov,mp4, from 'x.mp4':",
      "  Duration: 00:00:04.00, start: 0.000000, bitrate: 100 kb/s",
      LINE(48, "2.000000"),
      "[Parsed_showinfo_1 @ 000001] config in time_base: 1/12800, frame_rate: 24/1",
      LINE(120, "5.0"),
      "frame=  96 fps=0.0 q=-0.0 Lsize=N/A time=00:00:04.00",
    ].join("\r\n");
    expect(parseShowinfoTimes(stderr)).toEqual([2, 5]);
  });

  it("tolerates spaces after the colon, sorts, and skips malformed lines", () => {
    const stderr = [
      LINE(2, "9.5"),
      "[Parsed_showinfo_1 @ 0x1] n:   3 pts: 5 pts_time: 1.25 pos:12",
      "[Parsed_showinfo_1 @ 0x1] n:   4 pts: 5 pts_time:abc",
      "[Parsed_showinfo_1 @ 0x1] n:   5 pts: 5",
      "pts_time:3.0 (not showinfo)",
    ].join("\n");
    expect(parseShowinfoTimes(stderr)).toEqual([1.25, 9.5]);
  });

  it("returns an empty list for an empty log", () => {
    expect(parseShowinfoTimes("")).toEqual([]);
  });
});

describe("cutsFromTimes", () => {
  it("drops a cut at the very start and merges near-duplicates", () => {
    expect(cutsFromTimes([0, 0.02, 2, 2.05, 4.2])).toEqual([{ t: 2 }, { t: 4.2 }]);
  });
});
