import type { PromptModule } from "../types";

export const sciFi: PromptModule = {
  kind: "genre",
  key: "sci-fi",
  label: "Science fiction",
  aliases: [
    "science fiction",
    "scifi",
    "sf",
    "space",
    "cyberpunk",
    "dystopia",
    "dystopian",
    "futuristic",
  ],
  core: `Science fiction asks "what if?" and follows one speculative premise to its human consequences. The world has rules; the story is about people living under them.`,
  tasks: {
    write: `- One clear speculative premise, introduced early and consistent to the end. Show its consequences through ordinary actions (how people buy bread, travel, grieve), not exposition.
- Ground the big idea in a personal want and a personal cost.
- Technology and creatures have simple, distinctive silhouettes described once and identically every time; avoid designs whose meaning depends on legible interfaces or screen text.
- Name invented things sparingly and consistently; a reader should never need a glossary.`,
    check: `- Flag premises that change rules mid-story, exposition dumps, plot information carried only by screen text or interfaces, and designs described inconsistently.`,
    revise: `- Keep the world's rules intact when revising; if a change breaks a rule, adjust the dependent scenes.`,
    section: `- Give each world a defined palette and light logic (sodium haze, clinical white, bioluminescent blue); technology glows as light without readable text.
- Use scale: establish environments with wide or aerial shots before moving in.
- Describe every machine, vehicle or creature with the same wording in every block it appears in.`,
  },
};
