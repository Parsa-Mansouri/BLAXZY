import type { PromptModule } from "../types";

export const cinematicLiveAction: PromptModule = {
  kind: "style",
  key: "cinematic-live-action",
  label: "Cinematic live action",
  aliases: [
    "cinematic",
    "live action",
    "live-action",
    "realistic",
    "photoreal",
    "photorealistic",
    "film",
    "realism",
  ],
  core: `Visual style: photoreal cinematic live action. The result must look like it was shot on a cinema camera with real actors, real locations and real light.`,
  tasks: {
    write: `- Everything must be physically plausible with real actors and real places, or read as invisible VFX. No cartoon physics.
- Describe people as people (age, build, face, hair, clothing), places as real places with materials and weather.`,
    check: `- Flag moments that would read as cartoonish in photoreal video (impossible physics, exaggerated anatomy) unless the story makes them deliberate VFX.`,
    detect: `- Describe characters as real people: apparent age, build, height, face, hair, skin tone only if stated, clothing materials and condition. Describe locations as real places with era, architecture and materials.`,
    section: `- STYLE line for every block: "Photoreal cinematic live action, shot on 35mm film, natural skin texture, shallow depth of field" plus the aspect ratio and the project's colour mood.
- Use real cinematography language: lens (24mm wide, 35mm, 50mm normal, 85mm portrait, 135mm compressed), light quality and direction (soft window light from the left, hard noon sun, tungsten practicals, neon spill), film grain, colour grade.
- Human motion is realistic and weighted; no exaggerated acting.`,
    reference: `- Start the image prompt with the style in concrete terms: "Photoreal studio reference photograph, 85mm lens, natural skin texture, soft even light".
- Describe real materials, real fabric weight, natural skin and hair; avoid stylised or illustrated wording.`,
  },
};
