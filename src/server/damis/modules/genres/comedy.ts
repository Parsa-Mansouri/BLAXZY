import type { PromptModule } from "../types";

export const comedy: PromptModule = {
  kind: "genre",
  key: "comedy",
  label: "Comedy",
  aliases: [
    "comic",
    "romantic comedy",
    "romcom",
    "rom-com",
    "sitcom",
    "dramedy",
    "satire",
    "parody",
  ],
  core: `Comedy is truth under pressure, played straight. Characters chase a clear, slightly wrong goal with total commitment, and each attempt makes things worse. The audience laughs at recognition and at escalation, never because the characters are winking at them.`,
  tasks: {
    write: `- Every scene has a comic premise you can state in one line ("he must hide the dog from the landlord who is allergic and suspicious").
- Escalate in threes: establish, repeat, then twist the third beat. Set up early, pay off late; call back earlier jokes in new contexts.
- Put the funny word or image at the end of the line or paragraph; cut on the laugh. Short lines play faster.
- Visual gags must read in one frame and one action: a reveal, a deadpan look, a door opening on the wrong person, a timed entrance. Avoid slapstick that needs contact choreography (falls into each other, food fights with many hits).
- Characters never comment on their own jokes. Stakes stay real to them.
- No humour that punches down at protected groups or uses real public figures.`,
    check: `- Flag scenes without a comic premise, jokes that rely on legible text or complex physical choreography, and punchlines buried mid-line.`,
    revise: `- When asked to make it funnier, sharpen premise and escalation before adding jokes; when cutting, keep the setups the payoffs need.`,
    section: `- Comedy wants clear, bright, well-composed frames, wide enough to see the gag; static or simple camera so the timing is in the action.
- Timing is written as duration: "a one-second beat; he blinks". Give the reaction its own shot.
- Never split a setup and its punchline into different blocks.`,
  },
};
