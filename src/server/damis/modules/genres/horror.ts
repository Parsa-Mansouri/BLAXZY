import type { PromptModule } from "../types";

export const horror: PromptModule = {
  kind: "genre",
  key: "horror",
  label: "Horror",
  aliases: ["scary", "supernatural", "psychological horror", "slasher", "folk horror"],
  core: `Horror is dread built from the ordinary. Establish normality and a specific fear, break one small rule of reality, and tighten until release. What is withheld frightens more than what is shown.`,
  tasks: {
    write: `- Open in a believable normal world with one wrong detail. Give the threat rules and keep them.
- Build each scare: quiet, a growing wrongness, a held moment, then release (or a false release followed by the real one). Never more than one big reveal per sequence.
- Fear lives in faces, sound and negative space: a door left ajar, a breath on the baby monitor, a shape at the edge of the frame.
- Gore stays off screen or implied: the provider refuses graphic injury. Show the reaction and the aftermath.
- Darkness must still be filmable: every night scene names its light source (a torch, a phone screen, a fire, moonlight through blinds).`,
    check: `- Flag scares without build-up, gore the provider will refuse, threats whose rules change without reason, and night scenes with no light source.`,
    revise: `- When asked for more fear, add build-up and withholding before adding events.`,
    section: `- Compose with negative space; hold wide static shots a beat too long; shallow focus with something unclear in the background.
- Slow creeping camera moves; sudden cuts only at the release. Sound carries dread: low drones, a silence before the scare, one sharp effect.
- Dark but readable: motivated practical light, deep shadows, faces partly lit.`,
  },
};
