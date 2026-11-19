import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { CLAUDE_MODELS } from "../framework/models";
import { countBreakpoints, outputFormatFor } from "../framework/request";
import { runDami } from "../framework/runner";
import { sampleBlockRevision } from "../sample/block-revision";
import { sampleDirector } from "../sample/director";
import directorInput from "../director/fixtures/input.json";
import { directorInputSchema, type DirectorOutput } from "../director/schema";
import { checkDirector } from "../director/validate";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import { countWords } from "../director/validate";
import { blockRevision, blockRevisionModel, blockRevisionRunContext } from "./dami";
import rawInput from "./fixtures/input.json";
import { buildBlockRevisionPrompt, revisionBible } from "./prompt";
import { BLOCK_REVISION_SYSTEM } from "./prompt-text";
import {
  blockRevisionInputSchema,
  blockRevisionOutputSchema,
  type BlockRevisionOutput,
} from "./schema";
import {
  checkAssetChanges,
  checkAttemptHistory,
  checkAudioTokensKept,
  checkBlockRevision,
  checkDialogueUnchanged,
  checkFixMap,
  checkHandOffs,
  checkKeep,
  checkSliderState,
} from "./validate";

const lf = (text: string) => text.replace(/\r\n/g, "\n");
const inputJson = rawInput as unknown as z.input<typeof blockRevisionInputSchema>;
const input = blockRevisionInputSchema.parse(inputJson);
const out = (): BlockRevisionOutput => structuredClone(sampleBlockRevision(inputJson));

describe("block-revision source", () => {
  it("the system prompt is the owner's file from <role> to the end", () => {
    const md = lf(readFileSync(join(__dirname, "source", "dami_block_revision.system.md"), "utf8"));
    expect(BLOCK_REVISION_SYSTEM).toBe(md.slice(md.indexOf("<role>")).trimEnd());
    const header = md.slice(0, md.indexOf("<role>")).trim().split("\n");
    expect(header.every((l) => l.startsWith("#"))).toBe(true);
    expect(BLOCK_REVISION_SYSTEM).toContain("<verify>");
    expect(BLOCK_REVISION_SYSTEM.startsWith("<role>")).toBe(true);
  });

  it("the output schema carries the owner's keys, including slider_state and flags", () => {
    const sent = outputFormatFor(blockRevisionOutputSchema).schema as { required?: string[] };
    expect([...(sent.required ?? [])].sort()).toEqual(
      [
        "dami",
        "dami_version",
        "block_id",
        "version",
        "based_on_version",
        "duration_s",
        "start_state",
        "end_state",
        "start_staging",
        "end_staging",
        "staging_meaning",
        "opening_frame",
        "in_progress_at_end",
        "camera_rationale",
        "editing_rationale",
        "assets",
        "budgets",
        "shots",
        "applied_rules",
        "prompt_text",
        "word_count",
        "change_log",
        "fix_map",
        "expected_checks",
        "slider_state",
        "flags",
      ].sort(),
    );
  });
});

describe("block-revision input", () => {
  it("needs a change request; observed issues must exist in video_review", () => {
    const base = { ...inputJson, timed_notes: undefined };
    expect(blockRevisionInputSchema.safeParse({ ...base, requests: {} }).success).toBe(false);
    expect(
      blockRevisionInputSchema.safeParse({ ...base, requests: { regenerate: true } }).success,
    ).toBe(true);
    expect(
      blockRevisionInputSchema.safeParse({ ...base, requests: { observed_issues: ["i9"] } })
        .success,
    ).toBe(false);
    expect(
      blockRevisionInputSchema.safeParse({
        ...base,
        requests: { asset_correction: { add: [], remove: [], swap: [] } },
      }).success,
    ).toBe(false);
  });

  it("has no review_options or sliders: they are stripped if sent", () => {
    const parsed = blockRevisionInputSchema.parse({
      ...inputJson,
      requests: { ...inputJson.requests, sliders: { pace: 1 }, review_options: { stage: "video" } },
    });
    expect(parsed.requests).not.toHaveProperty("sliders");
    expect(parsed.requests).not.toHaveProperty("review_options");
  });

  it("a timed note must end after it starts", () => {
    expect(
      blockRevisionInputSchema.safeParse({
        ...inputJson,
        timed_notes: [{ from_s: 5, to_s: 5, category: "directing", note: "x" }],
      }).success,
    ).toBe(false);
  });
});

describe("block-revision prompt and model", () => {
  it("caches the system prompt and the project data; optional tags only when present", () => {
    const prompt = buildBlockRevisionPrompt(input);
    expect(countBreakpoints(prompt)).toBe(2);
    const [stable, perBlock] = (prompt.messages[0]?.content ?? []).map(
      (p) => (p as { text: string }).text,
    );
    for (const tag of ["platform_config", "creative_bible", "continuity_bible"]) {
      expect(stable).toContain(`<${tag}>`);
    }
    for (const tag of [
      "ui_language",
      "script_excerpt",
      "neighbours",
      "current_block",
      "video_review",
      "timed_notes",
      "keep",
      "attempt_history",
      "requests",
    ]) {
      expect(perBlock).toContain(`<${tag}>`);
    }
    const minimal = blockRevisionInputSchema.parse({
      ...inputJson,
      video_review: undefined,
      timed_notes: undefined,
      keep: undefined,
      attempt_history: undefined,
      requests: { regenerate: true },
    });
    const text = (buildBlockRevisionPrompt(minimal).messages[0]?.content[1] as { text: string })
      .text;
    for (const tag of ["video_review", "timed_notes", "keep", "attempt_history"]) {
      expect(text).not.toContain(`<${tag}>`);
    }
  });

  it("the creative bible block leaves out the review options", () => {
    const sent = revisionBible(input.creative_bible);
    expect(JSON.stringify(sent)).not.toContain("review_options");
    expect(Object.keys(sent.slices).sort()).toEqual(["for_director", "for_text_blocks_video"]);
  });

  it("Sonnet by default, Opus for regenerate", async () => {
    expect(blockRevision.model).toBe(CLAUDE_MODELS.sonnet);
    expect(blockRevisionModel(input)).toBe(CLAUDE_MODELS.sonnet);
    expect(blockRevisionRunContext({ requests: { regenerate: true } })).toEqual({
      model: CLAUDE_MODELS.opus,
    });
    const client = new FakeClaudeClient([jsonResponse(sampleBlockRevision(inputJson))]);
    await runDami(blockRevision, inputJson, blockRevisionRunContext(input), testDeps(client).deps);
    expect(client.requests[0]?.model).toBe(CLAUDE_MODELS.sonnet);

    const regen = { ...inputJson, requests: { regenerate: true } };
    const client2 = new FakeClaudeClient([jsonResponse(sampleBlockRevision(regen))]);
    await runDami(
      blockRevision,
      regen,
      blockRevisionRunContext(blockRevisionInputSchema.parse(regen)),
      testDeps(client2).deps,
    );
    expect(client2.requests[0]?.model).toBe(CLAUDE_MODELS.opus);
  });
});

describe("the sample passes check()", () => {
  it("applies the issue, the timed note and the director note as a minimal diff", () => {
    const result = out();
    expect(blockRevisionOutputSchema.safeParse(result).success).toBe(true);
    expect(checkBlockRevision(result, input)).toEqual([]);
    expect(result.version).toBe(input.current_block.version + 1);
    expect(result.based_on_version).toBe(input.current_block.version);
    expect(result.fix_map.map((f) => [f.source, f.ref])).toEqual([
      ["issue", "i1"],
      ["timed_note", "t1"],
      ["director_note", "d1"],
    ]);
    // The failed level-1 attempt in the history makes the fix level 2.
    expect(result.fix_map[0]?.level).toBe(2);
    expect(result.start_staging).toEqual(input.current_block.start_staging);
    expect(result.shots[0]).toEqual(input.current_block.shots[0]);
    expect(countWords(result.prompt_text)).toBe(result.word_count);
    expect(Object.values(result.slider_state).every((v) => v === 0)).toBe(true);
  });

  it("regenerate re-directs the camera; asset corrections are reported, not applied", () => {
    const regen = {
      ...inputJson,
      requests: { regenerate: true, asset_correction: { add: ["prop_2"], remove: [], swap: [] } },
      timed_notes: undefined,
      keep: undefined,
    };
    const parsed = blockRevisionInputSchema.parse(regen);
    const result = sampleBlockRevision(regen);
    expect(checkBlockRevision(result, parsed)).toEqual([]);
    expect(result.shots.map((s) => s.camera)).not.toEqual(
      parsed.current_block.shots.map((s) => s.camera),
    );
    expect(result.flags.not_applied.join(" ")).toContain("assets");
  });

  it("a kept window is left alone", () => {
    const result = out();
    expect(result.shots[0]?.action).toBe(input.current_block.shots[0]?.action);
    expect(checkKeep(result, input.current_block, input.keep ?? [])).toEqual([]);
  });

  it("through runDami, a bad first answer is sent back once", async () => {
    const bad = out();
    bad.version = 9;
    const client = new FakeClaudeClient([jsonResponse(bad), jsonResponse(out())]);
    const result = await runDami(blockRevision, inputJson, {}, testDeps(client).deps);
    expect(client.requests).toHaveLength(2);
    expect(result.output.version).toBe(input.current_block.version + 1);
  });
});

describe("check(): identity and structure", () => {
  it("version, based_on_version, block_id and duration", () => {
    const r = out();
    r.version = 5;
    r.based_on_version = 3;
    r.block_id = 9;
    r.duration_s = 30;
    const errors = checkBlockRevision(r, input).join("\n");
    for (const s of [
      "block_id must stay",
      "based_on_version must be",
      "version must be",
      "duration_s must stay",
    ]) {
      expect(errors).toContain(s);
    }
  });

  it("windows must be continuous and 2 to 6 s", () => {
    const r = out();
    if (r.shots[0]) r.shots[0].window = "0-7s";
    if (r.shots[1]) r.shots[1].window = "7-10s";
    expect(checkBlockRevision(r, input).join("\n")).toContain("maximum is 6 s");
  });

  it("budgets are enforced unless split_required is set", () => {
    const r = out();
    r.budgets.spoken_words_max = 3;
    expect(checkBlockRevision(r, input).join("\n")).toContain("spoken words exceed");
    r.flags.split_required = true;
    expect(checkBlockRevision(r, input).join("\n")).not.toContain("spoken words exceed");
  });

  it("layout, forbidden words, word count and descriptors reuse the Director's checks", () => {
    const r = out();
    r.prompt_text = r.prompt_text
      .replace("Opening frame:", "Start:")
      .replace("Look:", "The next block. Look:");
    const errors = checkBlockRevision(r, input).join("\n");
    expect(errors).toContain('missing "Opening frame:"');
    expect(errors).toContain("next block");
    const short = out();
    short.prompt_text =
      "BEGIN PROMPT\nStaging: x Opening frame: y Audio: z No subtitles.\nEND PROMPT";
    const shortErrors = checkBlockRevision(short, input).join("\n");
    expect(shortErrors).toContain("must have 180 to 350");
    expect(shortErrors).toContain("not pasted word for word");
  });
});

describe("check(): dialogue, assets, hand-offs", () => {
  it("dialogue text, speaker and order never change", () => {
    const r = out();
    expect(checkDialogueUnchanged(r, input.current_block)).toEqual([]);
    const shot = r.shots.find((s) => s.dialogue.length > 0);
    if (shot?.dialogue[0]) shot.dialogue[0].line = "I am famished.";
    expect(checkDialogueUnchanged(r, input.current_block)[0]).toContain("dialogue");
  });

  it("assets change only through asset_correction", () => {
    const r = out();
    r.assets.props = [...r.assets.props, "prop_2"];
    expect(checkAssetChanges(r, input.current_block, undefined)[0]).toContain("added without");
    expect(
      checkAssetChanges(r, input.current_block, { add: ["prop_2"], remove: [], swap: [] }),
    ).toEqual([]);
    const gone = out();
    gone.assets.props = [];
    expect(checkAssetChanges(gone, input.current_block, undefined)[0]).toContain("removed without");
    // A swap removes the "from" asset (allowed); prop_2 was not added here.
    expect(
      checkAssetChanges(gone, input.current_block, {
        add: [],
        remove: [],
        swap: [{ from: "prop_1", to: "prop_2" }],
      }),
    ).toEqual([]);
  });

  it("heard_only changes only through asset_correction; no voices, no voice_ ids (v1.5)", () => {
    const r = out();
    r.assets.heard_only = ["char_2"];
    expect(checkBlockRevision(r, input).join("\n")).toContain('"char_2" was added without');
    expect(checkBlockRevision(r, input).join("\n")).toContain(
      "in both assets.characters and assets.heard_only",
    );
    const v = out();
    v.assets.props = [...v.assets.props, "voice_1"];
    expect(checkBlockRevision(v, input).join("\n")).toContain('no "voice_" ids');
  });

  it("every <<<audio_N>>> token of a bound block is kept (v1.5)", () => {
    const bound = structuredClone(inputJson);
    const block = bound.current_block as { prompt_text: string };
    block.prompt_text = block.prompt_text.replace(
      "END PROMPT",
      "<<<audio_1>>> <<<audio_2>>>\nEND PROMPT",
    );
    const parsed = blockRevisionInputSchema.parse(bound);
    const kept = sampleBlockRevision(bound);
    expect(kept.prompt_text).toContain("<<<audio_2>>>");
    expect(checkAudioTokensKept(kept, parsed.current_block)).toEqual([]);
    expect(checkBlockRevision(kept, parsed)).toEqual([]);
    const dropped = structuredClone(kept);
    dropped.prompt_text = dropped.prompt_text.replace("<<<audio_2>>>", "");
    expect(checkAudioTokensKept(dropped, parsed.current_block)).toEqual([
      `block ${parsed.current_block.block_id}: the voice token <<<audio_2>>> of the bound prompt is missing; keep every audio token word for word`,
    ]);
    expect(checkAudioTokensKept(dropped, { prompt_text: "no tokens" })).toEqual([]);
  });

  it("a current block stored by Director v1.3 is upgraded on input", () => {
    const legacy = structuredClone(inputJson) as unknown as {
      current_block: {
        assets: Record<string, unknown>;
        shots: { dialogue: Record<string, unknown>[] }[];
      };
    };
    delete legacy.current_block.assets.heard_only;
    legacy.current_block.assets.voices = [];
    for (const s of legacy.current_block.shots) for (const d of s.dialogue) delete d.heard_as;
    const parsed = blockRevisionInputSchema.parse(legacy);
    expect(parsed.current_block.assets.heard_only).toEqual([]);
    expect(parsed.current_block).toEqual(input.current_block);
  });

  it("start_staging equals the previous end_staging for a continuous block", () => {
    const r = out();
    expect(checkHandOffs(r, input)).toEqual([]);
    if (r.start_staging[0]) r.start_staging[0].gaze = "away";
    expect(checkHandOffs(r, input)[0]).toContain("start_staging");
  });

  it("a changed end hand-off needs next_block_needs_update, and the flag needs a change", () => {
    const r = out();
    if (r.end_staging[0]) r.end_staging[0].posture = "kneeling";
    expect(checkHandOffs(r, input).join("\n")).toContain("set flags.next_block_needs_update");
    r.flags.next_block_needs_update = true;
    expect(checkHandOffs(r, input)).toEqual([]);
    const idle = out();
    idle.flags.next_block_needs_update = true;
    expect(checkHandOffs(idle, input)[0]).toContain("did not change");
    const state = out();
    state.end_state = "something new";
    expect(checkHandOffs(state, input)[0]).toContain("end_state changed");
  });

  it("a continuous next block must still get its start_staging", () => {
    const withNext = blockRevisionInputSchema.parse({
      ...inputJson,
      neighbours: {
        ...inputJson.neighbours,
        next: { ...inputJson.neighbours.next, continuity_type: "continuous" },
      },
    });
    const r = out();
    expect(checkHandOffs(r, withNext).join("\n")).toContain("next block's start_staging");
    r.flags.next_block_needs_update = true;
    r.end_state = "changed";
    expect(checkHandOffs(r, withNext)).toEqual([]);
  });
});

describe("check(): fix_map, keep, history, sliders", () => {
  it("every confirmed issue and timed note is in fix_map or named in not_applied", () => {
    const r = out();
    r.fix_map = [];
    r.flags.not_applied = [];
    const errors = checkFixMap(r, input).join("\n");
    expect(errors).toContain("issue i1");
    expect(errors).toContain("timed note t1");
    expect(errors).toContain("director note");
    r.flags.not_applied = ["i1: out of reach", "t1: out of reach"];
    expect(checkFixMap(r, input)).toEqual([]);
  });

  it("a timed note is also covered by a fix_map entry whose window overlaps it", () => {
    const r = out();
    r.fix_map = r.fix_map.map((f) => (f.source === "timed_note" ? { ...f, ref: "x" } : f));
    expect(checkFixMap(r, input)).toEqual([]);
    r.fix_map = r.fix_map.map((f) => (f.source === "timed_note" ? { ...f, window: "0-5s" } : f));
    expect(checkFixMap(r, input).join("\n")).toContain("timed note t1");
  });

  it("a kept window is unchanged or explained in change_log", () => {
    const r = out();
    const shot = r.shots[0];
    if (shot) shot.action = `${shot.action} Something new.`;
    expect(checkKeep(r, input.current_block, input.keep ?? [])[0]).toContain("kept window 0-5s");
    r.change_log.push("0-5s: the push-in is slower because an issue sat in the same window");
    expect(checkKeep(r, input.current_block, input.keep ?? [])).toEqual([]);
  });

  it("a fix that failed before must climb a level", () => {
    const r = out();
    if (r.fix_map[0]) r.fix_map[0].level = 1;
    expect(checkAttemptHistory(r, input)[0]).toContain("escalate");
    r.flags.structural_suggestion = "split_block";
    expect(checkAttemptHistory(r, input)).toEqual([]);
  });

  it("slider_state is all zeros", () => {
    const r = out();
    r.slider_state.pace = 1;
    expect(checkSliderState(r)[0]).toContain("slider_state.pace");
    expect(checkBlockRevision(r, input).join("\n")).toContain("slider_state.pace");
  });

  it("change_log must not be empty", () => {
    const r = out();
    r.change_log = [];
    expect(checkBlockRevision(r, input).join("\n")).toContain("change_log is empty");
  });
});

describe("Director sample blocks are valid Block Revision input", () => {
  it("every block of the Director sample can be revised by the sample, and both pass check()", () => {
    const director = sampleDirector(directorInput) as DirectorOutput;
    expect(checkDirector(director, directorInputSchema.parse(directorInput))).toEqual([]);
    director.blocks.forEach((current, i) => {
      const before = director.blocks[i - 1];
      const after = director.blocks[i + 1];
      const raw = {
        ...inputJson,
        continuity_bible: director.continuity_bible,
        current_block: current,
        neighbours: {
          previous: before
            ? {
                end_state: before.end_state,
                end_staging: before.end_staging,
                in_progress_at_end: before.in_progress_at_end,
                last_window: before.shots.at(-1)?.window ?? "",
              }
            : null,
          next: after
            ? {
                start_state: after.start_state,
                start_staging: after.start_staging,
                continuity_type: after.continuity.type,
              }
            : null,
        },
        video_review: undefined,
        keep: undefined,
        attempt_history: undefined,
        timed_notes: [{ from_s: 5, to_s: 10, category: "directing", note: "Slow the pace" }],
        requests: { director_notes: "Make the silence heavier" },
      };
      const parsed = blockRevisionInputSchema.parse(raw);
      expect(checkBlockRevision(sampleBlockRevision(raw), parsed), `block ${i + 1}`).toEqual([]);
    });
  });
});
