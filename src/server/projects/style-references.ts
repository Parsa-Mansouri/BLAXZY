import { describeReference, normalizeReference } from "@/lib/style-references";
import type { ProjectStyle, StyleReference } from "@/server/db/schema";
import { getOwnedFileInfo, type FileInfo } from "@/server/storage";
import { ProjectInputError } from "./schemas";

const MISSING_IMAGE = "A reference image could not be found. Add it again.";

type References = NonNullable<ProjectStyle["references"]>;

function clean(ref: StyleReference): StyleReference {
  const r = normalizeReference(ref);
  return {
    titles: r.titles,
    ...(r.description ? { description: r.description } : {}),
    fileIds: r.fileIds,
  };
}

/**
 * The style as it is stored: references normalized, and the look or genre string that has a
 * reference rewritten as its readable summary, so the writers (which read only the string) see
 * the user's names and words. A style without references is returned unchanged.
 */
export function applyStyleReferences(style: ProjectStyle): ProjectStyle {
  const refs = style.references;
  if (!refs || (!refs.visualStyle && !refs.genre)) {
    const { references: _unused, ...rest } = style;
    void _unused;
    return rest;
  }
  const references: References = {};
  let { visualStyle, genre } = style;
  if (refs.visualStyle) {
    references.visualStyle = clean(refs.visualStyle);
    visualStyle = describeReference(references.visualStyle);
  }
  if (refs.genre) {
    references.genre = clean(refs.genre);
    genre = describeReference(references.genre);
  }
  return { ...style, visualStyle, genre, references };
}

/** Every reference image id in the style. */
export function referenceFileIds(style: ProjectStyle): string[] {
  const refs = style.references;
  return [...new Set([...(refs?.visualStyle?.fileIds ?? []), ...(refs?.genre?.fileIds ?? [])])];
}

/**
 * Checks that each reference image is an uploaded, confirmed image of this user in this project.
 * Throws a ProjectInputError the user can act on.
 */
export async function assertReferenceFiles(
  fileIds: readonly string[],
  owner: { userId: string; projectId: string },
  lookup: (fileId: string, userId: string) => Promise<FileInfo | null> = getOwnedFileInfo,
): Promise<void> {
  const files = await Promise.all(fileIds.map((id) => lookup(id, owner.userId)));
  for (const info of files) {
    if (
      !info ||
      info.status !== "ready" ||
      info.projectId !== owner.projectId ||
      !info.mimeType.startsWith("image/")
    ) {
      throw new ProjectInputError(MISSING_IMAGE);
    }
  }
}
