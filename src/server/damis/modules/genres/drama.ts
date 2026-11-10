import type { PromptModule } from "../types";

export const drama: PromptModule = {
  kind: "genre",
  key: "drama",
  label: "Drama",
  aliases: ["dramatic", "family drama", "period drama", "romance", "romantic drama"],
  core: `Drama is character under pressure. A protagonist wants something concrete, needs something they will not admit, and must choose between them at real cost. Truth of behaviour matters more than event size: a small story told with specificity beats a big story told in generalities.`,
  tasks: {
    write: `- Give the protagonist a concrete, visible want in the first scene (keep the job, win her back, bury the father properly) and an obstacle that is another person, not luck.
- Every scene is a negotiation: someone wants something from someone else. If a scene has no opposing wants, cut it or merge it.
- Emotion is carried by behaviour, objects and distance between bodies, never stated: not "She is heartbroken" but "She keeps setting two plates, then puts one back."
- Restraint: one held silence lands harder than a speech. No characters explaining their feelings in full sentences; let them say less than they mean.
- Plant the objects and phrases the ending will use. The final image should echo or invert the opening image to show the change.
- Places are specific and lived-in: a laundromat at 2 a.m., a hospital car park in sleet, not "a room".`,
    check: `- Flag scenes where nobody wants anything from anyone, motivation that is unclear at the moment of a key choice, dialogue that names emotions directly, and endings not prepared by earlier scenes.`,
    revise: `- When tightening, cut explanation before behaviour, and summary dialogue before subtext.`,
    section: `- Favour medium close-ups and close-ups for emotional beats; hold on the listener's reaction, not only the speaker.
- Motivated, naturalistic light (window light, practical lamps); slow push-ins at turning points; handheld only for instability; no flashy moves.
- Let silences have duration: write the pause as an action ("she does not answer; the kettle starts to whistle").`,
  },
};
