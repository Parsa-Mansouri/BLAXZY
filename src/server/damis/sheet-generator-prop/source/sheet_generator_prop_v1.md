# DAMI: `sheet_generator_prop` (v1)

**Stage:** 3 Pre-production, category `prop`
**Job:** Takes the LOCKED prop spec and the APPROVED Hero Design (always reference image 1) and writes the Nano Banana prompts for the remaining views of the Adaptive Asset Sheet (spec step 05 Expand), so that every view shows exactly the same object. It never redesigns. The result goes into output_30.
**Companion files:** `prop_shared_modules_v1.md`, `sheet_review_catalog_prop_v1.json`, `prop_generator_dami_v1.md`.
**Model:** `claude-sonnet-5-5`, temperature 0.3, max_tokens 6000.

---

## 0. Layout decision (replaces "prop sheet layout undecided" in the registry)

The registry said the prop sheet would reuse the character skeleton (grey studio, fixed layout, numbered detail frames). The Product Spec changes part of that, so:

- **Kept:** grey studio and even light (the spec asks for a neutral background and even light for explanatory views), `fix_requests`, review catalog, edit mode, `DESIGN_CHANGE_REQUESTED:` routing.
- **Changed:** no single fixed canvas. The spec asks for an **adaptive** sheet whose number of views depends on complexity, importance and interaction. Every view is **one separate image**, generated in order with references to the approved views (same principle as the Location Pack). Views are addressed by `view_id` (Front, Right, Back, Left, Top, Detail 1…) instead of numbered frames.
- **Labels and numbers are drawn by the backend, never by the image model.** The spec requires clearly labeled angles and stated dimensions; image models garble text, so labels and the scale card are composed by code.

| Level      | Images (including the approved Hero)                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Simple     | Hero; back_34 only if needed; scale card as data                                                                                                  |
| Standard   | Hero, one complementary view, 1 to 3 details, scale_ref, interaction if needed                                                                    |
| Production | Hero, front / right / back / left (top or bottom if useful), 2 to 4 details, materials if needed, every non-default state, interaction, scale_ref |

---

## 1. Tool schema (`submit_asset_views`)

```json
{
  "name": "submit_asset_views",
  "description": "Submit the image prompts for the remaining views of ONE locked prop asset's Adaptive Asset Sheet.",
  "input_schema": {
    "type": "object",
    "properties": {
      "asset_id": { "type": "string" },
      "asset_name": { "type": "string" },
      "sheet_level": { "type": "string", "enum": ["simple", "standard", "production"] },
      "views": {
        "type": "array",
        "maxItems": 13,
        "items": {
          "type": "object",
          "properties": {
            "view_id": { "type": "string" },
            "label": {
              "type": "string",
              "description": "From the VIEW_LIBRARY, drawn on the sheet by the backend."
            },
            "purpose": { "type": "string" },
            "state_id": { "type": "string" },
            "image_prompt": { "type": "string" },
            "aspect_ratio": { "type": "string", "enum": ["1:1", "4:3", "3:4", "16:9", "9:16"] },
            "reference_order": {
              "type": "array",
              "maxItems": 4,
              "items": {
                "type": "object",
                "properties": {
                  "index": { "type": "integer" },
                  "source": {
                    "type": "string",
                    "description": "approved_hero | approved_view:<view_id> | previous:<view_id> | user_reference:<n>"
                  },
                  "role": { "type": "string" }
                },
                "required": ["index", "source", "role"]
              }
            },
            "depends_on": { "type": "array", "items": { "type": "string" } },
            "must_show": {
              "type": "array",
              "items": { "type": "string" },
              "description": "Concrete checks, with viewer's left/right for asymmetric details."
            },
            "must_not_show": { "type": "array", "items": { "type": "string" } },
            "new_hypotheses": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "area": { "type": "string" },
                  "proposal": { "type": "string" }
                },
                "required": ["area", "proposal"]
              },
              "description": "Parts this view reveals that neither the Hero nor the DNA defines. Proposed, need approval."
            },
            "review_focus": {
              "type": "array",
              "items": {
                "type": "string",
                "enum": [
                  "shape",
                  "scale",
                  "material",
                  "directional",
                  "functional",
                  "reference_fidelity"
                ]
              }
            },
            "edit_mode": { "type": "string", "enum": ["full", "edit_previous_view"] }
          },
          "required": [
            "view_id",
            "label",
            "purpose",
            "state_id",
            "image_prompt",
            "aspect_ratio",
            "reference_order",
            "depends_on",
            "must_show",
            "must_not_show",
            "new_hypotheses",
            "review_focus",
            "edit_mode"
          ]
        }
      },
      "generation_order": { "type": "array", "items": { "type": "string" } },
      "scale_card": {
        "type": "object",
        "description": "Data for the backend-drawn scale card. Never drawn by the image model.",
        "properties": {
          "dimensions_cm": {
            "type": ["object", "null"],
            "properties": {
              "height": { "type": "number" },
              "width": { "type": "number" },
              "depth": { "type": "number" }
            }
          },
          "dimensions_status": { "type": "string", "enum": ["confirmed", "inferred", "unknown"] },
          "relative_reference": { "type": "string" },
          "text": {
            "type": "string",
            "description": "One line for the card. Numbers only if dimensions_status is confirmed; otherwise relative wording."
          }
        },
        "required": ["dimensions_cm", "dimensions_status", "relative_reference", "text"]
      },
      "applied_fixes": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "code": { "type": "string" },
            "view_id": { "type": "string" },
            "change": { "type": "string" }
          },
          "required": ["code", "view_id", "change"]
        }
      },
      "assumptions": { "type": "array", "items": { "type": "string" } },
      "warnings": { "type": "array", "items": { "type": "string" } }
    },
    "required": [
      "asset_id",
      "asset_name",
      "sheet_level",
      "views",
      "generation_order",
      "scale_card",
      "applied_fixes",
      "assumptions",
      "warnings"
    ]
  }
}
```

---

## 2. System prompt (CORE)

```text
You are the Prop Sheet Generator of BLAXZY, an AI film production pipeline. Your single job: take ONE prop asset whose Hero Design is APPROVED and whose spec is LOCKED, and write the Nano Banana prompts for the remaining views of its Adaptive Asset Sheet, so that every view shows exactly the same object. You never redesign. You do not chat or explain. You answer only by calling submit_asset_views.

# INPUTS
- locked_spec: asset_id, asset_name, classification, dna, project_links, sheet_plan, style_used (the previous output of the Prop Generator, approved)
- approved_images: attached in order. Image 1 is ALWAYS the approved Hero (hero_34). Then any sheet views already approved, each with its view_id.
- user_reference_images (optional): the user's original references, attached after the approved images, with their indexes
- linked_characters (optional): character_id, age_group, build, handedness
- project: style, style_descriptor (optional), genre, era_setting, ui_language
- sheet_level_override (optional, Pro only)
- previous_output, fix_requests, user_notes (optional, fix mode)

# RULES
1. Source of truth. The approved Hero is the master design: silhouette, proportions, parts, materials, colors, wear and details are copied from it exactly. The DNA is second. If the DNA text and the Hero disagree on something visible in the Hero, follow the Hero and add a warning.
2. Plan. Start from locked_spec.sheet_plan. Apply sheet_level_override if present, but never go below the minimum rules of the VIEW LIBRARY (functional or hero importance stays production) and add a warning if the override was raised. Do not include hero_34: it is already approved. Each view uses a view_id and label from the VIEW LIBRARY.
3. Direction. Translate every asymmetric detail, inscription and part position into viewer's left / right for each view using the OBJECT ORIENTATION SYSTEM, write it explicitly in the prompt, and repeat it in must_show ("hinge on the viewer's right edge"). Never mirror. The back is not a mirror of the front. A detail not visible from a view is not drawn in it.
4. Hidden parts. When a view shows an area that neither the Hero nor the DNA defines (the back of a single-photo reference, the underside, the inside), design it to fit the DNA (same materials, construction logic, wear), describe it in the prompt, and list it in new_hypotheses. These are proposals that need the user's approval.
5. Studio and perspective. Every view follows the STUDIO STANDARD. Orthographic-like views: camera perpendicular to the face, at its center height, long lens, flat perspective, object filling about 75 percent of the frame. Keep the same light direction and intensity as the Hero across all views.
6. States. A state view uses the hero_34 angle and changes ONLY the moving part, following dna.mechanics (hinge side, axis, direction, range). Everything else is identical to the Hero. The open or operated configuration must be physically possible for the geometry (a lid hinged at the back opens upward and backward; it cannot pass through the body). If the state reveals an interior that is not defined, it goes to new_hypotheses.
7. Scale. scale_ref places the object beside its reference from dna.scale.scale_reference_type: a plain neutral-grey mannequin hand, a plain neutral-grey mannequin human figure, or an everyday object of universally known size (a standard interior door for very large things). Never a ruler or anything with markings. Keep true relative size from dimensions_cm or relative_reference. If a linked character is a child or has an unusual build, size the mannequin hand or figure accordingly. Never draw numbers. Fill scale_card: numbers in text only when dimensions_status is confirmed, otherwise relative wording.
8. Interaction. Neutral-grey mannequin hands hold or operate the object as dna and project_links.character_links describe (which hand, which grip, which part they touch). The hands have five correctly formed fingers. No sleeves, skin, nails or character identity. The object stays fully recognizable and unchanged.
9. Details. A detail view is a true sharp macro of one signature detail with a little surrounding form for context, not a crop. Prefer must_keep and asymmetric details, then details that will be seen in close shots.
10. Text. Follow TEXT ON OBJECTS exactly as the DNA's render_as says. Legible text reads left-to-right and is never mirrored, including in back views of transparent parts.
11. Style lock. The effective style is locked_spec.style_used; the approved Hero's style wins over project.style. Every view matches the Hero's rendering. Never name studios, franchises or living artists.
12. References. Every view lists approved_hero as reference 1, plus up to three more: the approved view closest in angle (a back view uses the approved right or left view when available), and a user reference only when it shows a detail better than the Hero. Refer to images by order in the prompt: "The first reference image is the exact object. Keep its shape, proportions, parts, materials, colors and details identical; only the camera angle changes."
13. Order. generation_order lists every view after the views it depends on. Typical: front, right, back, left, top or bottom, back_34, state views, details, material views, interaction, scale_ref. depends_on names the approved views used as references.
14. review_focus: the QA tests the reviewer must check on this view: shape and material always; directional when asymmetric details or text are visible; functional for state and interaction views; scale for scale_ref and interaction; reference_fidelity when a must_keep item is visible.
15. Aspect ratio per view from the object's proportions as seen from that view (same rule as the Hero); details and material views 1:1.

# FIX MODE
When fix_requests or user_notes come with previous_output: apply every request only to the view in its view_id, keep all other views identical, and list each applied code with its view_id and change in applied_fixes.
- This dami never changes the design. If a request or note asks to change silhouette, proportions, materials, colors, details, mechanics, the number of parts, or rejects a proposed hidden part (new_hypotheses), do not apply it. Return a warning that starts with "DESIGN_CHANGE_REQUESTED:" naming the view and the requested change, and keep that view as the spec defines it. The platform routes the user to the Prop Generator.
- Edit mode. If every request for a view has edit_eligible true, set that view's edit_mode to "edit_previous_view", add the previous image to reference_order with source "previous:<view_id>", and write the prompt as an edit instruction ("Edit the second reference image: change only X; keep everything else identical."). Otherwise edit_mode is "full".
- After a fix, check that direction, studio standard and identity rules still hold.

# OTHER RULES
- If the approved Hero is missing or unusable, return views as an empty array and explain in warnings.
- No real brand names, logos or trademarks. Weapons and dangerous items are film props: look only.
- assumptions and warnings are short and human-readable; empty arrays when there is nothing to say.
```

`{{OBJECT_ORIENTATION}}`, `{{VIEW_LIBRARY}}`, `{{STUDIO_STANDARD}}` and `{{OBJECT_TEXT_RULE}}` are appended from `prop_shared_modules_v1.md`.

---

## 3. User message template

```json
{
  "locked_spec": {{PROP_GENERATOR_OUTPUT_APPROVED}},
  "approved_images": [
    {"index": 1, "view_id": "hero_34"}
  ],
  "user_reference_images": {{ARRAY_OR_EMPTY}},
  "linked_characters": {{ARRAY_OR_EMPTY}},
  "project": {
    "style": "{{STYLE}}",
    "style_descriptor": {{STRING_OR_NULL}},
    "genre": "{{GENRE}}",
    "era_setting": "{{TEXT}}",
    "ui_language": "{{fa|en}}"
  },
  "sheet_level_override": {{STRING_OR_NULL}},
  "previous_output": {{OBJECT_OR_NULL}},
  "fix_requests": {{ARRAY_OR_EMPTY}},
  "user_notes": {{STRING_OR_NULL}}
}
```

Approved images are attached in `approved_images` order, Hero first. The backend runs `generation_order` sequentially; a view is generated only after every view in its `depends_on` is approved, and its `reference_order` images are attached in that order.

---

## 4. Sheet assembly and Lock (backend, no AI; spec steps 06 Validate and 07 Lock)

1. **Individual views are the model-facing assets.** Downstream dami (Text Blocks) pick the right view per shot (the open state for an opening shot, the interaction view for a hand close-up) and send it to Higgsfield with the DNA text.
2. **Contact sheet (`prop_sheet.png`)**, composed with an image library: Hero large, other views in a grid, each with its label (Front, Right, Back…) drawn by code, plus the scale card (`scale_card.text`) and a short DNA card. Human-facing only, never sent to a video model.
3. **Structured spec is stored with the images** (spec section 5): DNA, `sheet_views` with each view's status (planned, generated, approved, rejected).
4. **Validate:** each view's `review_focus` is shown as the QA checklist: Shape, Scale, Material, Directional, Functional and Reference fidelity consistency (spec section 8). Automatic checks in V1 are the validators below; a vision QA dami is V1.1.
5. **Lock rules (spec approval rule):** a hero or functional asset cannot be locked until every planned view and every state view is approved and no `new_hypotheses` or inferred critical field is unreviewed. A simple asset can lock with the Hero and the scale card. Lock writes the reusable `asset_id` + `asset_version` into output_30.

Validators: `generation_order` contains every view once and after its dependencies; `reference_order[0]` is `approved_hero` unless `edit_mode` is `edit_previous_view` (then the previous image is included too); no view exceeds four references; the level's maximum image count is respected; production level has a state view for every non-default state.

---

## 5. Review and fix loop

- Technical `AST01` to `AST14`, preference `ASP01`, `ASP02`, `ASP99`, `ASR01` (new seed, no Claude call), `ASX01` (design change, routes to `prop_generator` fix mode, then affected views regenerate). See `sheet_review_catalog_prop_v1.json`.
- Edit-mode eligible: `AST02`, `AST05`, `AST09`, `AST11`, `AST12`, `AST13`.
- Rejecting a proposed hidden part (`new_hypotheses`) is a design change: `ASX01`.

---

## 6. Tests

1. **Directional:** the chest's lock is on the left half of FRONT (as seen from the front). Expect front view: lock on the viewer's left; right view: front face on the viewer's left edge, lock not visible; back view: no lock, not a mirror.
2. **State:** lid hinged at the back. Expect `state_open` at hero_34 with the lid rotating upward and backward, only the lid moved, the interior listed in `new_hypotheses` if undefined.
3. **Scale:** a teacup used by a child character. Expect a small mannequin hand sized for a child, `scale_card.text` with relative wording when dimensions are inferred.
4. **Simple level:** a background vase. Expect zero or one view and a scale card.
5. **Design change:** "make the handle longer" on the right view. Expect `DESIGN_CHANGE_REQUESTED:` and the view unchanged.
6. **Edit mode:** `AST13` on detail_2. Expect `edit_previous_view` and `previous:detail_2` in `reference_order`.
7. **Override:** Pro sends `sheet_level_override: "simple"` for a functional prop. Expect production level and a warning.
8. **Text:** legible title on the book cover. Expect it quoted, left-to-right, only in views that show the cover.

---

## 7. Open

- Separate images vs one multi-view canvas for orthographic views: separate images were chosen for reuse and per-view fixes. If tests show shape drift between views, try generating front / right / back / left on one canvas and cropping it in the backend.
- Contact-sheet template is backend work.
- Which Higgsfield model handles multi-reference generation.
