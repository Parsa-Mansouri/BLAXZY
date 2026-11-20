import { describe, expect, it } from "vitest";
import rawInput from "./fixtures/input.json";
import outputJson from "./fixtures/model-output.json";
import {
  directorInputSchema,
  directorOutputSchema,
  registryAssetIds,
  type Block,
  type DirectorOutput,
} from "./schema";
import {
  bibleRuleIds,
  checkAppliedRules,
  checkAssetIds,
  checkBibleAssetIds,
  checkBudgets,
  checkDescriptors,
  checkDialogueInScript,
  checkDirector,
  checkDuration,
  checkForbiddenWords,
  checkHeardOnly,
  checkNoVoiceAssets,
  checkOnScreenStaging,
  checkPreflight,
  checkPromptLayout,
  checkRationales,
  checkScriptCoverage,
  checkShotBudget,
  checkShotPlanFollowed,
  checkShotWindows,
  checkStagingContinuity,
  checkTotals,
  checkVoiceNotes,
  checkWordCount,
  countWords,
  descriptorFor,
  parseWindow,
  spokenWords,
  stagingEqual,
} from "./validate";

const input = directorInputSchema.parse(rawInput);
const output = directorOutputSchema.parse(outputJson);
const block = (index = 0): Block => structuredClone(output.blocks[index] as Block);
const known = registryAssetIds(input.asset_registry);

describe("helpers", () => {
  it("parseWindow reads the owner's window text", () => {
    expect(parseWindow("0-4s")).toEqual({ from: 0, to: 4 });
    expect(parseWindow(" 4–9 s ")).toEqual({ from: 4, to: 9 });
    expect(parseWindow("0-4.5s")).toEqual({ from: 0, to: 4.5 });
    expect(parseWindow("start")).toBeNull();
  });

  it("countWords counts whitespace-separated words, not the word_count field", () => {
    expect(countWords("  a  b\nc ")).toBe(3);
    expect(countWords("")).toBe(0);
  });

  it("stagingEqual ignores the order of entries and distances", () => {
    const b = block(0);
    expect(stagingEqual(b.start_staging, [...b.start_staging].reverse())).toBe(true);
    const moved = structuredClone(b.start_staging);
    if (moved[0]) moved[0].posture = "kneeling";
    expect(stagingEqual(b.start_staging, moved)).toBe(false);
  });
});

describe("checkDuration", () => {
  it("accepts 15 and 30 and enforces a fixed block_mode", () => {
    expect(checkDuration({ block_id: 1, duration_s: 15 }, "fixed_15")).toEqual([]);
    expect(checkDuration({ block_id: 1, duration_s: 30 }, "auto")).toEqual([]);
    expect(checkDuration({ block_id: 1, duration_s: 20 }, "auto")).toHaveLength(1);
    expect(checkDuration({ block_id: 1, duration_s: 30 }, "fixed_15")[0]).toContain("fixed_15");
    expect(checkDuration({ block_id: 1, duration_s: 15 }, "fixed_30")[0]).toContain("fixed_30");
  });
});

describe("checkShotWindows", () => {
  it("passes continuous windows from 0 to duration_s", () => {
    expect(checkShotWindows(block())).toEqual([]);
  });

  it("flags a gap, an overlap, a wrong end, a short window, a long window and a bad shot_number", () => {
    const gap = block();
    if (gap.shots[1]) gap.shots[1].window = "6-10s";
    expect(checkShotWindows(gap).join("\n")).toContain("expected 5 s");

    const end = block();
    if (end.shots[2]) end.shots[2].window = "10-14s";
    expect(checkShotWindows(end).join("\n")).toContain("duration_s is 15");

    const short = block();
    if (short.shots[0]) short.shots[0].window = "0-1s";
    expect(checkShotWindows(short).join("\n")).toContain("minimum is 2 s");

    const long = block();
    const only = long.shots[0];
    if (!only) throw new Error("fixture");
    expect(
      checkShotWindows({ ...long, shots: [{ ...only, window: "0-15s" }] }, { maxSeconds: 6 }).join(
        "\n",
      ),
    ).toContain("maximum is 6 s");

    const number = block();
    if (number.shots[0]) number.shots[0].shot_number = 2;
    expect(checkShotWindows(number).join("\n")).toContain("must be 1");

    const bad = block();
    if (bad.shots[0]) bad.shots[0].window = "first";
    expect(checkShotWindows(bad).join("\n")).toContain("not like");
  });
});

describe("checkShotBudget", () => {
  const withShots = (
    count: number,
    budget: "standard" | "rapid_cut",
    duration = 15,
    rationale = "r",
  ) => {
    const b = block();
    const shot = b.shots[0];
    if (!shot) throw new Error("fixture");
    return {
      ...b,
      duration_s: duration,
      budgets: { ...b.budgets, shot_budget: budget },
      editing_rationale: rationale,
      shots: Array.from({ length: count }, (_, i) => ({ ...shot, shot_number: i + 1 })),
    };
  };

  it("standard 3/5, rapid_cut 5/10 for 15/30 s", () => {
    expect(checkShotBudget(withShots(3, "standard"))).toEqual([]);
    expect(checkShotBudget(withShots(4, "standard"))[0]).toContain("standard budget of 3");
    expect(checkShotBudget(withShots(5, "standard", 30))).toEqual([]);
    expect(checkShotBudget(withShots(6, "standard", 30))).toHaveLength(1);
    expect(checkShotBudget(withShots(5, "rapid_cut"))).toEqual([]);
    expect(checkShotBudget(withShots(6, "rapid_cut"))).toHaveLength(1);
    expect(checkShotBudget(withShots(10, "rapid_cut", 30))).toEqual([]);
    expect(checkShotBudget(withShots(11, "rapid_cut", 30))).toHaveLength(1);
  });

  it("rapid_cut needs its justification in editing_rationale", () => {
    expect(checkShotBudget(withShots(4, "rapid_cut", 15, "  "))[0]).toContain("editing_rationale");
  });
});

describe("checkBudgets", () => {
  const platform = input.platform_config;

  it("passes the fixture", () => {
    expect(checkBudgets(block(1), platform, "en")).toEqual([]);
  });

  it("counts the spoken words itself and compares them with spoken_words_max", () => {
    const b = block(1);
    expect(spokenWords(b.shots)).toBe(4);
    const tight = { ...b, budgets: { ...b.budgets, spoken_words_max: 2 } };
    expect(checkBudgets(tight, platform, "en")[0]).toContain("4 spoken words exceed");
  });

  it("limits spoken_words_max to the speech rate minus 30% and events to the platform's", () => {
    const b = block(1);
    const high = { ...b, budgets: { ...b.budgets, spoken_words_max: 60 } };
    expect(checkBudgets(high, platform, "en").join("\n")).toContain("above 26");
    // Persian speaks more slowly: 2.0 wps x 15 s x 0.7 = 21.
    expect(
      checkBudgets({ ...b, budgets: { ...b.budgets, spoken_words_max: 26 } }, platform, "fa").join(
        "\n",
      ),
    ).toContain("above 21");
    const busy = { ...b, budgets: { ...b.budgets, events: 3 } };
    expect(checkBudgets(busy, platform, "en").join("\n")).toContain("max_events_per_block 2");
  });
});

describe("heard-only speakers and voice notes (v1.4)", () => {
  it("the fixture passes", () => {
    for (const b of output.blocks) expect(checkHeardOnly(b)).toEqual([]);
    expect(checkVoiceNotes(output.continuity_bible, input.asset_registry)).toEqual([]);
  });

  it("every speaker is in the block's characters or heard_only", () => {
    const b = block(0);
    const line = b.shots.flatMap((s) => s.dialogue)[0];
    if (!line) throw new Error("fixture block 1 has dialogue");
    line.speaker_id = "char_7";
    line.heard_as = "off_screen";
    expect(checkHeardOnly(b).join("\n")).toContain('speaker "char_7" is in neither');
    line.speaker_id = "new_char_1";
    expect(checkHeardOnly(b)).toEqual([]);
  });

  it("a heard-only speaker has no @token, no Staging entry and is not on screen", () => {
    const b = block(0);
    const line = b.shots.flatMap((s) => s.dialogue)[0];
    if (!line) throw new Error("fixture block 1 has dialogue");
    // char_1 speaks in block 1; move them to heard_only but leave the rest as it is.
    b.assets.characters = b.assets.characters.filter((id) => id !== "char_1");
    b.assets.heard_only = ["char_1"];
    const errors = checkHeardOnly(b).join("\n");
    expect(errors).toContain('no "@char_1" token');
    expect(errors).toContain("no Staging entry");
    expect(errors).toContain('heard_as cannot be "on_screen"');
    b.assets.characters.push("char_1");
    expect(checkHeardOnly(b).join("\n")).toContain(
      "in both assets.characters and assets.heard_only",
    );
  });

  it("a heard-only speaker that is written as heard passes", () => {
    const b = block(0);
    b.assets.characters = b.assets.characters.filter((id) => id !== "char_1");
    b.assets.heard_only = ["char_1"];
    b.prompt_text = b.prompt_text.replace(/@char_1(?![0-9])/g, "Nora");
    b.start_staging = b.start_staging.filter((s) => s.character_id !== "char_1");
    b.end_staging = b.end_staging.filter((s) => s.character_id !== "char_1");
    for (const shot of b.shots) for (const d of shot.dialogue) d.heard_as = "phone_or_device";
    expect(checkHeardOnly(b)).toEqual([]);
  });

  it("@char_1 is not found inside @char_10", () => {
    const b = block(0);
    b.assets.characters = b.assets.characters.filter((id) => id !== "char_1");
    b.assets.heard_only = ["char_1"];
    b.prompt_text = b.prompt_text.replace(/@char_1(?![0-9])/g, "@char_10");
    expect(checkHeardOnly(b).join("\n")).not.toContain("token");
  });

  it("a silent character's voice note is empty", () => {
    const bible = structuredClone(output.continuity_bible);
    const silent = bible.characters.find((c) => c.asset_id === "char_3");
    if (!silent) throw new Error("fixture has char_3");
    silent.voice = "a high, quick voice";
    expect(checkVoiceNotes(bible, input.asset_registry)).toEqual([
      'continuity_bible: "char_3" does not speak (output_21 speaks false); its voice note must be empty',
    ]);
  });
});

describe("asset ids and descriptors", () => {
  it("every id is in output_21 or starts with new_", () => {
    expect(checkAssetIds(block(), known)).toEqual([]);
    const b = block();
    b.assets.characters = ["char_1", "char_9", "new_char_2"];
    expect(checkAssetIds(b, known)).toHaveLength(1);
    expect(checkAssetIds(b, known)[0]).toContain("char_9");
    const heard = block();
    heard.assets.heard_only = ["char_8"];
    expect(checkAssetIds(heard, known)[0]).toContain("char_8");
  });

  it("no voices list and no voice_ id anywhere (v1.4)", () => {
    expect(checkNoVoiceAssets(outputJson)).toEqual([]);
    expect(checkNoVoiceAssets({ continuity_bible: { voices: [] } })[0]).toContain("voices");
    expect(checkNoVoiceAssets({ assets: { characters: ["voice_1"] } })[0]).toContain("voice_");
    expect(checkNoVoiceAssets({ prompt_text: "Audio: @voice_2 hums." })).toHaveLength(1);
    // The heard_as value is not an id.
    expect(checkNoVoiceAssets({ heard_as: "voice_over" })).toEqual([]);
  });

  it("the bible's ids are checked too", () => {
    expect(checkBibleAssetIds(output.continuity_bible, known)).toEqual([]);
    const bible = structuredClone(output.continuity_bible);
    bible.props.push({ asset_id: "prop_7", descriptor: "x" });
    expect(checkBibleAssetIds(bible, known)).toHaveLength(1);
  });

  it("each descriptor appears verbatim in the prompt", () => {
    expect(checkDescriptors(block(), output.continuity_bible)).toEqual([]);
    const b = block();
    const descriptor = descriptorFor(output.continuity_bible, "char_2", 1) ?? "";
    b.prompt_text = b.prompt_text.replace(
      descriptor,
      descriptor.replace("long dark braid", "short braid"),
    );
    expect(checkDescriptors(b, output.continuity_bible)[0]).toContain('"char_2"');
  });

  it("whitespace differences do not matter, a missing bible entry does", () => {
    const b = block();
    const descriptor = descriptorFor(output.continuity_bible, "loc_1", 1) ?? "";
    b.prompt_text = b.prompt_text.replace(descriptor, descriptor.replace(/ /g, "  "));
    expect(checkDescriptors(b, output.continuity_bible)).toEqual([]);
    const noEntry = structuredClone(output.continuity_bible);
    noEntry.props = [];
    expect(checkDescriptors(block(1), noEntry)[0]).toContain("no entry in continuity_bible");
  });

  it("a costume version replaces the descriptor from its block on", () => {
    const bible = structuredClone(output.continuity_bible);
    const nora = bible.characters.find((c) => c.asset_id === "char_1");
    nora?.costume_versions.push({ from_block: 3, descriptor: "A woman in a red coat" });
    expect(descriptorFor(bible, "char_1", 2)).toBe(nora?.descriptor);
    expect(descriptorFor(bible, "char_1", 3)).toBe("A woman in a red coat");
    expect(checkDescriptors({ ...block(2), block_id: 3 }, bible)[0]).toContain('"char_1"');
  });
});

describe("checkPromptLayout and checkWordCount", () => {
  it("passes the fixture", () => {
    for (let i = 0; i < 4; i++) {
      expect(checkPromptLayout(block(i))).toEqual([]);
      expect(checkWordCount(block(i))).toEqual([]);
    }
  });

  it("flags a wrong start, end and each missing marker", () => {
    const b = block();
    b.prompt_text = b.prompt_text.replace("BEGIN PROMPT", "PROMPT").replace("END PROMPT", "DONE");
    expect(checkPromptLayout(b)).toHaveLength(2);
    for (const marker of ["Staging:", "Opening frame:", "Audio:", "No subtitles."]) {
      const m = block();
      m.prompt_text = m.prompt_text.replace(marker, "x");
      expect(checkPromptLayout(m).join("\n"), marker).toContain(marker);
    }
  });

  it("counts the words itself: 179 fails, 180 and 350 pass, 351 fails; the field is ignored", () => {
    const make = (n: number) => ({
      block_id: 1,
      word_count: 250,
      prompt_text: Array.from({ length: n }, () => "w").join(" "),
    });
    expect(checkWordCount(make(179))[0]).toContain("179 words");
    expect(checkWordCount(make(180))).toEqual([]);
    expect(checkWordCount(make(350))).toEqual([]);
    expect(checkWordCount(make(351))[0]).toContain("351 words");
  });
});

describe("checkForbiddenWords", () => {
  const withText = (extra: string) => {
    const b = block();
    b.prompt_text = b.prompt_text.replace("Look:", `${extra} Look:`);
    return b;
  };

  it("passes the fixture", () => {
    expect(checkForbiddenWords(block())).toEqual([]);
  });

  it.each([
    "block",
    "clip",
    "previous",
    "earlier",
    "as before",
    "same as",
    "same position",
    "continues",
    "continuing",
    "still",
    "last frame",
    "next block",
    "next clip",
    "next scene",
    "next shot",
    "returns to",
    "return to",
  ])("flags %s, case-insensitively", (word) => {
    expect(checkForbiddenWords(withText(`The room is ${word.toUpperCase()} quiet.`))[0]).toContain(
      word.toLowerCase(),
    );
  });

  it("allows again, and words that only contain a forbidden one", () => {
    expect(checkForbiddenWords(withText("She looks again. Blockers stilled."))).toEqual([]);
  });

  it("ignores words inside spoken dialogue lines, which must stay verbatim", () => {
    const b = block(1);
    const shot = b.shots.find((s) => s.dialogue.length > 0);
    if (!shot?.dialogue[0]) throw new Error("fixture has dialogue");
    shot.dialogue[0].line = "I still love you";
    b.prompt_text = b.prompt_text.replace("I am not hungry.", "I still love you");
    expect(b.prompt_text).toContain("I still love you");
    expect(checkForbiddenWords(b)).toEqual([]);
    shot.dialogue[0].line = "something else";
    expect(checkForbiddenWords(b)[0]).toContain("still");
  });
});

describe("rationales, staging, rules", () => {
  it("every shot has default_avoided; both rationales are non-empty", () => {
    expect(checkRationales(block())).toEqual([]);
    const b = block();
    if (b.shots[1]) b.shots[1].default_avoided = " ";
    b.camera_rationale = "";
    b.editing_rationale = "";
    expect(checkRationales(b)).toHaveLength(3);
  });

  it("every listed character has an entry in start_staging", () => {
    expect(checkOnScreenStaging(block())).toEqual([]);
    const b = block();
    b.start_staging = b.start_staging.filter((s) => s.character_id !== "char_3");
    expect(checkOnScreenStaging(b)[0]).toContain('"char_3"');
  });

  it("applied_rules ids exist in the bible", () => {
    const ids = bibleRuleIds(input.creative_bible);
    expect(ids.has("dr_01")).toBe(true);
    expect(checkAppliedRules(block(), ids)).toEqual([]);
    const b = block();
    b.applied_rules = ["dr_01", "zz_99"];
    expect(checkAppliedRules(b, ids)[0]).toContain("zz_99");
  });
});

describe("checkStagingContinuity", () => {
  it("continuous and hard_cut must equal the previous end_staging", () => {
    expect(checkStagingContinuity(block(1), block(0))).toEqual([]);
    const b = block(1);
    if (b.start_staging[0]) b.start_staging[0].gaze = "somewhere else";
    expect(checkStagingContinuity(b, block(0))[0]).toContain("previous block's end_staging");
    const hard = { ...b, continuity: { ...b.continuity, type: "hard_cut" as const } };
    expect(checkStagingContinuity(hard, block(0))).toHaveLength(1);
  });

  it("first and new_scene blocks are not compared; a chained block needs a previous one", () => {
    const fresh = block(2);
    expect(fresh.continuity.type).toBe("new_scene");
    expect(checkStagingContinuity(fresh, block(1))).toEqual([]);
    expect(checkStagingContinuity(block(1), null)[0]).toContain("needs a previous block");
  });
});

describe("checkScriptCoverage and checkDialogueInScript", () => {
  const script = input.script;

  it("passes the fixture's quotes", () => {
    expect(checkScriptCoverage(output.blocks, script)).toEqual([]);
  });

  it("a quote that is not in the script, or out of order, fails", () => {
    const blocks = structuredClone(output.blocks);
    if (blocks[1]) blocks[1].script_coverage.start_quote = "never written";
    expect(checkScriptCoverage(blocks, script)[0]).toContain("start_quote");

    const swapped = structuredClone(output.blocks);
    const [a, b] = [swapped[0], swapped[1]];
    if (a && b) [a.script_coverage, b.script_coverage] = [b.script_coverage, a.script_coverage];
    expect(checkScriptCoverage(swapped, script).length).toBeGreaterThan(0);
  });

  it("a skipped passage and a last block that stops early fail; scene headings do not count as a gap", () => {
    const skipped = structuredClone(output.blocks).filter((_, i) => i !== 1);
    expect(checkScriptCoverage(skipped, script).join("\n")).toContain("not covered");
    const early = structuredClone(output.blocks).slice(0, 3);
    expect(checkScriptCoverage(early, script).join("\n")).toContain("ends before the end");
    // Block 3 starts at the heading of scene 2; the heading itself is not a gap.
    expect(
      checkScriptCoverage(output.blocks.slice(2, 3), script, { first: false, last: false }),
    ).toEqual([]);
  });

  it("every dialogue line is a line of the script, ignoring case, quotes and spacing", () => {
    expect(checkDialogueInScript(block(1), script)).toEqual([]);
    const b = block(1);
    const shot = b.shots.find((s) => s.dialogue.length > 0);
    if (!shot?.dialogue[0]) throw new Error("fixture has dialogue");
    shot.dialogue[0].line = "  I AM  not hungry.";
    expect(checkDialogueInScript(b, script)).toEqual([]);
    shot.dialogue[0].line = "I am famished.";
    expect(checkDialogueInScript(b, script)[0]).toContain("famished");
  });
});

describe("checkTotals and checkPreflight", () => {
  it("deviation over 10% needs a runtime warning; the totals add up", () => {
    expect(checkTotals(output, { complete: true })).toEqual([]);
    const off = structuredClone(output);
    off.totals.deviation_pct = 12;
    expect(checkTotals(off, { complete: true })[0]).toContain("runtime");
    off.warnings.push({ type: "runtime", ref: "totals", message: "over" });
    expect(checkTotals(off, { complete: true })).toEqual([]);
    const wrong = structuredClone(output);
    wrong.totals.block_count = 3;
    wrong.totals.total_runtime_s = 45;
    expect(checkTotals(wrong, { complete: true })).toHaveLength(2);
    expect(checkTotals(wrong, { complete: false })).toEqual([]);
  });

  it("an open question must be named in a warning; dialogue_policy none needs a warning", () => {
    const bible = structuredClone(input.creative_bible);
    bible.validation_status = "needs_user_decision";
    bible.open_questions = [
      { id: "q_pace", question: "?", options: ["a", "b"], provisional_default: "a", affects: [] },
    ];
    expect(checkPreflight(output, bible, true)[0]).toContain("q_pace");
    const named: DirectorOutput = {
      ...output,
      warnings: [{ type: "open_question", ref: "q_pace", message: "default used" }],
    };
    expect(checkPreflight(named, bible, true)).toEqual([]);

    const silent = structuredClone(input.creative_bible);
    silent.project_frame.dialogue_policy = "none";
    expect(checkPreflight(output, silent, true)[0]).toContain("dialogue_policy");
    expect(checkPreflight(output, silent, false)).toEqual([]);
  });
});

describe("checkDirector wires the checks together", () => {
  it("reports a broken block with its number, and plan/write_blocks specifics", () => {
    const broken = structuredClone(output);
    const b = broken.blocks[2];
    if (!b) throw new Error("fixture");
    b.duration_s = 20;
    b.prompt_text = b.prompt_text.replace("Audio:", "Sound:");
    const errors = checkDirector(broken, input).join("\n");
    expect(errors).toContain("block 3: duration_s 20");
    expect(errors).toContain('block 3: prompt_text is missing "Audio:"');
  });

  it("write_blocks must keep the plan's bible and staging", () => {
    const plan = {
      ...output,
      blocks: output.blocks.map(({ shots, prompt_text, word_count, ...rest }) => {
        void shots;
        void prompt_text;
        void word_count;
        return rest;
      }),
    };
    const wb = directorInputSchema.parse({
      ...rawInput,
      mode: "write_blocks",
      plan,
      block_range: "3-4",
    });
    const batch = structuredClone(output);
    batch.blocks = batch.blocks.slice(2);
    expect(checkDirector(batch, wb)).toEqual([]);
    const changed = structuredClone(batch);
    if (changed.blocks[0]?.end_staging[0]) changed.blocks[0].end_staging[0].posture = "kneeling";
    expect(checkDirector(changed, wb).join("\n")).toContain(
      "planned start_staging and end_staging",
    );
    const wrongRange = structuredClone(batch);
    wrongRange.blocks = wrongRange.blocks.slice(1);
    expect(checkDirector(wrongRange, wb).join("\n")).toContain("exactly the blocks 3 to 4");
    const newBible = structuredClone(batch);
    newBible.continuity_bible.style_line = "changed";
    expect(checkDirector(newBible, wb).join("\n")).toContain("continuity_bible of the plan");
  });
});

describe("the shared window rule", () => {
  const shot = block().shots[0];
  if (!shot) throw new Error("fixture");
  const win = (window: string, n: number) => ({ ...shot, window, shot_number: n });
  const make = (windows: [string, number][], prompt: string, duration = 15) => ({
    block_id: 1,
    duration_s: duration,
    prompt_text: prompt,
    shots: windows.map(([w, n]) => win(w, n)),
  });

  it("a one-shot 15 s block in three 5 s windows passes, with no Cut to", () => {
    const b = make(
      [
        ["0-5s", 1],
        ["5-10s", 1],
        ["10-15s", 1],
      ],
      "[0-5s] Shot 1 — a. [5-10s] b. [10-15s] c.",
    );
    expect(checkShotWindows(b)).toEqual([]);
    expect(checkShotBudget({ ...block(), ...b, budgets: block().budgets })).toEqual([]);
  });

  it("budgets count distinct shots, not windows", () => {
    const b = make(
      [
        ["0-3s", 1],
        ["3-6s", 1],
        ["6-9s", 2],
        ["9-12s", 2],
        ["12-15s", 3],
      ],
      "Shot 1 Cut to Shot 2 Cut to Shot 3",
    );
    expect(checkShotWindows(b)).toEqual([]);
    expect(checkShotBudget({ ...block(), ...b, budgets: block().budgets })).toEqual([]);
  });

  it("a 7 s window fails, and so does a 1 s window", () => {
    expect(
      checkShotWindows(
        make(
          [
            ["0-7s", 1],
            ["7-15s", 1],
          ],
          "",
        ),
      ).join(" "),
    ).toContain("maximum is 6 s");
    expect(
      checkShotWindows(
        make(
          [
            ["0-1s", 1],
            ["1-15s", 1],
          ],
          "",
        ),
      ).join(" "),
    ).toContain("minimum is 2 s");
  });

  it("shot numbers may not skip, repeat out of order, or start above 1", () => {
    expect(
      checkShotWindows(
        make(
          [
            ["0-5s", 1],
            ["5-10s", 3],
            ["10-15s", 3],
          ],
          "Cut to Shot 3",
        ),
      ).join(" "),
    ).toContain("shot_number 3");
    expect(
      checkShotWindows(
        make(
          [
            ["0-5s", 2],
            ["5-10s", 2],
            ["10-15s", 2],
          ],
          "",
        ),
      ).join(" "),
    ).toContain("must be 1");
    expect(
      checkShotWindows(
        make(
          [
            ["0-5s", 1],
            ["5-10s", 2],
            ["10-15s", 1],
          ],
          "Cut to Shot 2",
        ),
      ).join(" "),
    ).toContain("shot_number 1");
  });

  it("the Cut to wording must match the shot changes", () => {
    const windows: [string, number][] = [
      ["0-5s", 1],
      ["5-10s", 2],
      ["10-15s", 2],
    ];
    expect(checkShotWindows(make(windows, "Shot 1. Cut to Shot 2. continued"))).toEqual([]);
    expect(checkShotWindows(make(windows, "Shot 1. Shot 2.")).join(" ")).toContain(
      '"Cut to Shot 2" 0 times',
    );
    expect(checkShotWindows(make(windows, "Cut to Shot 2. Cut to Shot 2.")).join(" ")).toContain(
      "2 times",
    );
    expect(checkShotWindows(make(windows, "Cut to Shot 2. Cut to Shot 3.")).join(" ")).toContain(
      "Cut to Shot 3",
    );
    // A continuation window written with "Cut to" repeats the number: wrong.
    expect(
      checkShotWindows(
        make(
          [
            ["0-5s", 1],
            ["5-10s", 1],
            ["10-15s", 1],
          ],
          "Cut to Shot 1",
        ),
      ).join(" "),
    ).toContain("Cut to Shot 1");
  });
});

describe("checkShotPlanFollowed (craft pipeline)", () => {
  const shotOf = (window: string, shot_number: number) => ({
    ...block(0).shots[0]!,
    window,
    shot_number,
  });
  const planned = {
    shots: [
      { shot_id: "s4", windows: [{ from_s: 0, to_s: 5 }] },
      {
        shot_id: "s5",
        windows: [
          { from_s: 5, to_s: 10 },
          { from_s: 10, to_s: 15 },
        ],
      },
    ],
  };
  const make = (shots: Block["shots"]) => ({ block_id: 2, shots });

  it("passes when the windows and shot numbers are the plan's, exactly", () => {
    expect(
      checkShotPlanFollowed(
        make([shotOf("0-5s", 1), shotOf("5-10s", 2), shotOf("10-15s", 2)]),
        planned,
      ),
    ).toEqual([]);
  });

  it("fails on a moved boundary, a wrong shot number, a missing window or a missing plan", () => {
    expect(
      checkShotPlanFollowed(
        make([shotOf("0-6s", 1), shotOf("6-10s", 2), shotOf("10-15s", 2)]),
        planned,
      ).join(" "),
    ).toContain('must be "0-5s"');
    expect(
      checkShotPlanFollowed(
        make([shotOf("0-5s", 1), shotOf("5-10s", 2), shotOf("10-15s", 3)]),
        planned,
      ).join(" "),
    ).toContain("shot_number must be 2");
    expect(
      checkShotPlanFollowed(make([shotOf("0-5s", 1), shotOf("5-15s", 2)]), planned).join(" "),
    ).toContain("3 windows");
    expect(checkShotPlanFollowed(make([shotOf("0-15s", 1)]), undefined)).toEqual([
      "block 2: the shot plan has no entry for this block",
    ]);
  });
});
