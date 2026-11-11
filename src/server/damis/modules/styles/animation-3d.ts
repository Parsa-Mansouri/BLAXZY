import type { PromptModule } from "../types";

export const animation3d: PromptModule = {
  kind: "style",
  key: "3d-animation",
  label: "3D animation",
  aliases: [
    "3d",
    "3d animated",
    "cgi",
    "cg",
    "cg animation",
    "3d cartoon",
    "stylized 3d",
    "stylised 3d",
    "pixar style",
    "disney style",
  ],
  core: `Visual style: stylised 3D animation at feature-film quality: appealing character designs, rich materials, soft global illumination, expressive acting.`,
  tasks: {
    write: `- Animation frees physics and acting: exaggerated reactions, stylised worlds and talking animals work. Keep the cast per shot small anyway.
- Give characters strong silhouettes and signature colours so they stay recognisable; write their look once, clearly.
- Pitch intensity to the genre and audience; animated does not mean childish unless the project says so.`,
    check: `- Flag designs too complex to keep consistent (many small accessories, patterned costumes) and moments that lose readability in a stylised render.`,
    detect: `- Describe characters by design: proportions (head-to-body ratio, limb length), silhouette, signature colours, materials (fur, felt, glossy plastic, knit), eye style. Locations by shape language, palette and materials.`,
    section: `- STYLE line for every block: "Stylised 3D animation, feature-film quality CG, soft global illumination, rich materials, expressive character animation" plus the aspect ratio and the project's palette.
- Describe shapes and materials (rounded, chunky, soft fur, brushed metal), squash-and-stretch acting, clear poses and big readable expressions.
- Light like an animated feature: warm key, cool fill, rim light separating characters from the background, saturated but controlled colour.`,
    reference: `- Start the image prompt with the style in concrete terms: "Stylised 3D animation render, feature-film quality CG, soft global illumination, rich materials".
- Describe shapes and materials (rounded, chunky, soft fur, brushed metal) rather than photographic detail; no film grain, no lens talk.`,
  },
};
