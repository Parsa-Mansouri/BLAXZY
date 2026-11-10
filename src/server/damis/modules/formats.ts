import type { Orientation, ProjectFormat } from "@/server/db/schema";

/** Fixed text per format and orientation. Stable, so it is cached with the other modules. */
export const FORMAT_TEXT: Record<ProjectFormat, string> = {
  movie: `## Format: a single film
One continuous story with one beginning and one ending. The script has no episode headings.`,
  series: `## Format: a series
The content is organised in episodes. Each episode begins with its own line "EPISODE n: TITLE" (n counts from 1) followed by its scenes. Each episode has its own hook, complication and ending (closure or cliffhanger), and the season has an overall arc. Characters, locations and props are shared across episodes and keep identical names and looks everywhere.`,
};

export const ORIENTATION_TEXT: Record<Orientation, string> = {
  landscape: `## Orientation: landscape 16:9
Compose for a wide frame: room for two-shots side by side, landscapes and lateral movement; use the width for staging and screen direction.`,
  portrait: `## Orientation: portrait 9:16 (vertical, phone-first)
Compose for a tall frame: one dominant subject, faces in the upper third, depth stacked foreground to background instead of side by side. Two characters are staged in depth or over the shoulder, not side by side. Establishing shots favour height (towers, stairwells, trees, a figure under a vast sky) or a telling detail instead of a panorama.`,
};
