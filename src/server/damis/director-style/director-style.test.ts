import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { partText } from "../framework/define";
import { outputFormatFor } from "../framework/request";
import { runDami } from "../framework/runner";
import { sampleFilmDirectorCard } from "../sample/director-style";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import { filmDirectorCard } from "./dami";
import cardInput from "./fixtures/card-input.json";
import { buildFilmDirectorCardPrompt } from "./prompt";
import { FILM_DIRECTOR_SYSTEM } from "./prompt-text";
import { filmDirectorCardOutputSchema } from "./schema";
import {
  DIRECTOR_STYLES,
  directorStyleCard,
  directorStyleCardSource,
  isDirectorStyleId,
} from "./styles";
import { checkStyleCard } from "./validate";

const lf = (text: string) => text.replace(/\r\n/g, "\n");

describe("director-style sources", () => {
  it("the system prompt is the owner's master prompt, verbatim", () => {
    const source = lf(readFileSync(join(__dirname, "source", "director_master_prompt.md"), "utf8"));
    expect(FILM_DIRECTOR_SYSTEM).toBe(source.trimEnd());
  });

  it("every style card's text is its reviewed .md file", () => {
    for (const style of DIRECTOR_STYLES) {
      const source = lf(readFileSync(join(__dirname, "styles", style.cardFile), "utf8"));
      expect(directorStyleCardSource(style.id)).toBe(source.trimEnd());
      expect(isDirectorStyleId(style.id)).toBe(true);
    }
  });

  it("the Nolan card is a marked placeholder with sections 0 to 14; the marker never reaches the model", () => {
    expect(directorStyleCardSource("nolan").split("\n")[0]).toBe(
      "<!-- PLACEHOLDER: replace with the Mode A output of the live run -->",
    );
    expect(DIRECTOR_STYLES.find((s) => s.id === "nolan")?.placeholder).toBe(true);
    const card = directorStyleCard("nolan");
    expect(card).not.toContain("PLACEHOLDER");
    expect(card.startsWith("# Director Style Card — Christopher Nolan")).toBe(true);
    expect(checkStyleCard({ card_markdown: card })).toEqual([]);
  });
});

describe("film-director-card (Mode A)", () => {
  it("asks for sections 0 to 14 in card_markdown", () => {
    const prompt = buildFilmDirectorCardPrompt({ director_name: "Christopher Nolan" });
    const text = partText(prompt.messages[0]?.content[0]);
    expect(text).toContain("<director>\nChristopher Nolan\n</director>");
    expect(text).toContain("Work in MODE A");
    expect(text).not.toContain("<films>");
    expect(() => outputFormatFor(filmDirectorCardOutputSchema)).not.toThrow();
  });

  it("checkStyleCard catches a missing or out-of-order section; the sample card passes", () => {
    const sample = filmDirectorCardOutputSchema.parse(sampleFilmDirectorCard(cardInput));
    expect(checkStyleCard(sample)).toEqual([]);
    const missing = sample.card_markdown.replace("## 7. Rhythm", "## Rhythm");
    expect(checkStyleCard({ card_markdown: missing }).join("\n")).toContain(
      '"7. Rhythm and editing"',
    );
  });

  it("returns the card markdown", async () => {
    const card = sampleFilmDirectorCard(cardInput);
    const client = new FakeClaudeClient([jsonResponse(card)]);
    const result = await runDami(filmDirectorCard, cardInput, {}, testDeps(client).deps);
    expect(result.output.card_markdown).toContain("## 14. Calibration scene");
  });
});
