import { describe, expect, it } from "vitest";
import { isCinematographerId, isDirectorStyleId } from "@/server/damis";
import { DEFAULT_CINEMATOGRAPHER_ID, DEFAULT_DIRECTOR_ID, pickCraft } from "./craft";

describe("pickCraft (placeholder until the brain dami)", () => {
  it("picks Nolan and Deakins for every project", () => {
    expect(pickCraft(null, null)).toEqual({ directorId: "nolan", cinematographerId: "deakins" });
    expect(isDirectorStyleId(DEFAULT_DIRECTOR_ID)).toBe(true);
    expect(isCinematographerId(DEFAULT_CINEMATOGRAPHER_ID)).toBe(true);
  });
});
