/** Copy for the landing sections, in the brand voice: plain and director-facing. */

export interface StageChapter {
  heading: string;
  body: string;
}

/** One chapter per stage, keyed like PROJECT_STAGES. */
export const STAGE_CHAPTERS: Record<string, StageChapter> = {
  style: {
    heading: "Decide how it looks first.",
    body: "Animation or cinematic, the genre, a movie or a series, the length, portrait or landscape. Every later choice is tailored to these answers.",
  },
  script: {
    heading: "Start from an idea, or bring your script.",
    body: "Upload a script and it is checked, or describe the story in a few lines and one is written. Read it scene by scene, comment, send it back with notes, and repeat until it is right.",
  },
  pre_production: {
    heading: "Meet every character before the first scene.",
    body: "Characters, locations, props and voices are found in your script. Upload an image or generate one, review it, and its sheet is built while you move on to the next.",
  },
  production: {
    heading: "Every clip, ready for your editor.",
    body: "The script becomes blocks, each with the right assets attached. BLAXZY chooses the models. Preview each take, accept it or reject it with a reason, and receive every scene.",
  },
};

export interface SplitRow {
  title: string;
  note: string;
}

export const YOU_DECIDE: readonly SplitRow[] = [
  { title: "The look", note: "Animation or cinematic, the genre, the format." },
  { title: "The story", note: "Your script, or an idea written up with you." },
  { title: "The cast and places", note: "Who and where, down to every prop and voice." },
  { title: "Which takes to keep", note: "Accept what works, reject what does not." },
];

export const WE_HANDLE: readonly SplitRow[] = [
  { title: "Which model", note: "Chosen for every clip. You never pick one." },
  { title: "Every prompt", note: "Written from your script and your assets." },
  { title: "References and consistency", note: "Sheets keep a face the same from scene to scene." },
  {
    title: "Resolution and the finished render",
    note: "A draft first, then the full-quality clip.",
  },
  { title: "The retries", note: "A rejected clip is fixed for the exact problem you name." },
];

export const FAQ_ITEMS: readonly { question: string; answer: string }[] = [
  {
    question: "Do I need to know how AI video works?",
    answer:
      "No. BLAXZY makes the model and prompting decisions for you. You make the creative ones, through four guided stages: Style, Script, Pre-production and Production.",
  },
  {
    question: "Can I bring my own script?",
    answer:
      "Yes. Upload it and it is checked, then you read it scene by scene. If you have no script, describe the story briefly and one is written for you to review.",
  },
  {
    question: "What do I get at the end?",
    answer:
      "Every generated clip of your film or series, organised by episode, scene and block, ready for your editor. Assembling the film is done in your own editing software.",
  },
  {
    question: "Can I redo a clip I don't like?",
    answer:
      "Yes. Reject it and say what is wrong, from a list of concrete issues or in your own words, and it is generated again. Earlier versions are kept.",
  },
  {
    question: "Where are my files kept?",
    answer:
      "In object storage on your own installation. Nothing is deleted: every version and every decision is kept.",
  },
  {
    question: "Is it self-hosted?",
    answer: "Yes. BLAXZY runs on your own installation, with its own database and file storage.",
  },
];

export const TREE_LINES: readonly { structure: string; name: string; time?: string }[] = [
  { structure: "", name: "EPISODE 01" },
  { structure: "├─ ", name: "SCENE 01  INT. LIGHTHOUSE – NIGHT" },
  { structure: "│  ├─ ", name: "block 01   clip_e01_s01_b01.mp4", time: "00:00:15:00" },
  { structure: "│  ├─ ", name: "block 02   clip_e01_s01_b02.mp4", time: "00:00:15:00" },
  { structure: "│  └─ ", name: "block 03   clip_e01_s01_b03.mp4", time: "00:00:15:00" },
  { structure: "└─ ", name: "SCENE 02  EXT. CLIFF PATH – DAWN" },
  { structure: "   ├─ ", name: "block 01   clip_e01_s02_b01.mp4", time: "00:00:15:00" },
  { structure: "   └─ ", name: "block 02   clip_e01_s02_b02.mp4", time: "00:00:15:00" },
];

/** The contact sheet under "BLAXZY returns the film": episode 01 scene by scene, block by block. */
export const SHEET_SCENES: readonly { heading: string; blocks: readonly string[] }[] = [
  { heading: "INT. LIGHTHOUSE – NIGHT", blocks: ["location", "character", "prop"] },
  { heading: "EXT. CLIFF PATH – DAWN", blocks: ["location", "character"] },
  { heading: "INT. KEEPER’S COTTAGE – DAY", blocks: ["prop", "character", "location"] },
  { heading: "EXT. HARBOUR – DUSK", blocks: ["location", "creature"] },
];
