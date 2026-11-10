import { describe, expect, it } from "vitest";
import type { ProjectStyle } from "@/server/db/schema";
import { buildScriptWriterPrompt } from "../script-writer/prompt";
import {
  composeModules,
  GENERIC_GENRE_MODULE,
  GENERIC_STYLE_MODULE,
  GENRE_MODULES,
  renderModule,
  resolveGenreModule,
  resolveStyleModule,
  STYLE_MODULES,
} from "./registry";
import { DAMI_TASKS } from "./types";

const style: ProjectStyle = {
  visualStyle: "Cinematic live-action",
  genre: "Thriller",
  format: "movie",
  orientation: "landscape",
  totalDurationSeconds: 120,
};

describe("module registry", () => {
  it("ships the required genre and style modules", () => {
    expect(GENRE_MODULES.map((m) => m.key)).toEqual([
      "drama",
      "comedy",
      "thriller",
      "horror",
      "sci-fi",
      "documentary",
    ]);
    expect(STYLE_MODULES.map((m) => m.key)).toEqual([
      "cinematic-live-action",
      "3d-animation",
      "2d-animation",
    ]);
  });

  it("resolves free-text values by key, label and alias", () => {
    expect(resolveGenreModule("Sci-Fi").key).toBe("sci-fi");
    expect(resolveGenreModule("science fiction").key).toBe("sci-fi");
    expect(resolveGenreModule("  HORROR ").key).toBe("horror");
    expect(resolveGenreModule("Psychological thriller").key).toBe("thriller");
    expect(resolveGenreModule("rom-com").key).toBe("comedy");
    expect(resolveStyleModule("Anime").key).toBe("2d-animation");
    expect(resolveStyleModule("3D animation").key).toBe("3d-animation");
    expect(resolveStyleModule("Cinematic live-action").key).toBe("cinematic-live-action");
  });

  it("falls back to the generic modules for unknown values", () => {
    expect(resolveGenreModule("Western")).toBe(GENERIC_GENRE_MODULE);
    expect(resolveGenreModule("")).toBe(GENERIC_GENRE_MODULE);
    expect(resolveStyleModule("Claymation")).toBe(GENERIC_STYLE_MODULE);
    const text = composeModules(
      { ...style, genre: "Western", visualStyle: "Claymation" },
      "write",
    )[0]?.text;
    expect(text).toContain("## Genre: Other genre");
    expect(text).toContain("## Visual style: Other visual style");
  });

  it("composes in a fixed order and deterministically", () => {
    const [first] = composeModules(style, "section");
    const [second] = composeModules({ ...style }, "section");
    expect(first).toEqual(second);
    expect(first?.cache).toBe(true);
    const text = first?.text ?? "";
    const positions = [
      text.indexOf("## Genre: Thriller"),
      text.indexOf("## Visual style: Cinematic live action"),
      text.indexOf("## Format: a single film"),
      text.indexOf("## Orientation: landscape"),
    ];
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("adds task guidance only for the task", () => {
    const thriller = resolveGenreModule("thriller");
    expect(renderModule(thriller, "write")).toContain("ticking clock");
    expect(renderModule(thriller, "section")).not.toContain("ticking clock");
    for (const promptModule of [...GENRE_MODULES, ...STYLE_MODULES]) {
      for (const task of DAMI_TASKS)
        expect(renderModule(promptModule, task)).toContain(promptModule.core);
    }
  });

  it("keeps stable text first and per-project text in the user message", () => {
    const prompt = buildScriptWriterPrompt({
      style: { ...style, extras: { tone: "dry" } },
      brief: "x",
    });
    expect(prompt.system.map((p) => p.cache)).toEqual([true, true]);
    const system = prompt.system.map((p) => p.text).join("\n");
    expect(system).not.toContain("2 min");
    expect(system).not.toContain("dry");
    const user = prompt.messages[0]?.content.map((p) => p.text).join("\n") ?? "";
    expect(user).toContain("2 min");
    expect(user).toContain("- tone: dry");
  });
});
