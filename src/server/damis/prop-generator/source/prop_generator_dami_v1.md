# DAMI: `prop_generator` (v1)

**Stage:** 3 Pre-production, category `prop` (all non-character, non-location assets)
**Job:** Takes the input for ONE prop (own prompt, guided answers, reference images, or nothing), the script slice where it appears, linked characters and locations, and the project style. Returns a structured Asset Specification (every field Confirmed, Inferred or Unknown), Asset DNA, project links, a sheet plan (Simple, Standard or Production) and the Hero Design prompt for Nano Banana.
**Basis:** `Blackeiz_Asset_Prop_Generator_Product_Spec_V1.docx` (steps 01 Analyze, 02 Clarify, 03 Design; the user's approval is step 04).
**Companion files:** `prop_shared_modules_v1.md`, `prop_review_catalog_v1.json`, `sheet_generator_prop_v1.md`.
**Model:** `claude-sonnet-5-5` (vision for references). Escalate to `claude-opus-5-5` only if spec quality is weak in tests.

---

## 0. Pipeline position

```
output_21 prop entry
   + user input: prompt | 5 guided answers (+ Advanced) | reference image(s) | nothing ("Design it for me")
   + script slice + linked characters / locations + project style
                          |
                   [prop_generator]
   script analysis -> classification -> Spec -> clarifying questions -> DNA -> links -> sheet plan -> Hero prompt
                          |
        blocking question?  yes -> UI asks -> re-run with clarify_answers
                          |  no
            Nano Banana: Hero Design (hero_34, grey studio, alone)
                          |
   user review: Hero + Spec card (inferred critical fields and non-blocking questions highlighted)
        reject -> fix_requests -> prop_generator (fix mode)
                          |
                 APPROVED HERO -> sheet_generator_prop
```

---

## 1. Settings

| Setting | Value | Why |
|---|---|---|
| Output | Forced tool call `submit_asset_spec` | Parseable JSON; analysis fields come first in the schema |
| Temperature | 0.5 first run, 0.3 fix mode | Creative gap-filling, then conservative edits |
| max_tokens | 6000 | Spec + DNA + prompt are long |
| Retry | One retry on tool failure, then a generic error | The user never sees raw output |
| Assembly | `SYSTEM = CORE + OBJECT_ORIENTATION + VIEW_LIBRARY + STUDIO_STANDARD + OBJECT_TEXT_RULE` | Modules in `prop_shared_modules_v1.md` |

---

## 2. Decisions

- **One generator for every prop family** (spec section 1): hero_prop, hand_prop, set_dressing, functional_prop, more than one at once. Buildings, rooms and full sets go to the Location Generator (`NOT_A_PROP:` warning).
- **Three inputs, one spec** (spec section 2): prompt only, reference only, prompt + reference, plus `auto` when the user presses "Design it for me". Script, project, character and location data prefill the spec.
- **Source priority:** approved linked location (if the prop is already an anchor there) > the user's explicit input > visible facts in references > script facts (additive) > narrative design > era / world / genre > defaults. Unseen sides of a reference are always inferred.
- **Truth status per field** with a `critical` flag. Inferred critical fields must be reviewed before Lock.
- **Clarify without a second call when possible:** the dami designs with defaults and returns up to three questions. Only a `blocking` question stops the Hero (at most one in the wizard). Questions are written in `project.ui_language`.
- **Hero Design is on the grey studio, alone, at hero_34.** Unlike the character board (shown in the world), a prop is judged as an object first, and this lets the approved Hero be sheet image 1 directly with no re-render. Dramatic light and placement belong to shot design.
- **Style lock** identical to Character Generator v5 and Location Generator v1: `style_override` else `project.style` + `project.style_descriptor`; returns `style_used`, `style_source`. Wizard: style locked.
- **Object orientation system:** each asset has its own FRONT definition; RIGHT and LEFT are relative to it; every asymmetric detail is stored by face and position and translated to viewer's left / right per view. This is the answer to the spec's directional-consistency test.
- **Text on objects:** legible only when must_keep and four words or fewer; otherwise non-legible marks, with the real wording kept in DNA. No real brands.
- **Sheet level is chosen here** (Simple / Standard / Production) from importance, complexity and interaction; the backend enforces the minimum rules.
- **Fix mode reports `changes_identity`** so the backend can bump the version and, after Lock, ask for confirmation (spec section 6).

---

## 3. Wizard: the spec's five questions

Skip logic is deterministic backend code. Every question allows skip and "Let BLAXZY decide" (`ai_decides`). Questions already answered by the input are not shown. A **"Design it for me"** button sends no input and runs `auto`.

| # | id | Question | Answer type | Skip when |
|---|---|---|---|---|
| 1 | `what_is_it` | What are we making? | name / short text / detected from image | output_21 name and script description are clear, or a reference shows it |
| 2 | `importance` | How important is it? | Background / Standard / Hero | Never skipped in the wizard; prefilled from the script (close-ups, repetition) |
| 3 | `usage` | How is it used? | Static / Carried / Multi-state | Prefilled from the script actions; still shown for confirmation |
| 4 | `scale` | How big is it? | Small / Medium / Large / exact size | Prefilled when the script or the reference makes it obvious; if unknown, offer relative choices (one hand, two hands, table height, person height) |
| 5 | `must_keep` | What must stay? | must-keep items / forbidden items / free text | Optional; preserve texts of references are added automatically |

**Advanced** (collapsed, Pro shows it open): materials and finish, colors, period / style, wear, asymmetric details, detachable parts, mechanical movement, hand / body interaction, production limits, forbidden items. Sent as `guided_answers.advanced`.

The answers go to this dami directly, so no separate "guided-questions describer" dami is needed for props (same decision as for locations).

---

## 4. Tool schema (`submit_asset_spec`)

```json
{
  "name": "submit_asset_spec",
  "description": "Submit the Asset Specification, Asset DNA, sheet plan and the Hero Design prompt for ONE prop asset.",
  "input_schema": {
    "type": "object",
    "properties": {
      "asset_id": {"type": "string", "description": "Echo of asset.asset_id."},
      "asset_name": {"type": "string"},
      "source_mode": {"type": "string", "enum": ["prompt_only", "reference_only", "prompt_reference", "auto"]},
      "script_analysis": {
        "type": "object",
        "description": "Filled first. Empty strings and arrays when there is no script_context.",
        "properties": {
          "role_in_story": {"type": "string"},
          "actions_on_object": {"type": "array", "items": {"type": "string"}, "description": "What characters do with it, per scene."},
          "required_features": {"type": "array", "items": {"type": "string"}, "description": "Physical facts the script makes necessary."},
          "required_states": {"type": "array", "items": {"type": "string"}},
          "dramatic_weight": {"type": "string", "description": "What the object must make the audience feel or notice."}
        },
        "required": ["role_in_story", "actions_on_object", "required_features", "required_states", "dramatic_weight"]
      },
      "classification": {
        "type": "object",
        "properties": {
          "families": {"type": "array", "minItems": 1, "items": {"type": "string", "enum": ["hero_prop", "hand_prop", "set_dressing", "functional_prop"]}},
          "importance": {"type": "string", "enum": ["background", "standard", "hero"]},
          "interaction": {"type": "string", "enum": ["static", "carried", "multi_state"]},
          "complexity": {"type": "string", "enum": ["low", "medium", "high"]}
        },
        "required": ["families", "importance", "interaction", "complexity"]
      },
      "spec_fields": {
        "type": "array",
        "description": "One entry per specification field (what_is_it, silhouette, proportions, scale, materials, colors, finish, wear, era_style, signature_details, states, mechanics, must_keep, must_not, front_definition, and any other that matters).",
        "items": {
          "type": "object",
          "properties": {
            "field": {"type": "string"},
            "value": {"type": "string"},
            "status": {"type": "string", "enum": ["confirmed", "inferred", "unknown"]},
            "source": {"type": "string", "enum": ["user", "guided_answer", "reference", "location", "character", "script", "project", "dami"]},
            "critical": {"type": "boolean", "description": "True if a wrong value would break identity, scale or function."}
          },
          "required": ["field", "value", "status", "source", "critical"]
        }
      },
      "clarifying_questions": {
        "type": "array",
        "maxItems": 3,
        "items": {
          "type": "object",
          "properties": {
            "id": {"type": "string"},
            "field": {"type": "string"},
            "question": {"type": "string", "description": "In project.ui_language."},
            "options": {"type": "array", "minItems": 2, "maxItems": 4, "items": {"type": "string"}},
            "default": {"type": "string", "description": "The value used if the user skips. Must be one of options."},
            "blocking": {"type": "boolean"}
          },
          "required": ["id", "field", "question", "options", "default", "blocking"]
        }
      },
      "dna": {
        "type": "object",
        "properties": {
          "object_type": {"type": "string"},
          "front_definition": {"type": "string"},
          "geometry": {
            "type": "object",
            "properties": {
              "silhouette": {"type": "string"},
              "proportions": {"type": "string", "description": "Height : width : depth as a ratio, plus a sentence."},
              "rest_orientation": {"type": "string", "description": "How it normally rests or is held; what is up."},
              "parts": {"type": "array", "items": {"type": "object", "properties": {
                "part_id": {"type": "string"}, "name": {"type": "string"},
                "attaches_to": {"type": "string"}, "face": {"type": "string", "enum": ["F", "B", "L", "R", "T", "U", "whole", "inside"]},
                "description": {"type": "string"}}, "required": ["part_id", "name", "attaches_to", "face", "description"]}}
            },
            "required": ["silhouette", "proportions", "rest_orientation", "parts"]
          },
          "scale": {
            "type": "object",
            "properties": {
              "size_class": {"type": "string", "enum": ["tiny", "hand_held", "small", "medium", "large", "very_large"]},
              "dimensions_cm": {"type": ["object", "null"], "properties": {"height": {"type": "number"}, "width": {"type": "number"}, "depth": {"type": "number"}}},
              "dimensions_status": {"type": "string", "enum": ["confirmed", "inferred", "unknown"]},
              "relative_reference": {"type": "string", "description": "Size compared with a hand, a person or a known object."},
              "scale_reference_type": {"type": "string", "enum": ["hand", "human_figure", "standard_object"]}
            },
            "required": ["size_class", "dimensions_cm", "dimensions_status", "relative_reference", "scale_reference_type"]
          },
          "materials": {"type": "array", "items": {"type": "object", "properties": {
            "part_id": {"type": "string"}, "material": {"type": "string"}, "finish": {"type": "string"},
            "color": {"type": "string"}, "wear": {"type": "string"}}, "required": ["part_id", "material", "finish", "color", "wear"]}},
          "palette": {"type": "array", "items": {"type": "string"}},
          "signature_details": {"type": "array", "items": {"type": "object", "properties": {
            "detail_id": {"type": "string"}, "description": {"type": "string"},
            "face": {"type": "string", "enum": ["F", "B", "L", "R", "T", "U", "inside"]},
            "position": {"type": "string", "description": "As seen looking straight at that face."},
            "asymmetric": {"type": "boolean"}, "is_text": {"type": "boolean"},
            "text_content": {"type": ["string", "null"]},
            "render_as": {"type": "string", "enum": ["as_designed", "legible_text", "non_legible_marks"]}},
            "required": ["detail_id", "description", "face", "position", "asymmetric", "is_text", "text_content", "render_as"]}},
          "states": {"type": "array", "items": {"type": "object", "properties": {
            "state_id": {"type": "string"}, "name": {"type": "string"}, "description": {"type": "string"},
            "is_default": {"type": "boolean"}}, "required": ["state_id", "name", "description", "is_default"]}},
          "mechanics": {"type": "array", "items": {"type": "object", "properties": {
            "mechanism_id": {"type": "string"}, "type": {"type": "string"}, "part_id": {"type": "string"},
            "how": {"type": "string", "description": "Axis, hinge side, direction and range, physically plausible."}},
            "required": ["mechanism_id", "type", "part_id", "how"]}},
          "must_keep": {"type": "array", "items": {"type": "string"}},
          "must_not": {"type": "array", "items": {"type": "string"}},
          "mutable": {"type": "array", "items": {"type": "string"}, "description": "What may vary between shots (dust, contents, light state) without a new version."}
        },
        "required": ["object_type", "front_definition", "geometry", "scale", "materials", "palette", "signature_details", "states", "mechanics", "must_keep", "must_not", "mutable"]
      },
      "project_links": {
        "type": "object",
        "properties": {
          "scene_refs": {"type": "array", "items": {"type": "string"}},
          "character_links": {"type": "array", "items": {"type": "object", "properties": {
            "character_id": {"type": "string"}, "usage": {"type": "string"}, "hand": {"type": "string", "enum": ["left", "right", "both", "unknown"]}},
            "required": ["character_id", "usage", "hand"]}},
          "location_links": {"type": "array", "items": {"type": "object", "properties": {
            "location_id": {"type": "string"}, "anchor_id": {"type": ["string", "null"]},
            "placement_hint": {"type": "string", "description": "Where in the space, in the location's compass terms (wall side, position_pct, near which anchor)."},
            "facing": {"type": "string", "description": "Which way the asset's FRONT faces in the location (N, E, S, W or toward an anchor)."}},
            "required": ["location_id", "anchor_id", "placement_hint", "facing"]}}
        },
        "required": ["scene_refs", "character_links", "location_links"]
      },
      "sheet_plan": {
        "type": "object",
        "properties": {
          "level": {"type": "string", "enum": ["simple", "standard", "production"]},
          "level_reason": {"type": "string"},
          "views": {"type": "array", "items": {"type": "object", "properties": {
            "view_id": {"type": "string"}, "purpose": {"type": "string"}}, "required": ["view_id", "purpose"]},
            "description": "Planned views AFTER the hero, from the VIEW_LIBRARY."}
        },
        "required": ["level", "level_reason", "views"]
      },
      "hero_view": {
        "type": ["object", "null"],
        "description": "Null only when a blocking clarifying question exists.",
        "properties": {
          "view_id": {"type": "string", "enum": ["hero_34"]},
          "hero_source": {"type": "string", "enum": ["generate", "from_reference", "from_location"]},
          "state_id": {"type": "string"},
          "image_prompt": {"type": "string"},
          "aspect_ratio": {"type": "string", "enum": ["1:1", "4:3", "3:4", "16:9", "9:16"]},
          "reference_order": {"type": "array", "maxItems": 4, "items": {"type": "object", "properties": {
            "index": {"type": "integer"}, "source": {"type": "string", "description": "user_reference:<n> or location_hero:<location_id>"},
            "role": {"type": "string"}}, "required": ["index", "source", "role"]}},
          "must_show": {"type": "array", "items": {"type": "string"}},
          "must_not_show": {"type": "array", "items": {"type": "string"}}
        },
        "required": ["view_id", "hero_source", "state_id", "image_prompt", "aspect_ratio", "reference_order", "must_show", "must_not_show"]
      },
      "changes_identity": {"type": "boolean", "description": "Fix mode only: true if this round changed silhouette, materials, colors, signature details, states or scale. Always false on first generation."},
      "style_used": {"type": "string"},
      "style_source": {"type": "string", "enum": ["style_override", "project_style"]},
      "applied_fixes": {"type": "array", "items": {"type": "object", "properties": {"code": {"type": "string"}, "change": {"type": "string"}}, "required": ["code", "change"]}},
      "assumptions": {"type": "array", "items": {"type": "string"}},
      "warnings": {"type": "array", "items": {"type": "string"}}
    },
    "required": ["asset_id", "asset_name", "source_mode", "script_analysis", "classification", "spec_fields", "clarifying_questions", "dna", "project_links", "sheet_plan", "hero_view", "changes_identity", "style_used", "style_source", "applied_fixes", "assumptions", "warnings"]
  }
}
```

The backend derives `confirmed_fields / inferred_fields / unknown_fields` from `spec_fields`.

---

## 5. System prompt (CORE)

```text
You are the Prop Generator of BLAXZY, an AI film production pipeline. Your single job: turn the input for ONE prop asset into a structured Asset Specification, an Asset DNA, a sheet plan and the image prompt for its Hero Design (one image, generated by Nano Banana). You do not chat or explain. You answer only by calling submit_asset_spec.

An asset is not a pretty picture. It is a cinematic object with a clear identity, a stable form, an understandable scale, defined functional states, and the ability to be reused in many shots. Design identity, geometry, look, function and continuity, then the image.

# INPUTS
- asset: asset_id, name, category_hint (from output_21), script_description, scene_refs
- project: style, style_descriptor (optional, use verbatim), genre, format, era_setting, orientation, ui_language
- style_override (optional, Pro only)
- source_mode: prompt_only | reference_only | prompt_reference | auto (no user input: design from script and project)
- user_prompt (optional)
- guided_answers (optional): what_is_it, importance (background | standard | hero), usage (static | carried | multi_state), scale (small | medium | large | exact text), must_keep (text), advanced (optional: materials, colors, period_style, wear, asymmetric_details, detachable_parts, mechanics, hand_interaction, production_limits, forbidden). Any answer may be "ai_decides".
- reference_images (optional), attached in index order, each with role (identity | material | detail | mood | other), preserve (text) and change (text), chosen by the user in the UI
- script_context (optional): only the scenes in which this asset appears, plus the logline
- linked_characters (optional): character_id, name, age_group, build, handedness, usage_note
- linked_locations (optional): location_id, name, location_summary, anchor (the location's fixed anchor if this asset already exists in the approved location, else null), hero_image_index (index of the approved location Hero among the attached images, else null)
- clarify_answers (optional): answers to your earlier clarifying_questions, keyed by id
- previous_output, fix_requests, user_notes (optional, fix mode)

# STEP 1: SCRIPT ANALYSIS (before any design)
If script_context exists, read it and fill script_analysis: the object's role in the story, every action characters perform with it, the physical features the script makes necessary (a lock that must be picked needs a keyhole), the states the script requires (open and closed), and its dramatic weight. Design the object to serve these facts. Never add plot, events or characters. If script_context is missing, leave script_analysis empty and add a warning.

# STEP 2: CLASSIFICATION
families (one or more): hero_prop (featured, seen in close shots and repeatedly), hand_prop (held, carried or used by a character), set_dressing (furnishes and characterizes a space), functional_prop (has states or a moving mechanism). Hero is a degree of importance, not an exclusive family: a chest can be hero_prop and functional_prop at once.
importance: guided_answers.importance if given, else derived from the script (close-ups, repetition, plot dependence).
interaction: static, carried or multi_state. Any required state or mechanism means multi_state.
complexity: low (simple form, one material), medium, high (many parts, mechanisms, asymmetric details).
A whole building, a room or a complete set is not a prop: it belongs to the Location Generator. If the input is one, return hero_view null and a warning that starts with "NOT_A_PROP:".

# STEP 3: SPECIFICATION AND SOURCE PRIORITY
Build spec_fields. Every field has a value, a status (confirmed, inferred, unknown), a source and a critical flag. Priority, highest first:
1. An approved linked asset. If linked_locations has an anchor for this asset, the approved location already shows it: its form, materials, colors and size in that image are confirmed (source location) and you reproduce them exactly. A user request that contradicts it is not applied; return a warning that starts with "LOCATION_CONFLICT:".
2. The user's explicit input: user_prompt, guided_answers, must_keep, and each reference's change text.
3. Reference images: what is visible is confirmed (source reference), except what the change text tells you to change. A reference's preserve text makes those parts must_keep. One photo never shows the back, the underside or the inside: those parts are inferred, always, and the critical ones go to the review.
4. Script-required facts. They add to the user's input and never overwrite it. If the user contradicts a script fact, follow the user and add a warning.
5. Narrative design from script_analysis (dramatic weight, actions).
6. Era, world and genre: they shape design vocabulary (age, technology level, ornament, wear) only where the sources above are silent.
7. Sensible defaults.
Critical fields: silhouette, proportions, scale, front_definition, signature_details, materials of the main parts, states and mechanics (for functional props), must_keep. An inferred critical field is shown to the user for approval before Lock.

# STEP 4: CLARIFYING QUESTIONS (only the ambiguities that matter)
Ask only when the answer would substantially change the Hero AND no defensible default exists. Never ask what the input, the script or a reference already answers. Write questions and options in project.ui_language, 2 to 4 short options, with a default that is one of the options.
- blocking true: you cannot design a credible Hero without it (the object's identity is unclear, or a reference and the text contradict each other on a must_keep). Then set hero_view to null and still fill everything you can. At most one blocking question in the wizard (no style_override and guided_answers present), at most three in Pro.
- blocking false: you designed with the default, and the UI shows the question on the Spec card so the user can change it.
If size is unknown and matters, ask for a relative reference ("fits in one hand / held with two hands / as tall as a table / as tall as a person"), not for centimeters.
If clarify_answers are present, apply them as confirmed (source user) and do not ask again.

# STEP 5: ASSET DNA
Fill dna, the fixed and referenceable identity of the asset, following the OBJECT ORIENTATION SYSTEM below.
- front_definition: one concrete sentence.
- geometry: silhouette, proportions as height : width : depth, rest orientation, and every part with its face.
- scale: size_class always. dimensions_cm only when given by the user or clearly implied (a standard playing card); otherwise null with dimensions_status inferred or unknown. relative_reference always ("about the length of an adult forearm"). scale_reference_type: hand for anything held, human_figure for furniture and large objects, standard_object otherwise.
- materials per part with finish, color and wear; palette as concrete color names.
- signature_details: everything that makes it THIS object, with face and position. Mark asymmetric ones. Apply the TEXT ON OBJECTS rule to every inscription.
- states: always at least one state, with is_default true. A functional prop lists at least the effective states (open and closed, on and off). mechanics: hinge side, axis, direction and range, physically plausible.
- must_keep (from the user, preserve texts and the script), must_not (forbidden items from the user, plus anything the style or era rules out), mutable (what may vary between shots without a new version).

# STEP 6: PROJECT LINKS
- Hand props used by a linked character: add character_links with usage and hand. Size the object for that character's hand (a child's cup is small for an adult).
- Set dressing: add location_links with placement_hint in the location's compass terms and facing (which way the asset's FRONT points). When the asset is an anchor of the approved location, copy its position.
- Asset design is independent of shot design: no camera moves, dramatic lighting or framing for shots here.

# STEP 7: SHEET PLAN
Choose the level with the VIEW LIBRARY rules: simple, standard or production, then list the views after the hero with their purpose. Respect the minimum rules (functional or hero importance is always production). Plan detail views for the signature details that matter most for continuity; plan state views for every non-default state; plan interaction for carried or operated props when the grip or operation is not obvious.

# STYLE LOCK (hard constraint)
The effective style is style_override if present, otherwise project.style plus project.style_descriptor when given (use the descriptor verbatim). Every image of this asset is rendered in that ONE style so it matches the project's characters and locations. The style decides HOW the object is drawn (form language, material rendering, shading, line work); the spec decides WHAT it is. If the user's text or a reference image implies another style, keep the effective style and translate the intent into it: a photo of a brass key in a Claymation project becomes a clay brass key with the same shape and details. Reference images in another style supply design only. Never name studios, franchises or living artists. If the style is generic (just "animation"), choose one specific variant, record it in assumptions and return it in style_used. Return style_source.

# STEP 8: HERO DESIGN PROMPT
Write hero_view.image_prompt for Nano Banana: ONE image of the object ALONE in the hero_34 view, in its default state, under the STUDIO STANDARD, so the approved Hero can be used directly as sheet image 1.
Write it in this order, in plain concrete English:
1. What it is, in one line, rendered in the effective style.
2. Camera: the hero_34 definition. Whole object visible with margin.
3. Geometry: silhouette, proportions, parts and how they connect.
4. Materials, finish, colors and wear, part by part.
5. Signature details with their faces, translated to the viewer's left or right half for hero_34 (FRONT face on the viewer's left, RIGHT face on the viewer's right, TOP visible).
6. Default state.
7. Studio standard: background, light, lens.
8. Exclusions: no hands, people or other objects; nothing from must_not; no labels or text except allowed legible text.
hero_source: generate (from description), from_reference (reproduce the object of a reference faithfully, isolated on the studio, in the effective style), from_location (reproduce the object exactly as it appears in the approved location Hero, isolated on the studio).
aspect_ratio from the object's proportions as seen in hero_34: about square → 1:1; wider (more than 1.4 times) → 4:3, very wide (more than 2.2 times) → 16:9; taller → 3:4 or 9:16 likewise.
reference_order: refer to images by their order in the prompt ("Use the first reference image as the exact object: keep its shape, proportions and details. Ignore its background, lighting and any hands holding it."), at most four, and list them in the same order. must_show: the must_keep items and critical details visible in this view. must_not_show: what the reviewer must check is absent.

# STEP 9: FIX MODE
When fix_requests or user_notes come with previous_output: apply every request on top of previous_output, change only what the request concerns, keep everything else identical (ids, faces, positions, style), update spec_fields, dna, sheet_plan and the prompt consistently, and list each applied code with what changed in applied_fixes. Requests marked as design changes from the sheet (code ASX01) are handled here like any preference: redesign as the note says. Set changes_identity true when silhouette, proportions, scale, materials, colors, signature details, states or mechanics changed. A request you cannot apply goes to warnings only. A request that conflicts with a reference's preserve text: do not apply it, add a warning that starts with "REFERENCE_CONFLICT:" so the UI can ask the user whether to drop the reference.

# OTHER RULES
- Wizard users have a locked style: style_override is never sent for them.
- Never name, guess or identify a real person from a reference; ignore any hands or people in references.
- No real brand names, logos or trademarks: invent equivalents.
- Weapons and dangerous items are film props: describe their look only, never how to build or use them for real.
- assumptions: every value you filled in yourself, short and human-readable. warnings: contradictions, missing inputs, conflicts. Both empty arrays when there is nothing to say.
```

`{{OBJECT_ORIENTATION}}`, `{{VIEW_LIBRARY}}`, `{{STUDIO_STANDARD}}` and `{{OBJECT_TEXT_RULE}}` are appended from `prop_shared_modules_v1.md`.

---

## 6. User message template

```json
{
  "asset": {
    "asset_id": "{{ASSET_ID}}",
    "name": "{{NAME}}",
    "category_hint": "{{FROM_OUTPUT_21}}",
    "script_description": "{{TEXT}}",
    "scene_refs": {{ARRAY}}
  },
  "project": {
    "style": "{{STYLE}}",
    "style_descriptor": {{STRING_OR_NULL}},
    "genre": "{{GENRE}}",
    "format": "{{movie|series}}",
    "era_setting": "{{TEXT}}",
    "orientation": "{{portrait|landscape}}",
    "ui_language": "{{fa|en}}"
  },
  "style_override": {{STRING_OR_NULL}},
  "source_mode": "{{prompt_only|reference_only|prompt_reference|auto}}",
  "user_prompt": {{STRING_OR_NULL}},
  "guided_answers": {{OBJECT_OR_NULL}},
  "reference_images": [
    {"index": 1, "role": "identity", "preserve": "{{TEXT}}", "change": "{{TEXT}}"}
  ],
  "script_context": {{STRING_OR_NULL}},
  "linked_characters": {{ARRAY_OR_EMPTY}},
  "linked_locations": {{ARRAY_OR_EMPTY}},
  "clarify_answers": {{OBJECT_OR_NULL}},
  "previous_output": {{OBJECT_OR_NULL}},
  "fix_requests": {{ARRAY_OR_EMPTY}},
  "user_notes": {{STRING_OR_NULL}}
}
```

- `reference_images`: roles and preserve / change texts come from the upload UI, never from Claude. The images are attached in index order; an approved location Hero (for set dressing that is already an anchor) is attached after them, and its index is sent in `linked_locations[].hero_image_index`.
- `script_context`: only the scenes in `asset.scene_refs`, plus the logline.
- `linked_characters`: characters who use the prop in those scenes (from the script and output_21).

---

## 7. Review and fix loop (steps 04 Approve and 02 Clarify)

- Spec card: shows `spec_fields`, inferred critical fields highlighted, and the non-blocking `clarifying_questions` with their defaults. Editing a field marks it `confirmed` (source `user`) and re-runs fix mode.
- On rejection the UI asks **technical or preference**, then shows `prop_review_catalog_v1.json` (technical `AT01` to `AT14`, preference `AP01` to `AP11` and `AP99`, `AR01` new seed with no Claude call).
- `AP11` (style change) is Pro only and sends `style_override`.
- A `REFERENCE_CONFLICT:` warning makes the UI ask: change the reference, or drop it and build from text.
- A `LOCATION_CONFLICT:` warning tells the user the object is fixed by the approved location; changing it means going back to the Location Generator.
- After three rejections on the same asset, the UI shows a gentle "describe exactly what you want" prompt.

---

## 8. Backend notes

- Validators before generation: `hero_view` is null only when a blocking question exists; every `signature_details.face` and `parts.face` is valid; `sheet_plan.level` respects the minimum rules (raise it and log if not); every non-default state has a planned state view at production level; `reference_order` matches the attached images; show all `warnings`.
- Minimum level rules: `interaction == multi_state` or `importance == hero` → production. Raise silently and log.
- Versioning (spec section 6): every approved fix with `changes_identity: true` creates a new `asset_version`. After Lock, an identity change needs explicit confirmation, and shots already generated keep the version they used.
- Asset detector contract: each prop in output_21 needs `name`, `script_description`, `scene_refs`, `category_hint`, `users` (character ids who handle it) and `location_ids` (where it appears).
- Location link: if a prop also exists as a fixed anchor in an approved location, send that anchor and the location Hero; the prop must match it.

---

## 9. Tests

1. **Spec example (section 10):** "an old copper chest with an asymmetric lock; the character puts it on the floor and opens it." Expect families hero_prop + hand_prop + functional_prop, medium scale, production level, states closed (default) and open, a mechanics entry with hinge side, the lock as an asymmetric FRONT detail with position, and clarifying questions only about size and must-keep.
2. **Reference only:** one front photo of a lantern. Expect `from_reference`, front confirmed, back and underside inferred and critical, a warning about the hidden sides.
3. **Prompt + reference conflict:** reference preserve "keep the red handle", user note "make the handle black". Expect a `REFERENCE_CONFLICT:` warning and the handle unchanged.
4. **Style lock:** photo of a brass key in a Claymation project. Expect a clay key with the same shape, `style_source: project_style`.
5. **Text:** a book whose title is "The Last Harbor" and must be kept. Expect `legible_text` on the FRONT (cover), quoted exactly. A long inscription on its back cover is `non_legible_marks` with the wording in `text_content`.
6. **Brand:** "a can of Coca-Cola". Expect an invented soda brand and an assumption.
7. **Set dressing anchored in a location:** a sofa that is anchor `anc_03` of an approved living room. Expect `from_location`, `location_links` with the anchor and facing, and no redesign.
8. **Not a prop:** "the whole castle". Expect `NOT_A_PROP:` and `hero_view: null`.
9. **Blocking question:** "the device" with no script and no reference, wizard. Expect exactly one blocking question in `ui_language` and `hero_view: null`.
10. **Fix mode:** `AP02` with a note "dark green". Expect `applied_fixes` with `AP02`, `changes_identity: true`, all ids and faces unchanged.

---

## 10. Open

- Whether vehicles, creatures-as-objects and costumes worn without a character also go through this dami (assumed yes for vehicles and objects; costumes stay with the character).
- A vision QA dami for the six spec tests is V1.1 (the spec's "semi-automatic multi-view checking").
- Which Higgsfield model handles multi-reference generation; prompts are tuned for up to four references.
