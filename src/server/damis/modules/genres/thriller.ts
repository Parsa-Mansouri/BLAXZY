import type { PromptModule } from "../types";

export const thriller: PromptModule = {
  kind: "genre",
  key: "thriller",
  label: "Thriller",
  aliases: [
    "suspense",
    "crime",
    "crime thriller",
    "mystery",
    "noir",
    "action",
    "action thriller",
    "heist",
    "spy",
  ],
  core: `A thriller runs on suspense: the audience knows or fears something the protagonist does not, time is running out, and every scene tightens the vice. Information is the currency: who knows what, and when.`,
  tasks: {
    write: `- Establish the threat and the stakes early and concretely; add a ticking clock (a deadline, a train, a dose running out).
- Prefer suspense to surprise: show the bomb under the table, then play the conversation.
- Every scene changes the balance: new threat, new information, or a reversal. Enter late, leave on a hook.
- Plant clues as objects and actions the camera can see, and pay every one of them off. No coincidences that rescue the hero.
- Violence is sudden, short and implied; show the aftermath and its cost. Chases are built from simple shots (feet, faces, a closing door), not choreography.`,
    check: `- Flag clues that are never paid off, rescues by coincidence, stakes that stay abstract, action that depends on contact choreography or crowds, and plot information carried only by on-screen text.`,
    revise: `- When tightening, keep every clue and payoff intact; cut repeated information first.`,
    section: `- Low-key light with hard shadows and practical sources; cool or sodium palettes; long lenses and over-the-shoulder framing for a watched feeling.
- Slow push-ins for dread, short static inserts for clues (described without legible text), handheld only in moments of panic.
- Rhythm: action becomes short blocks with one action each; dread becomes longer held blocks.`,
  },
};
