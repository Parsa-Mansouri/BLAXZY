import type { PromptModule } from "../types";

export const documentary: PromptModule = {
  kind: "genre",
  key: "documentary",
  label: "Documentary",
  aliases: ["docu", "doc", "docudrama", "nature documentary", "explainer", "historical"],
  core: `A documentary has a subject, a question and a point of view. Here every image is generated, so it is a reconstruction: it must never pass invented material off as real footage of real people.`,
  tasks: {
    write: `- Build around a question the film answers. Structure: hook image, the question, evidence in sequences, a turn, an answer or an open ending.
- Write it as a documentary script: scene headings for each visual sequence, action lines describing the images (observational scenes, reconstructions, landscapes, details), NARRATOR (V.O.) lines for narration, and interview subjects as characters (use fictional or anonymised witnesses, never real named people).
- Narration adds what the image cannot show; it never describes what we already see.
- Facts: keep to well-established facts; anything uncertain is phrased as uncertain and listed in notes for the director to verify. Never invent quotes from real people.
- Real historical figures appear only from behind, in silhouette, as hands or at a distance, because generation cannot depict real people; say so in notes.`,
    check: `- Flag factual claims that need verification, depictions of real identifiable people, invented quotes attributed to real people, and narration that only repeats the image.`,
    revise: `- Keep factual claims as they are unless the review challenges them; never add new unverified facts.`,
    section: `- Observational camera: handheld or tripod, natural light, long lenses, unobtrusive framing. Reconstructions are slightly stylised (soft haze, partial framing) so they read as reconstructions.
- Interviews: medium close-up, subject off-centre, soft background, looking just off camera.
- Narration goes in SOUND as VOICE-OVER with the exact line.`,
  },
};
