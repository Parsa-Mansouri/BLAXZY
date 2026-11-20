# BREAKDOWN — Shot-to-Unit Packer (code stage, not an LLM dami)
# BLAXZY Wizard · v1.0 · depends on: output_22_dir (DIRECTOR v2.0), platform_config
# Pipeline position: script → DIRECTOR → CINEMATOGRAPHER → [BREAKDOWN] → PROMPTER → output_22
# Output = output_22_brk. Deterministic TypeScript in src/server/damis/breakdown/ (no Claude call).
# Runs after DIRECTOR (it does not need CINEMATOGRAPHER; both may run in parallel).
# Re-run: whenever DIRECTOR's shots change, or the user changes delivery_mode.

## 1. Why this is code

Grouping shots into Seedance generations is arithmetic under rules: durations must sum
exactly, dialogue and events must fit budgets, boundaries must fall where DIRECTOR allowed.
A language model does this unreliably and expensively; code does it exactly and can prove it.
The creative part (how long a moment plays, where it may break) was already decided by
DIRECTOR as duration ranges and break quality. When no honest packing exists, BREAKDOWN does
not improvise: it sends a precise `repair` request back to DIRECTOR.

## 2. Inputs

```ts
type BreakdownInput = {
  delivery_mode: "block_15" | "block_30" | "block_auto" | "shot";
  platform: {
    block_length_options_sec: number[];          // [15, 30]
    speech_rate_wps: Record<string, number>;      // per language
    max_events_per_block: Record<"15" | "30", number>;   // { "15": 2, "30": 4 }
    unit_min_s: number;                           // shortest generation, default 4
    unit_max_s: number;                           // longest generation, 30
    shot_budget: { standard: Record<"15"|"30", number>,  // { 15: 3, 30: 5 }
                   rapid_cut: Record<"15"|"30", number> }; // { 15: 5, 30: 10 }
    runtime_tolerance_pct: number;                // 10
    max_repair_rounds: number;                    // 2
  };
  script_language: string;
  target_runtime_s: number;
  director: DirectorOutputV2;                     // output_22_dir (shots, scene_plan, staging)
};
```

## 3. Validation (before packing)

Reject with `status: "invalid_input"` and an error list if any of these fail (they mean the
DIRECTOR validator was skipped):
- shots ordered and contiguous; every shot has integer `min_s ≤ ideal_s ≤ max_s`.
- `max_s ≤ L_max` (15 for block_15, otherwise 30).
- `spoken_words` present on every shot.

## 4. Scene runs and hard boundaries

Split the shot list into **runs**. A run ends after a shot whose `transition_after` is
`scene_change` or `end`. `time_jump` does NOT end a run (same scene), but its boundary is
treated as `strong`.

A unit never crosses a run boundary, except the **merge rule** (block modes only):
a run whose `Σ ideal_s < 8` and whose scene has `merge_ok_with_next: true` may be packed together
with the following run as one unit, if the result touches at most 2 locations. The joined
boundary becomes an in-unit cut and the unit gets a warning `merged_scenes`.

## 5. Delivery mode "shot"

Every shot is one unit.

```
use_s      = ideal_s
generate_s = max(ideal_s, unit_min_s)
trim       = generate_s > use_s ? shot.trim_anchor : null      // "head" | "tail" | "center"
```

- If `generate_s > use_s` and `trim_anchor` is null → warning `trim_anchor_missing`, use "center".
- Runtime counts `use_s`. Seedance generates `generate_s`; the editor (or ffmpeg step) trims
  to `use_s` using the anchor.
- Shot mode ignores `break_quality_after` for grouping, but a boundary marked `never` produces
  a warning `split_never_boundary` (a match cut generated separately rarely matches).

## 6. Delivery modes "block_15", "block_30", "block_auto"

Allowed unit lengths: `Ls = [15]`, `[30]`, or `[15, 30]`.

### 6.1 Candidate unit

A run's shots `i..j` with length `L ∈ Ls` are a **feasible unit** when all hold:

1. `Σ min_s(i..j) ≤ L ≤ Σ max_s(i..j)`
2. `break_quality_after(j) ≠ "never"`, or `j` is the last shot of the run.
3. `Σ events(i..j) ≤ max_events_per_block[L]`
4. `Σ spoken_words(i..j) ≤ floor(0.7 × L × wps)`
5. shot count `(j − i + 1) ≤ shot_budget[rapid ? "rapid_cut" : "standard"][L]`,
   where `rapid` = any shot in `i..j` has `rapid_cut: true`.
   Shots joined by `transition_after: "continuous"` count as ONE shot (no cut between them).

### 6.2 Cost

```
cost(unit) =   1.0 × |L − Σ ideal_s(i..j)|                      // stay near the director's timing
             + boundaryPenalty(break_quality_after(j))           // strong 0, ok 2, weak 6
             + 0.5                                               // per unit: prefer fewer cuts between generations
             + (L === 30 && Σ events(i..j) ≤ 1 && Σ spoken_words(i..j) === 0 ? 3 : 0)  // auto: thin 30s
```
The last shot of a run has boundary penalty 0.

### 6.3 Search

Dynamic programming per run, over start index:

```
best[n] = 0                                   // n = number of shots in the run
best[i] = min over feasible (i..j, L) of cost(i..j, L) + best[j+1]
```
Run size is small (tens of shots), so O(n² · |Ls|) is fine. Tie-break: fewer units, then
earlier strong boundaries.

If `best[0]` is infinite → the run has **no fit** → section 8.

### 6.4 Duration assignment inside a unit

Start from `ideal_s`; distribute `delta = L − Σ ideal_s` over the shots:
- `delta > 0`: capacity per shot `max_s − ideal_s`; `delta < 0`: capacity `ideal_s − min_s`.
- Give each shot `delta × capacity / Σ capacity`, then round with the largest-remainder method
  so the integers sum exactly to `L`. Prefer shots with non-empty `flex_content` on ties.
- Assert every shot stays inside `[min_s, max_s]`.

Then build continuous windows: shot k occupies `[t_k, t_k + d_k)` from 0 to L.

## 7. Unit hand-off data

For every unit (any mode):

| field | value |
|---|---|
| `start_staging_id` | first shot's `staging_start_id` |
| `end_staging_id` | last shot's `staging_end_id` |
| `opening_frame` | first shot's `state_at_start` |
| `in_progress_at_end` | last shot's `in_progress_at_end` |
| `continuity.type` | `"first"` for unit 1; else from the previous unit's last shot `transition_after`: `continuous` → `"continuous"`, `cut` → `"hard_cut"`, `time_jump` → `"time_jump"`, `scene_change` → `"new_scene"` |
| `continuity.use_last_frame_as_start` | `true` ONLY for `"continuous"` (same camera setup, no cut). A cut changes the angle, so the previous last frame must never be fed as the start image of a cut. |
| `light_ids` | filled later by the assembler from CINEMATOGRAPHER output |

## 8. No fit → repair request

When a run has no feasible packing, compute:

```
sum_min = Σ min_s, sum_max = Σ max_s
targets = sums of allowed unit lengths reachable near [sum_min, sum_max]   // e.g. 30, 45
need    = sum_max < nearest target ? "add" : "remove"
```

and send DIRECTOR (mode `repair`):

```json
{ "scene_id": "sc_4", "problem": "no_fit|events_overflow|dialogue_overflow|shot_budget|never_chain",
  "sum_min_s": 34, "sum_max_s": 37, "need": "add", "target_options_s": [30, 45],
  "note": "Shots sh_0040–sh_0043 are joined by 'never' boundaries and exceed 30 s together." }
```

Repair loop: re-validate the repaired shots, re-pack the affected runs only. After
`max_repair_rounds` without a fit, apply the **fallback** and warn:
1. block_auto: allow the other length for that unit even at higher cost.
2. Stretch: allow up to +2 s beyond `max_s` on shots with non-empty `flex_content`
   (warning `stretched`, listed per shot).
3. Still nothing: mark the run `needs_user_decision` and stop that run; the UI shows it.
Never cut a dialogue line, never drop a shot, never move a shot into another scene.

## 9. Runtime check

`total_runtime_s = Σ unit duration (use_s in shot mode)`. If
`|total − target| / target > runtime_tolerance_pct` → warning `runtime`.

## 10. Output (output_22_brk)

```json
{
  "stage": "breakdown",
  "version": "1.0",
  "status": "ok|ok_with_warnings|needs_repair|needs_user_decision|invalid_input",
  "delivery_mode": "block_15|block_30|block_auto|shot",
  "units": [{
    "unit_id": 1,
    "unit_type": "block|shot",
    "duration_s": 15,
    "generate_s": 15,
    "trim": null,
    "scene_ids": ["sc_1"],
    "location_ids": ["loc_1"],
    "shots": [{ "shot_id": "sh_0001", "window": "0-5s", "start_s": 0, "end_s": 5,
                "duration_s": 5, "cut_in": "first|cut|no_cut|scene_cut" }],
    "start_staging_id": "", "end_staging_id": "",
    "opening_frame": "", "in_progress_at_end": "",
    "continuity": { "type": "first|continuous|hard_cut|time_jump|new_scene",
                    "use_last_frame_as_start": false },
    "budgets": { "spoken_words": 0, "spoken_words_max": 0, "events": 0,
                 "events_max": 0, "shot_budget": "standard|rapid_cut", "shots_counted": 0 },
    "warnings": []
  }],
  "repair_requests": [],
  "totals": { "unit_count": 0, "count_15": 0, "count_30": 0, "count_shot": 0,
              "total_runtime_s": 0, "target_runtime_s": 0, "deviation_pct": 0 },
  "warnings": [{ "type": "merged_scenes|stretched|trim_anchor_missing|split_never_boundary|runtime|other",
                 "ref": "", "message": "" }]
}
```

`cut_in` tells PROMPTER how to open each shot line: `first` (unit start), `cut` ("Cut to Shot N"),
`no_cut` (previous shot was `continuous`), `scene_cut` (merged scene inside one unit).

In shot mode a unit has one shot; `duration_s = use_s`, `generate_s ≥ duration_s`, and the
shot's window is computed on `generate_s` (PROMPTER writes for the generated length).

## 11. Tests (fixtures in breakdown/fixtures/)

- exact fit: one scene, ideals summing to 30 in block_30 → one unit, durations unchanged.
- stretch: ideals 26, maxes allow 30 → one 30 s unit, extra seconds only on flex shots.
- never chain: three shots joined by `never` totalling 18 s in block_15 → repair request.
- auto choice: 22 s of content with a strong break at 14 s → two 15 s units vs one 30 s;
  check cost picks the closer fit.
- events overflow: three events in 15 s → split or repair.
- merge rule: 6 s scene with merge_ok_with_next + 24 s scene → one 30 s unit, ≤ 2 locations.
- shot mode trim: 2 s rapid shot, unit_min_s 4 → generate 4, use 2, anchor kept.
- continuity: continuous boundary → use_last_frame_as_start true; cut → false.
- property test: for random valid inputs, every unit sums exactly, every shot within range,
  every dialogue line in exactly one unit, units in order.
