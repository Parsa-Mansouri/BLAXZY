import { describe, expect, it } from "vitest";
import type { ProjectStyle } from "@/server/db/schema";
import type { FileInfo } from "@/server/storage";
import { applyStyleReferences, assertReferenceFiles, referenceFileIds } from "./style-references";

const PROJECT = "0b5e7c1a-1111-4a2b-9c3d-000000000001";
const IMAGE = "6f1f0b8e-2f4a-4b8e-9d2a-0c6b1f0e3a11";

const base: ProjectStyle = {
  visualStyle: "cinematic-live-action",
  genre: "drama",
  format: "movie",
  orientation: "landscape",
  totalDurationSeconds: 180,
};

const file = (over: Partial<FileInfo> = {}): FileInfo => ({
  id: IMAGE,
  ownerId: "user-1",
  projectId: PROJECT,
  originalName: "still.png",
  mimeType: "image/png",
  sizeBytes: 1000,
  status: "ready",
  createdAt: new Date(0),
  ...over,
});

describe("applyStyleReferences", () => {
  it("keeps an older style (a typed value, no references) as it was", () => {
    const old = { ...base, visualStyle: "Stop-motion clay" };
    expect(applyStyleReferences(old)).toEqual(old);
  });

  it("stores the readable summary as the look and cleans the reference", () => {
    const saved = applyStyleReferences({
      ...base,
      visualStyle: "whatever the client sent",
      references: {
        visualStyle: { titles: [" Heat ", "heat", "Ronin"], description: " ", fileIds: [IMAGE] },
      },
    });
    expect(saved.visualStyle).toBe("Like Heat and Ronin.");
    expect(saved.genre).toBe("drama");
    expect(saved.references).toEqual({
      visualStyle: { titles: ["Heat", "Ronin"], fileIds: [IMAGE] },
    });
    expect(referenceFileIds(saved)).toEqual([IMAGE]);
  });
});

describe("assertReferenceFiles", () => {
  const owner = { userId: "user-1", projectId: PROJECT };

  it("accepts a confirmed image of the project", async () => {
    await expect(assertReferenceFiles([IMAGE], owner, async () => file())).resolves.toBeUndefined();
  });

  it("refuses a missing, pending, foreign or non-image file", async () => {
    for (const info of [
      null,
      file({ status: "pending" }),
      file({ projectId: "another" }),
      file({ mimeType: "application/pdf" }),
    ]) {
      await expect(assertReferenceFiles([IMAGE], owner, async () => info)).rejects.toThrow(
        /could not be found/,
      );
    }
  });
});
