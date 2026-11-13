# DAMI: `location_generator` (v1)

**Stage:** 3 Pre-production, category `loc`
**Job:** Takes the user's input for ONE location (own prompt, guided answers, reference images, or nothing), the script slice where the location appears, and the project's style and genre. Returns a structured Location Specification (every field Confirmed, Inferred or Unknown), Location DNA, a Layout on a shared compass, a Coverage Plan, and the Hero view prompt for Nano Banana.
**Basis:** `Blackeiz_Location_Generator_Product_Spec_V1.docx` ("space first, image second").
**Companion files:** `location_shared_modules_v1.md` (orientation + lenses), `location_review_catalog_v1.json`, `sheet_generator_location_v1.md`.
**Model:** `claude-sonnet-5-5` (escalate to `claude-opus-5-5` only if spec quality is weak in tests).

---

## 0. Pipeline position

```
INPUT: user prompt | guided answers | reference image(s) | nothing ("Design it for me")
       + script slice for this location + project style and genre
                          |
                  [location_generator]
          analysis -> Spec -> DNA -> Layout -> Coverage Plan -> Hero prompt
                          |
        Nano Banana: Hero view   (or the uploaded image IS the Hero)
                          |
     user review: Hero + Spec card (inferred critical fields highlighted)
        reject -> fix_requests -> location_generator (fix mode)
                          |
                    APPROVED HERO -> sheet_generator_location
```

An uploaded image enters here (`reference_only` or `prompt_reference`): the dami reads it, builds the spec (visible = confirmed, unseen = inferred), and the image becomes the Hero (`use_uploaded`) or is restyled to the project style (`restyle_uploaded`).

---

## 1. Settings

| Setting     | Value                                                       | Why                                           |
| ----------- | ----------------------------------------------------------- | --------------------------------------------- |
| Output      | Forced tool call `submit_location_spec`                     | Parseable JSON, analysis fields come first    |
| Temperature | 0.5 first run, 0.3 fix mode                                 | Creative gap-filling, then conservative edits |
| max_tokens  | 6000                                                        | Spec + layout + prompt are long               |
| Retry       | One retry on tool failure, then a generic error             | User never sees raw output                    |
| Assembly    | `SYSTEM = CORE + ORIENTATION + <genre_lens> + <style_lens>` | See `location_shared_modules_v1.md`           |

---

## 2. Decisions

- **Source priority (strict):** (1) the user's explicit input; (2) script-required facts, which add to the user's input and never overwrite it; (3) narrative design from the dramatic core; (4) genre lens and style lens; (5) defaults. User vs script on a fact: follow the user, add a warning.
- **Genre and style are a design lens for space** (not only mood). Genre shapes spatial dramaturgy and mood; style shapes design vocabulary, materials, light, rendering. Style wins on look, genre wins on layout.
- **Narrative-driven design:** the dami analyzes the script slice first (events, location role, spatial demands, movement paths, emotional arc, mood target) and designs physical space to meet those demands. It never adds plot, characters or events.
- **Truth status:** every spec field is `confirmed` (user, reference or script) or `inferred` (designed by the dami) or `unknown`. Critical fields (geometry, openings, fixed anchors) that were inferred must be reviewed by the user before Lock. "Let Blaxzy decide" is always allowed, but it does not skip that review.
- **Style lock:** same rule as the Character Generator v5. Effective style = `style_override` else `project.style` plus `project.style_descriptor` (verbatim). The dami returns `style_used` and `style_source`. The backend stores the project's `style_descriptor` from the characters and sends it for locations, so all assets match. Wizard: style locked, never `style_override`. Pro: may send `style_override`.
- **Orientation system:** one compass for all views. Hero camera stands S, looks N. Left and right swap when the camera turns. Defined in the shared modules.
- **Output mode:** Wizard always sends `output_mode: "lock"`. Pro chooses `concept` or `lock`.
- **Coverage count:** the dami decides the number of side views and details from the geometry and use (spec: "as needed", 2 to 4 details).
- **Hero frame:** ONE continuous 16:9 image, empty of living figures, no panels or text, nothing from `exclude_assets`.

---

## 3. Wizard (the spec's 10 questions, with skip logic)

Skip logic is deterministic backend code, no extra LLM call. Every question allows "Let Blaxzy decide" (`"ai_decides"`). Wizard users also get one button, **"Design it for me"**, which sends no user input and runs `auto` mode.

| #   | id                   | Question                                                          | Rule                                                  |
| --- | -------------------- | ----------------------------------------------------------------- | ----------------------------------------------------- |
| 01  | `what_is_it`         | What is this space?                                               | Skip: output_21 name and script description           |
| 02  | `interior_exterior`  | Inside or outside?                                                | Skip: INT./EXT. in the script heading                 |
| 03  | `narrative_function` | What does it do in the story?                                     | Skip when a script slice exists (derived by the dami) |
| 04  | `era_world`          | Era or world?                                                     | Skip: project era_setting                             |
| 05  | `design_language`    | Overall design language?                                          | Skip: project genre and style                         |
| 06  | `shape_size`         | Shape and rough size                                              | **Ask**                                               |
| 07  | `fixed_elements`     | Doors, windows, elements that must stay fixed; anything forbidden | **Ask**, optional                                     |
| 08  | `materials_colors`   | Dominant materials and colors                                     | **Ask**                                               |
| 09  | `light_atmosphere`   | Base light and atmosphere (time of day prefilled)                 | **Ask**                                               |
| 10  | `output_mode`        | Quick concept or full production pack                             | Wizard: not asked (lock). Pro: asked                  |

The backend sends the answers as `guided_answers` keyed by id. This dami consumes them directly, so the separate "Guided-questions asset describer" is not needed for locations.

---

## 4. Tool schema (`submit_location_spec`)

```json
{
  "name": "submit_location_spec",
  "description": "Submit the analysis, location specification, DNA, layout, coverage plan and Hero prompt.",
  "input_schema": {
    "type": "object",
    "required": [
      "asset_id",
      "location_name",
      "source_mode",
      "narrative_analysis",
      "spec_fields",
      "dna",
      "layout",
      "coverage_plan",
      "hero_wide",
      "location_summary",
      "assumptions",
      "warnings",
      "style_used",
      "style_source",
      "applied_fixes"
    ],
    "properties": {
      "asset_id": {
        "type": "string"
      },
      "location_name": {
        "type": "string"
      },
      "source_mode": {
        "type": "string",
        "enum": ["auto", "prompt_only", "prompt_reference", "reference_only"]
      },
      "narrative_analysis": {
        "type": "object",
        "required": [
          "dramatic_core",
          "location_role",
          "events",
          "spatial_demands",
          "movement_paths",
          "emotional_arc",
          "mood_target"
        ],
        "properties": {
          "dramatic_core": {
            "type": "string",
            "description": "1 to 2 sentences. Empty string if no script slice."
          },
          "location_role": {
            "type": "string"
          },
          "events": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["scene_number", "what_happens", "characters_present"],
              "properties": {
                "scene_number": {
                  "type": "integer"
                },
                "what_happens": {
                  "type": "string"
                },
                "characters_present": {
                  "type": "integer"
                }
              }
            }
          },
          "spatial_demands": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["demand", "serves"],
              "properties": {
                "demand": {
                  "type": "string"
                },
                "serves": {
                  "type": "string"
                }
              }
            }
          },
          "movement_paths": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "emotional_arc": {
            "type": "string"
          },
          "mood_target": {
            "type": "string"
          }
        }
      },
      "spec_fields": {
        "type": "array",
        "description": "One entry per field. Groups: Identity, Spatial, Visual, Environment, Continuity.",
        "items": {
          "type": "object",
          "required": ["group", "field", "value", "status", "source", "critical"],
          "properties": {
            "group": {
              "type": "string",
              "enum": ["Identity", "Spatial", "Visual", "Environment", "Continuity"]
            },
            "field": {
              "type": "string"
            },
            "value": {
              "type": "string"
            },
            "status": {
              "type": "string",
              "enum": ["confirmed", "inferred", "unknown"]
            },
            "source": {
              "type": "string",
              "enum": ["user", "reference", "script", "genre_style", "design"]
            },
            "critical": {
              "type": "boolean"
            }
          }
        }
      },
      "dna": {
        "type": "object",
        "required": [
          "geometry",
          "fixed_anchors",
          "visual_identity",
          "continuity_constraints",
          "mutable_elements"
        ],
        "properties": {
          "geometry": {
            "type": "string"
          },
          "fixed_anchors": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["id", "name", "where", "status"],
              "properties": {
                "id": {
                  "type": "string"
                },
                "name": {
                  "type": "string"
                },
                "where": {
                  "type": "string",
                  "description": "Wall or zone plus position, using the orientation system."
                },
                "status": {
                  "type": "string",
                  "enum": ["confirmed", "inferred"]
                }
              }
            }
          },
          "visual_identity": {
            "type": "object",
            "required": [
              "era",
              "architectural_style",
              "materials",
              "base_palette",
              "wear_level",
              "scale"
            ],
            "properties": {
              "era": {
                "type": "string"
              },
              "architectural_style": {
                "type": "string"
              },
              "materials": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "base_palette": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "wear_level": {
                "type": "string"
              },
              "scale": {
                "type": "string"
              }
            }
          },
          "continuity_constraints": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "Includes negative constraints such as 'no additional doors or windows'."
          },
          "mutable_elements": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "Time of day, light intensity, weather, movable objects."
          }
        }
      },
      "layout": {
        "type": "object",
        "required": [
          "space_kind",
          "shape",
          "approx_size",
          "zones",
          "openings",
          "key_objects",
          "cameras",
          "paths"
        ],
        "properties": {
          "space_kind": {
            "type": "string",
            "enum": ["interior", "exterior"]
          },
          "shape": {
            "type": "string"
          },
          "approx_size": {
            "type": "object",
            "required": ["width_m", "depth_m", "height_m"],
            "properties": {
              "width_m": {
                "type": "number"
              },
              "depth_m": {
                "type": "number"
              },
              "height_m": {
                "type": "number"
              }
            }
          },
          "zones": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["id", "name", "area"],
              "properties": {
                "id": {
                  "type": "string"
                },
                "name": {
                  "type": "string"
                },
                "area": {
                  "type": "string"
                }
              }
            }
          },
          "openings": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["id", "type", "side", "position_pct", "size", "state", "status"],
              "properties": {
                "id": {
                  "type": "string"
                },
                "type": {
                  "type": "string",
                  "enum": ["door", "window", "arch", "stairs", "gate", "other"]
                },
                "side": {
                  "type": "string",
                  "enum": ["N", "E", "S", "W", "ceiling", "floor"]
                },
                "position_pct": {
                  "type": "number"
                },
                "size": {
                  "type": "string"
                },
                "state": {
                  "type": "string"
                },
                "status": {
                  "type": "string",
                  "enum": ["confirmed", "inferred"]
                }
              }
            }
          },
          "key_objects": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["id", "name", "side_or_zone", "position_pct", "size", "fixed", "status"],
              "properties": {
                "id": {
                  "type": "string"
                },
                "name": {
                  "type": "string"
                },
                "side_or_zone": {
                  "type": "string"
                },
                "position_pct": {
                  "type": ["number", "null"]
                },
                "size": {
                  "type": "string"
                },
                "fixed": {
                  "type": "boolean"
                },
                "status": {
                  "type": "string",
                  "enum": ["confirmed", "inferred"]
                }
              }
            }
          },
          "cameras": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["id", "view", "stands_at", "looks_toward"],
              "properties": {
                "id": {
                  "type": "string"
                },
                "view": {
                  "type": "string"
                },
                "stands_at": {
                  "type": "string"
                },
                "looks_toward": {
                  "type": "string"
                }
              }
            }
          },
          "paths": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["from", "to", "note"],
              "properties": {
                "from": {
                  "type": "string"
                },
                "to": {
                  "type": "string"
                },
                "note": {
                  "type": "string"
                }
              }
            }
          }
        }
      },
      "coverage_plan": {
        "type": "object",
        "required": ["mode", "views"],
        "properties": {
          "mode": {
            "type": "string",
            "enum": ["concept", "lock"]
          },
          "views": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["view_id", "name", "camera_id", "purpose", "required"],
              "properties": {
                "view_id": {
                  "type": "string"
                },
                "name": {
                  "type": "string"
                },
                "camera_id": {
                  "type": "string"
                },
                "purpose": {
                  "type": "string"
                },
                "required": {
                  "type": "boolean"
                }
              }
            }
          }
        }
      },
      "hero_wide": {
        "type": "object",
        "required": [
          "mode",
          "image_prompt",
          "aspect_ratio",
          "reference_order",
          "visible_anchor_ids",
          "hidden_anchor_ids"
        ],
        "properties": {
          "mode": {
            "type": "string",
            "enum": ["generate", "use_uploaded", "restyle_uploaded"]
          },
          "image_prompt": {
            "type": "string",
            "description": "Empty string when mode is use_uploaded."
          },
          "aspect_ratio": {
            "type": "string",
            "enum": ["16:9"]
          },
          "reference_order": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["index", "role"],
              "properties": {
                "index": {
                  "type": "integer"
                },
                "role": {
                  "type": "string",
                  "enum": ["hero", "layout", "mood", "detail", "other"]
                }
              }
            }
          },
          "visible_anchor_ids": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "hidden_anchor_ids": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        }
      },
      "location_summary": {
        "type": "string",
        "description": "Canonical descriptor, max 40 words."
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
      "style_used": {
        "type": "string",
        "description": "The effective style actually used, specific variant if the input style was generic."
      },
      "style_source": {
        "type": "string",
        "enum": ["style_override", "project_style"]
      },
      "applied_fixes": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "description": "Codes of the fix_requests applied this round. Empty on first generation."
      }
    }
  }
}
```

The backend derives `confirmed_fields / inferred_fields / unknown_fields` from `spec_fields`, and `location_version` on lock.

---

## 5. System prompt (CORE)

```
# ROLE
You are the Location Generator Dami inside BLAXZY, an AI visual generation platform for films and series. Your job is to DEFINE a space, not just draw it. Principle: space first, image second. From the user's input, the screenplay context, and the project's genre and style, you produce: (1) a story analysis of what this location must do, (2) a structured Location Specification where every field is marked Confirmed, Inferred or Unknown, (3) the Location DNA that must stay stable in every view, (4) a Layout on a shared compass so every later view agrees about where doors, windows and large objects are, (5) a Coverage Plan of the views to produce, and (6) the prompt for the Hero view. Your output is parsed by code and used by later automated steps. You never chat and never ask questions. You return your result only by calling the submit_location_spec tool.

# INPUT
A JSON object inside <input> tags, possibly with images attached in the order of reference_images.
- project: style, style_descriptor (optional, use verbatim), genre, format, era_setting, orientation, look_line (optional), art_direction_notes
- location: asset_id, name, interior_exterior, time_of_day (optional), script_description, scene_refs
- script_context: logline, scenes[] each with scene_number, heading, action, dialogue_excerpt, purpose (optional), change (optional), characters_present. Only scenes where this location appears. May be empty.
- user_prompt: the user's own description, or null
- guided_answers: object keyed by wizard question id, or null. "ai_decides" means you decide
- reference_images: [{"index": 1, "role": "hero|layout|mood|detail|other"}]
- reference_instructions: {"preserve": [], "change": []}
- output_mode: "concept" or "lock"
- exclude_assets: names of characters and props that are separate assets
- style_override (optional, Pro only)
- user_notes, previous_output (optional)
- fix_requests (optional): [{"code": "LT03", "instruction": "catalog text", "note": "optional text from the user"}]

Active rules appear in <orientation_system>, <genre_lens> and <style_lens> tags. The lenses are design rules for SPACE: the genre lens shapes the dramaturgy and mood of the space; the style lens shapes design vocabulary, materials, light and rendering.

# STEP 1: SOURCE MODE
Set source_mode: "auto" if the user gave no prompt, answers or references (or everything is "ai_decides"); "prompt_only" for text or answers only; "prompt_reference" for text plus images; "reference_only" for images only.

# STEP 2: SOURCE PRIORITY (strict, highest first)
1. The user's explicit input: user_prompt, guided_answers, what a reference image visibly shows, the preserve list. This always wins.
2. Script-required facts: what the script states about the place, and what its action physically requires. Add these as anchors with source "script". They add to the user's input; they never overwrite it.
3. Narrative design: spatial demands derived from the dramatic core (Step 3).
4. The genre lens and style lens.
5. Plausible defaults.
If the user's input contradicts the script on a fact, follow the user and add a warning. If the user explicitly overrides a lens (for example "bright daylight" under a dark style), keep the user's choice and express the style through the dimensions left open (shadow shape, contrast, composition, palette, texture).

# STYLE LOCK (hard constraint)
The effective style is style_override if present, otherwise project.style plus project.style_descriptor when given (use the descriptor verbatim). After the spatial facts, it is the most important input: every view of this location is rendered in ONE effective style, and it must match the project's characters. The style decides HOW the place is drawn (form language, materials, surface rendering, light, line work); the spec decides WHAT is there. If the user's details or a reference image imply another style, keep the effective style and translate the intent into it; reference images in another style supply architecture and layout only. Never name studios, franchises or living artists. If the style is generic (for example just "animation"), choose one specific variant, record it in assumptions, and return it in style_used. Return style_source as "style_override" or "project_style".

# STEP 3: NARRATIVE ANALYSIS (fill narrative_analysis first)
Read only script_context. For each scene: what happens here, how many characters are present. Then: what the space does to the drama (traps, exposes, hides, comforts, isolates, stages a chase, forces proximity); the physical spatial demands of the action (entrances and exits, sightlines, hiding places, distances, vertical elements, obstacles, a clear place for the central action), each with what it serves; the movement paths; the emotional arc and the single dominant mood target. The location is shown in one state: choose its most representative state and list the others as mutable_elements.
You design PHYSICAL SPACE only. Never add plot, characters or events. If script_context is empty, leave dramatic_core empty, say so in warnings, and design from the user's input, genre and style.

# STEP 4: SPEC, STATUS AND DNA
- Fill spec_fields for Identity (type, interior/exterior, use, narrative role), Spatial (form, approximate size, zones, openings, paths), Visual (era, architectural style, materials, colors, surface quality, distinctive elements), Environment (base light, time of day, condition, atmosphere), Continuity (fixed anchors, prohibitions, relative positions, what may change).
- status: "confirmed" only when the value comes from the user, a reference image, or the script. Everything you designed is "inferred". "unknown" only for fields that cannot be determined and are not needed for the Hero. source: user, reference, script, genre_style or design.
- critical = true for geometry, positions of doors and windows, and fixed anchors. Designed critical fields stay "inferred" and critical, so the user is asked to approve them.
- Parts of a space that a reference does not show (the wall behind the camera, the far side) are always "inferred" and must be labeled as proposed design in assumptions.
- DNA: geometry, fixed anchors with their positions in the orientation system, visual identity, continuity constraints (always include: no additional doors, windows or fixed structures may be invented in later views; plus any user prohibitions), and mutable elements (time of day, light intensity, weather, movable objects).

# STEP 5: LAYOUT
Use the orientation system exactly. Place every opening and every large fixed object by side and position_pct. Give it enough structure to design the reverse view without contradiction: for an interior, define all four walls (what is on each), not only the one the Hero sees. Define the cameras you need for the coverage plan. Keep openings sensible for the drama: if the script has someone enter, watch from a window, or flee, those exits and windows must exist in the right places.

# STEP 6: COVERAGE PLAN
Interior, concept mode: hero_wide, alternate (the reverse_wide camera), detail_1, detail_2.
Interior, lock mode: hero_wide, reverse_wide, corner_a, corner_b, the side views the geometry and use require (side_west and/or side_east), and two to four meaningful detail views (door, window, a surface, a signature object, the place of the key action), plus the layout summary produced by the backend from your layout.
Exterior, concept mode: establishing_wide, reverse_establishing, detail_1, detail_2.
Exterior, lock mode: establishing_wide, reverse_establishing, approach_left, approach_right, human_level, two to four detail views, and an environmental_context view (relation to street, neighbouring buildings or terrain).
Details must be meaningful (they are things the story uses), not decorative close-ups.

# STEP 7: HERO PROMPT
- Interior: Hero Wide from the S wall looking N. Exterior: Establishing Wide.
- One continuous image, 16:9, no panels, borders, captions, labels, watermarks or text overlays.
- Empty of living figures: no people, silhouettes, crowds or reflections of people; no animals unless they are a permanent part of the place. Never show anything in exclude_assets.
- Write concrete spatial facts exactly as in your layout: which wall is visible, what is on the left wall and right wall, where each opening and large object sits (far left, centre, right third, near, far). The Hero prompt and the layout must agree.
- Show at least two scale cues that are not people. No readable text; use symbols and shapes. If the script requires text, keep it to one or two short words and add a warning.
- Apply the style lens to rendering and the genre lens to dramaturgy and mood. Honor look_line if present. Keep important structure out of deep shadow and out of blown highlights.
- Natural descriptive sentences, 150 to 260 words, in this order: view and framing; space and architecture; positions of openings and fixed objects; materials, condition and dressing; light, time of day, atmosphere; palette; rendering style; one short sentence with the frame constraints.
- visible_anchor_ids lists the DNA anchors visible in the Hero; hidden_anchor_ids lists the ones that exist but are not in frame.

# STEP 8: REFERENCES
- role "hero": this image IS the Hero view. If its style matches project.style, set hero_wide.mode to "use_uploaded" and image_prompt to an empty string. If its style differs, set "restyle_uploaded" and write an edit prompt that keeps the architecture, layout and composition exactly and re-renders in the project style.
- "layout": reproduce the arrangement and architecture. "mood": take light, palette and atmosphere only. "detail": reproduce that element exactly. "other": follow user_notes.
- preserve items are kept exactly; change items are applied on top, separately. If preserve or change is empty while an image exists, preserve what is visible and say so in assumptions.
- Describe only what you see. Never identify real people; treat every face as a design. If a reference is unusable (blurry, wrong subject, people dominate), choose the most reasonable reading, record it in assumptions, and warn.

# STEP 9: FIX MODE
If fix_requests or user_notes exist alongside previous_output, apply every request on top of previous_output: change only what the request concerns, keep everything else identical (same ids, same positions, same style), and strengthen the constraint the request is about. A request about the layout itself (for example "I don't like the layout") is allowed here: update DNA, layout and coverage consistently and say what changed in assumptions. List the code of every request you applied in applied_fixes.

# OTHER RULES
- Wizard users have a locked style: style_override is never sent for them.
- Output language is English. Keep proper names and quoted words as given.
- Everything is fictional. No real brand logos. No gore or sexual content; a place with a dark history is shown through atmosphere and details, never depicted harm.
- If the input cannot define any location, return empty hero image_prompt and explain in warnings.
- location_summary: the place in at most 40 words, plain wording other damis can reuse.
- Record every detail you chose yourself in assumptions, short and human-readable.
```

`{{ORIENTATION_SYSTEM}}`, `<genre_lens>` and `<style_lens>` are appended from `location_shared_modules_v1.md`.

---

## 6. User message template

```
<input>
{
  "project": {{PROJECT_JSON}},
  "location": {{LOCATION_JSON}},
  "script_context": {{SCRIPT_SLICE_JSON_OR_EMPTY}},
  "user_prompt": {{STRING_OR_NULL}},
  "guided_answers": {{OBJECT_OR_NULL}},
  "reference_images": {{ARRAY_OR_EMPTY}},
  "reference_instructions": {"preserve": [], "change": []},
  "output_mode": "{{concept|lock}}",
  "style_override": {{STRING_OR_NULL}},
  "exclude_assets": {{ARRAY_OR_EMPTY}},
  "user_notes": {{STRING_OR_NULL}},
  "previous_output": {{OBJECT_OR_NULL}},
  "fix_requests": {{ARRAY_OR_EMPTY}}
}
</input>
```

`script_context` is sliced by the backend: only scenes whose number is in `location.scene_refs`, plus the logline, plus `purpose` and `change` from the Script Writer's hidden fields when present.

---

## 7. Review and fix loop

- On rejection the UI asks **technical or preference**, then shows the catalog in `location_review_catalog_v1.json` (technical `LT01` to `LT09`, preference `LP01` to `LP09` and `LP99`, `LR01` new seed).
- The UI sends the chosen items as `fix_requests` (`code`, `instruction` from the catalog, optional `note`) plus `previous_output`. The dami returns `applied_fixes`.
- `LR01` regenerates with a new seed and does **not** call Claude.
- `LP07` (I don't like the layout) is handled here: the dami updates DNA, layout and coverage, and the Hero prompt.
- `LP09` (change style) is Pro only. It sends `style_override`.
- A preference that conflicts with a reference image makes the UI ask first (change the reference, or drop it and build from text).
- After three rejections on the same asset, the UI shows a gentle "describe exactly what you want" prompt.

---

## 8. Backend notes

- Attach reference images in exactly the order of `hero_wide.reference_order`.
- Roles (`hero`, `layout`, `mood`, `detail`, `other`) and `preserve / change` come from the upload UI, never from Claude.
- `exclude_assets`: names of all chars and props in output_21.
- Validators: `spec_fields` non-empty; every anchor and opening referenced in `dna` exists in `layout`; `coverage_plan` matches `output_mode`; aspect ratio 16:9; show all `warnings` before generation.
- If the user edits an inferred field on the Spec card, mark it `confirmed` (source `user`) and re-run in fix mode so layout and prompt agree.
- Asset detector contract: every `loc` in output_21 must carry `name`, `interior_exterior`, `time_of_day` (optional), `script_description`, `scene_refs`.

---

## 9. Tests

1. **Auto, script-driven:** warehouse chase, Thriller + Noir, no user input. Expect several routes and exits, sightlines for pursuit, shadow shapes from high windows, each design choice traced to a spatial demand.
2. **Prompt only (spec example):** "an old room with a big window, a wooden table, cold daylight." Expect the opposite wall, door and table placement as **inferred** and critical, four-wall layout.
3. **Reference only:** one wall photo, project Claymation. Expect `restyle_uploaded`, visible wall confirmed, other walls inferred.
4. **Conflict:** user says "modern kitchen", script says 1920s. Expect modern kitchen plus a warning.
5. **Style lock:** user prompt describes a "photoreal marble hall" in a Claymation project. Expect Claymation rendering, marble intent translated into clay, `style_source: project_style`.
6. **Exterior concept, Comedy + 3D Animation:** expect establishing, reverse, two details.
7. **No script slice:** expect a warning and design from user input, genre, style.
8. **Fix mode:** `LT01` applied to a Hero prompt; expect `applied_fixes: ["LT01"]`, same anchors and ids.

---

## 10. Open

- The 13 lens modules need review by you and Hamed.
- Whether characters' `environment` should be taken from an approved location Hero (`location_summary` and the Hero image), so characters and locations share one world.
- Time-of-day and state variants (night, damaged) are `mutable_elements` for now; no variant call is built.
