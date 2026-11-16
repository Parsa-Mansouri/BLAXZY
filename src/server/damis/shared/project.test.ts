import { describe, expect, it } from "vitest";
import type { ProjectStyle } from "@/server/db/schema";
import { renderProjectParameters, renderStyleReferences } from "./project";
import { projectStyleSchema } from "./style";

const IMAGE = "6f1f0b8e-2f4a-4b8e-9d2a-0c6b1f0e3a11";

const base: ProjectStyle = {
  visualStyle: "cinematic-live-action",
  genre: "drama",
  format: "movie",
  orientation: "landscape",
  totalDurationSeconds: 180,
};

const withReferences: ProjectStyle = {
  ...base,
  visualStyle: "Like Blade Runner and Arrival. Cold neon at night.",
  references: {
    visualStyle: {
      titles: ["Blade Runner", "Arrival"],
      description: "Cold neon at night.",
      fileIds: [IMAGE],
    },
  },
};

describe("style references in the prompts", () => {
  it("adds nothing for a project without references", () => {
    expect(renderStyleReferences(base)).toEqual([]);
    expect(renderProjectParameters(base)).not.toContain("references");
  });

  it("lists the names and counts the images for the writers and the image damis", () => {
    const lines = renderStyleReferences(withReferences);
    expect(lines).toEqual([
      "- Visual style references (films or shows): Blade Runner; Arrival",
      "- Visual style reference images: 1 supplied by the user",
    ]);
    expect(renderProjectParameters(withReferences)).toContain(lines[0]);
  });
});

describe("projectStyleSchema references", () => {
  it("accepts a stored style with references and an older one without", () => {
    expect(projectStyleSchema.safeParse(withReferences).success).toBe(true);
    expect(projectStyleSchema.safeParse({ ...base, visualStyle: "Stop-motion clay" }).success).toBe(
      true,
    );
  });

  it("rejects an empty reference and malformed image ids", () => {
    const empty = { ...base, references: { genre: { titles: [], fileIds: [] } } };
    expect(projectStyleSchema.safeParse(empty).success).toBe(false);
    const badId = { ...base, references: { genre: { titles: [], fileIds: ["nope"] } } };
    expect(projectStyleSchema.safeParse(badId).success).toBe(false);
  });
});
