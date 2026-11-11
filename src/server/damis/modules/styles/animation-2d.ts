import type { PromptModule } from "../types";

export const animation2d: PromptModule = {
  kind: "style",
  key: "2d-animation",
  label: "2D / anime animation",
  aliases: [
    "2d",
    "anime",
    "2d anime",
    "2d animated",
    "cartoon",
    "hand drawn",
    "hand-drawn",
    "cel",
    "manga",
  ],
  core: `Visual style: 2D hand-drawn / anime animation: clean line art, cel shading, painted backgrounds, designed poses and expressive faces.`,
  tasks: {
    write: `- Use the medium's strengths: expressive faces, visual metaphors, stylised effects (wind, light flares, impact frames) used sparingly and on purpose.
- Keep character designs simple enough to stay consistent: a signature hairstyle and colour, one outfit per sequence.`,
    check: `- Flag designs that rely on fine detail that 2D generation will not keep consistent, and effects-heavy action that would turn to noise.`,
    detect: `- Describe characters as 2D designs: hairstyle and hair colour first (the key identifier), eye colour and shape, outfit with colours, silhouette, accessories. Locations by background-painting style, palette and time of day.`,
    section: `- STYLE line for every block: "2D anime-style animation, clean line art, cel shading, painted backgrounds" plus the aspect ratio and the project's palette.
- Use anime staging: strong angles, held poses, wind in hair and clothes, light shafts, dramatic close-ups on eyes at key moments; limited animation for dialogue.
- Light is expressed through cel-shadow shapes and colour temperature; backgrounds stay painterly and calm behind the action.`,
    reference: `- Start the image prompt with the style in concrete terms: "2D anime-style illustration, clean line art, cel shading, flat painted colour".
- Describe silhouette, line weight and colour blocks rather than photographic skin or lens detail; light is cel-shadow shapes, not realistic gradients.`,
  },
};
