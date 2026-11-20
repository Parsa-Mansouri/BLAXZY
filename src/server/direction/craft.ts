/**
 * Which Director Style Card and which cinematographer card direct a project (pure).
 *
 * PLACEHOLDER until the "brain" dami: the owner's future dami will read the Style step (the
 * project's style and its Creative Bible) and decide the director and the cinematographer. Until
 * then every project gets the defaults below; the arguments are already the brain's inputs so
 * callers do not change when it lands.
 */
import type { CinematographerId, CreativeBible, DirectorStyleId } from "@/server/damis";
import type { ProjectStyle } from "@/server/db/schema";

export const DEFAULT_DIRECTOR_ID: DirectorStyleId = "nolan";
export const DEFAULT_CINEMATOGRAPHER_ID: CinematographerId = "deakins";

export type CraftSelection = {
  directorId: DirectorStyleId;
  cinematographerId: CinematographerId;
};

export function pickCraft(style: ProjectStyle | null, bible: CreativeBible | null): CraftSelection {
  void style;
  void bible;
  return { directorId: DEFAULT_DIRECTOR_ID, cinematographerId: DEFAULT_CINEMATOGRAPHER_ID };
}
