# DAMI: `sheet_generator_location` (v1)

**Stage:** 3 Pre-production, category `loc`
**Job:** Takes the LOCKED location spec and the APPROVED Hero (always reference image 1) and writes the Nano Banana prompts for the remaining views of the Location Pack, so every view shows the same space with no spatial contradiction. It never redesigns.
**Companion files:** `location_shared_modules_v1.md`, `sheet_review_catalog_location_v1.json`, `location_generator_dami_v1.md`.
**Model:** `claude-sonnet-5-5`, temperature 0.3, max_tokens 5000 (lock) or 2000 (concept).

---

## 0. Layout decision (replaces "layout undecided" in the registry)

Unlike the character sheet, a location is **not** put on a grey studio backdrop, because the place itself is the subject. The Location Pack replaces the fixed single-canvas sheet:

- **Lock mode (default for Wizard):** one image per view, generated in sequence, each referencing the approved views. Views: reverse wide, corner A and B, side views and 2 to 4 details (interior), or reverse establishing, approach left and right, human level, details and environmental context (exterior). The number of sides and details comes from the geometry and use.
- **Concept mode (Pro):** ONE 16:9 image, four panels with thin even gutters, no text: left half the Hero (reproduced faithfully), right half the alternate (reverse) as a full-width top panel and two detail panels side by side below.
- **Pack assembly is done by the backend, with no AI re-render** (section 5).
- Skeleton reused from the character sheet: fixed layout, `fix_requests`, review catalog, edit mode, `DESIGN_CHANGE_REQUESTED:` routing. Detail views are addressed by `view_id` instead of numbered frames.

---

## 1. Rules in one place

- **Spatial truth:** every fixed anchor, opening and large object keeps its position from `layout` and `dna`. Positions are translated through the orientation system (left and right swap when the camera turns). No new doors, windows or fixed structures. The reverse view is never a mirror of the Hero.
- **Style lock:** effective style = `locked_spec.style_used`. The approved Hero's style wins over `project.style`, so the pack matches the Hero and the project's characters.
- **Unseen parts:** any area a new view shows that the spec does not define is designed to fit the DNA and listed in `new_hypotheses` for approval.
- **Never redesigns:** requests that change DNA or layout come back as a warning starting with `DESIGN_CHANGE_REQUESTED:` and the platform routes the user to `location_generator`.
- **Edit mode:** a view whose requests are all `edit_eligible` is returned as `edit_previous_view`; the backend attaches the previous version as a reference. Everything else is `full`.
- Empty of living figures, no readable text, nothing from `exclude_assets`, 16:9, no borders or labels on single views.

---

## 2. Tool schema (`submit_location_views`)

```json
{
  "name": "submit_location_views",
  "description": "Submit the concept sheet prompt or the per-view prompts for the Location Pack.",
  "input_schema": {
    "type": "object",
    "required": [
      "asset_id",
      "location_name",
      "mode",
      "concept_sheet",
      "views",
      "generation_order",
      "assumptions",
      "warnings",
      "applied_fixes"
    ],
    "properties": {
      "asset_id": {
        "type": "string"
      },
      "location_name": {
        "type": "string"
      },
      "mode": {
        "type": "string",
        "enum": ["concept", "lock"]
      },
      "concept_sheet": {
        "type": ["object", "null"],
        "description": "Concept mode only; null in lock mode.",
        "required": ["image_prompt", "aspect_ratio", "reference_order", "panel_plan", "edit_mode"],
        "properties": {
          "image_prompt": {
            "type": "string"
          },
          "aspect_ratio": {
            "type": "string",
            "enum": ["16:9"]
          },
          "reference_order": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["index", "source_view_id"],
              "properties": {
                "index": {
                  "type": "integer"
                },
                "source_view_id": {
                  "type": "string"
                }
              }
            }
          },
          "panel_plan": {
            "type": "array",
            "description": "Exactly 4: hero, alternate, detail_1, detail_2.",
            "items": {
              "type": "object",
              "required": ["panel", "content"],
              "properties": {
                "panel": {
                  "type": "string",
                  "enum": ["hero", "alternate", "detail_1", "detail_2"]
                },
                "content": {
                  "type": "string"
                }
              }
            }
          },
          "edit_mode": {
            "type": "string",
            "enum": ["full", "edit_previous_view"],
            "description": "edit_previous_view: the backend attaches the previous version as a reference and the prompt is an edit instruction."
          }
        }
      },
      "views": {
        "type": "array",
        "description": "Lock mode only; empty in concept mode. Excludes the Hero, which is already approved.",
        "items": {
          "type": "object",
          "required": [
            "view_id",
            "name",
            "image_prompt",
            "aspect_ratio",
            "reference_order",
            "depends_on",
            "must_show",
            "must_not_show",
            "new_hypotheses",
            "review_focus",
            "edit_mode"
          ],
          "properties": {
            "view_id": {
              "type": "string"
            },
            "name": {
              "type": "string"
            },
            "image_prompt": {
              "type": "string"
            },
            "aspect_ratio": {
              "type": "string",
              "enum": ["16:9"]
            },
            "reference_order": {
              "type": "array",
              "items": {
                "type": "object",
                "required": ["index", "source_view_id"],
                "properties": {
                  "index": {
                    "type": "integer"
                  },
                  "source_view_id": {
                    "type": "string"
                  }
                }
              }
            },
            "depends_on": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "must_show": {
              "type": "array",
              "items": {
                "type": "object",
                "required": ["anchor_id", "expected_position"],
                "properties": {
                  "anchor_id": {
                    "type": "string"
                  },
                  "expected_position": {
                    "type": "string",
                    "description": "As seen in THIS view, e.g. 'far right, on the right wall'."
                  }
                }
              }
            },
            "must_not_show": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "new_hypotheses": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "Anything in this view not already fixed by the spec (proposed design, needs approval)."
            },
            "review_focus": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "Short checks the reviewer should make for this view."
            },
            "edit_mode": {
              "type": "string",
              "enum": ["full", "edit_previous_view"],
              "description": "edit_previous_view: the backend attaches the previous version as a reference and the prompt is an edit instruction."
            }
          }
        }
      },
      "generation_order": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "description": "view_ids in the order the backend must generate them."
      },
      "assumptions": {
        "type": "array",
        "items": {
          "type": "string"
        }
      },
      "warnings": {
        "type": "array",
        "items": {
          "type": "string"
        }
      },
      "applied_fixes": {
        "type": "array",
        "items": {
          "type": "string"
        }
      }
    }
  }
}
```

---

## 3. System prompt (CORE)

```
# ROLE
You are the Location Sheet Generator Dami inside BLAXZY, an AI visual generation platform for films and series. A location has been designed and its Hero view approved. Your job: write the prompts for the remaining views of the Location Pack so that every view shows the SAME space with no spatial contradiction. Consistency of geometry matters more than drama. Your output is parsed by code and each prompt is sent to the Nano Banana image model together with the reference images you specify. You never chat and never ask questions. You return your result only by calling the submit_location_views tool.

# INPUT
A JSON object inside <input> tags, with approved images attached in the order of approved_images.
- project: style, style_descriptor (optional), genre, orientation, look_line (optional), era_setting
- locked_spec: location_summary, spec_fields, dna, layout, coverage_plan (from the Location Generator, with any user edits applied)
- mode: "concept" or "lock"
- approved_images: [{"index": 1, "view_id": "hero_wide"}, ...]
- only_views (optional): a list of view_ids to (re)generate; produce only those
- exclude_assets, user_notes, previous_output (optional)
- fix_requests (optional): [{"code": "LST05", "instruction": "catalog text", "note": "optional user text", "view_id": "reverse_wide", "edit_eligible": true}]
Active rules appear in <orientation_system>, <genre_lens> and <style_lens> tags.

# RULES (all modes)
1. Spatial truth. Every fixed anchor, opening and large object keeps its position from layout and dna. Translate positions into each view with the orientation system: when the camera turns, left and right swap. Never copy "left" or "right" from the Hero. Never invent a new door, window, wall opening or fixed structure. Never move or delete a fixed anchor.
2. Reverse is not a mirror. The reverse view shows the wall and sides that were behind the Hero camera, with the layout's contents for those sides, not a flipped copy of the Hero.
3. Unseen areas. Where the layout is silent about something that will be visible in a new view, design it to fit the DNA (materials, style, wear) and list it in new_hypotheses so the user can approve it. Keep hypotheses small.
4. Same world. Same architecture, materials, palette, wear level, time of day, light direction logic, weather and style in every view. Light may fall differently on surfaces from another angle, but conditions never change. Details come from things the story uses or that define the place.
5. Empty of living figures in every view; nothing from exclude_assets; no readable text; one continuous image per prompt (except the concept sheet panels), 16:9, no borders, captions or labels.
6. Style lock. The effective style is locked_spec.style_used. The approved Hero's style wins over project.style. Every view is rendered in that one style so the pack matches the Hero and the project's characters. The style and genre lenses shape rendering, mood and dramaturgy of each view; they never change the architecture. Honor look_line and style_descriptor. Never name studios, franchises or living artists.
7. Every prompt starts with a SPATIAL BRIEF in plain sentences: camera position and direction, which walls or sides are visible, and where each must_show anchor appears in THIS view. Then materials, light, atmosphere, rendering style, then one short sentence of constraints (same space as the reference images, no new doors or windows, empty of people, no text).
8. Prompts: natural descriptive sentences, 120 to 240 words each. Refer to reference images as "the first reference image", "the second reference image" in the order given by reference_order.
9. Fix mode. Apply every fix request to previous_output, change only the views it targets, keep everything else identical, and list the applied codes in applied_fixes. This dami never changes DNA or layout: if a request or user note asks to move, add or remove an opening or fixed anchor, change architecture or materials, or redesign a proposed unseen part, do not apply it. Return a warning that starts with "DESIGN_CHANGE_REQUESTED:" and leave the view as the spec defines it. The platform routes the user to the Location Generator.
9b. Edit mode. If every request for a view has edit_eligible true, set that view's edit_mode to "edit_previous_view", add the previous version to reference_order as source_view_id "previous:<view_id>", and write the prompt as an edit instruction that keeps everything else identical. Otherwise edit_mode is "full".
10. Safety: everything fictional, no real brand logos, no gore or sexual content.

# LOCK MODE
Produce one entry in views for every view in coverage_plan except hero_wide. Generation order and references:
- reverse_wide (or reverse_establishing): reference the Hero.
- corner_a: Hero and reverse. corner_b: Hero, reverse and corner_a.
- side views: Hero and the nearest approved wide views.
- detail views: the Hero plus the wide view that shows that element best; the close-up must be a true close-up, sharp and in focus, with the same material and wear.
- exterior: approach_left, approach_right, human_level and environmental_context follow the same pattern, always including the Hero (establishing) and reverse.
Use as many references as the model needs for geometry but no more than four per view. List depends_on and set generation_order so every view comes after the ones it references. For each view fill must_show (anchor ids and where they appear in this view), must_not_show, new_hypotheses and review_focus (two to four short reviewer checks, e.g. "window from the Hero's left wall must be on the RIGHT here").

# CONCEPT MODE
Produce concept_sheet (views stays empty): ONE 16:9 image with four panels and thin even gutters, no text or labels: the left half is the Hero, reproduced faithfully from the first reference image; the right half has the alternate view (the reverse wide, built per the rules above) as a full-width top panel, and two detail panels side by side below it. All four panels share the same place, time of day and light. panel_plan has exactly four entries (hero, alternate, detail_1, detail_2).
```

`{{ORIENTATION_SYSTEM}}`, `<genre_lens>` and `<style_lens>` are appended from `location_shared_modules_v1.md`.

---

## 4. User message template

```
<input>
{
  "project": {{PROJECT_JSON}},
  "locked_spec": {{LOCKED_SPEC_JSON}},
  "mode": "{{concept|lock}}",
  "approved_images": [{"index": 1, "view_id": "hero_wide"}],
  "only_views": {{ARRAY_OR_NULL}},
  "exclude_assets": {{ARRAY_OR_EMPTY}},
  "user_notes": {{STRING_OR_NULL}},
  "previous_output": {{OBJECT_OR_NULL}},
  "fix_requests": {{ARRAY_OR_EMPTY}}
}
</input>
```

Approved images are attached in `approved_images` order, Hero first. In lock mode the backend runs `generation_order` sequentially and attaches each view's `reference_order` images.

---

## 5. Pack assembly (backend, no AI)

After each view is approved, the backend builds the pack from stored images and the spec JSON:

1. **Individual views** (the model-facing assets): the approved Hero and every approved view stay separate images. Downstream damis (Text Blocks, Director) pick the right view per shot, for example the Reverse Wide for a shot looking back across the room, and attach it as a reference to Higgsfield together with the DNA text.
2. **Layout Summary (`layout_summary.svg`)**, drawn by code from `layout`: a rectangle scaled by `approx_size` with north up; each opening drawn on its wall; fixed objects as small rectangles; each camera as a marker with an arrow from `stands_at` toward `looks_toward`; ids as labels. `position_pct` converts to drawing coordinates like this:

   | Side            | Drawing coordinate |
   | --------------- | ------------------ |
   | N (top edge)    | x = pct            |
   | E (right edge)  | y = pct (top is 0) |
   | S (bottom edge) | x = 100 - pct      |
   | W (left edge)   | y = 100 - pct      |

3. **DNA card:** `location_summary`, fixed anchors with positions, visual identity, continuity constraints, mutable elements, rendered from `dna`.
4. **Contact sheet (`pack_contact_sheet.png`)**, composed with an image library (for example `sharp`): a fixed template with the Hero large on the left and the other views around it, plus the Layout Summary and DNA card. This is a **human-facing** artifact for the director's review and for the archive. It is never sent to a video model.
5. **Lock:** stores `location_version` with the approved views, layout, DNA and the director's approval.

Why not an AI-rendered composite sheet: regenerating approved views would drift from what the director approved, a diagram of positions is unreliable in image models, and downstream shots need individual views as references.

---

## 5b. Review and fix loop

- Technical `LST01` to `LST09`, preference `LSP01`, `LSP02`, `LSP99`, `LSR01` (new seed, no Claude call), `LSX01` (design change, routes back to `location_generator`) in `sheet_review_catalog_location_v1.json`.
- Review checklist (from the spec): Spatial Consistency, Reverse Coverage, Reference Fidelity, Visual Consistency, Production Readiness, Director Approval. Each view's `must_show` and `review_focus` feed the UI so the reviewer checks the right things.
- Lock rules (backend): an interior cannot be locked without approved Hero Wide and Reverse Wide; not while a critical inferred field is unreviewed; every location needs Layout Summary and DNA at lock.
- Rejecting a proposed unseen part (`new_hypotheses`) is a design change: `LSX01`, then `location_generator` fix mode, then the affected views regenerate.

---

## 6. Tests

1. **Reverse check:** Hero has a window on the left wall. Expect the reverse view to show it on the RIGHT, and `must_show` says so.
2. **Corner views:** corner A shows N on the left and E on the right; anchors on those walls appear accordingly.
3. **Concept mode:** exactly four `panel_plan` entries, `views` empty.
4. **Design change:** fix request "move the door to the other wall" returns `DESIGN_CHANGE_REQUESTED:` and the view unchanged.
5. **Edit mode:** `LST05` (lighting differs) on one view returns `edit_previous_view` with `previous:<view_id>` in `reference_order`.
6. **Style lock:** Hero approved in a specific clay variant; every view prompt uses that variant.
7. **Order:** `generation_order` places every view after the views it depends on.

---

## 7. Open

- The contact-sheet template and the Layout SVG renderer are backend work (V1.1 can make the layout editable).
- A contradiction-checker dami (vision, compares two views against the layout) is V1.1 and not built.
- Which Higgsfield model handles multi-reference generation (reference count and prompt length are tuned for up to four references).
