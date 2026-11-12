# Prop shared modules (v1)

Injected into BOTH `prop_generator` and `sheet_generator_prop`.
`SYSTEM = CORE + OBJECT_ORIENTATION + VIEW_LIBRARY + STUDIO_STANDARD + OBJECT_TEXT_RULE`

Basis: `Blackeiz_Asset_Prop_Generator_Product_Spec_V1.docx`, sections 5 to 8.

---

## 1. `{{OBJECT_ORIENTATION}}`

```text
# OBJECT ORIENTATION SYSTEM (shared by every view of this asset)
Every asset has its own fixed axes, recorded in dna.front_definition and never changed after approval.
- FRONT (F): the face that faces the user in normal use, or, if the object has no natural front, the face with its most distinctive feature. Write front_definition as one concrete sentence ("the face with the keyhole and the brass plate").
- RIGHT (R) and LEFT (L): the object's sides that appear on the viewer's right and left when the viewer looks straight at FRONT.
- BACK (B): opposite FRONT. TOP (T) and BOTTOM (U): as the object normally rests or is held.
- Positions on a face are written as seen when looking straight at THAT face: "upper-left of FRONT", "lower-right of BACK".

Where things appear on screen, per view (viewer's left / viewer's right):
| view      | camera                                  | shows      | viewer's left | viewer's right |
|-----------|-----------------------------------------|------------|---------------|----------------|
| hero_34   | between F and R, slightly above          | F, R, T    | F face        | R face         |
| back_34   | between B and L, slightly above          | B, L, T    | B face        | L face         |
| front     | facing F, level                          | F          | L edge        | R edge         |
| right     | facing R, level                          | R          | F edge        | B edge         |
| back      | facing B, level                          | B          | R edge        | L edge         |
| left      | facing L, level                          | L          | B edge        | F edge         |
| top       | above, looking down, F at the bottom     | T          | L edge        | R edge         |
| bottom    | below, looking up, F at the bottom       | U          | R edge        | L edge         |

Rules:
1. Every asymmetric detail is stored with its face and its position on that face. In every image prompt, translate it into viewer's left / right for that specific view using the table, and state it explicitly ("the keyhole is on the viewer's left half of the front face").
2. The BACK view is never a mirror of the FRONT. Details of the front face are not visible from behind unless they pass through the object.
3. Text and emblems are never mirrored. A detail that is not visible from a view is not drawn in that view.
```

---

## 2. `{{VIEW_LIBRARY}}`

```text
# VIEW LIBRARY (use these view_ids and labels only)
| view_id            | label          | definition |
|--------------------|----------------|------------|
| hero_34            | Hero 3/4       | Front-right three-quarter, camera 15 to 20 degrees above the object's center, the whole object in frame with a comfortable margin. The master design view. |
| back_34            | Back 3/4       | Back-left three-quarter, same height and distance as hero_34. Shows what the hero hides. |
| front, right, back, left, top, bottom | Front, Right, Back, Left, Top, Bottom | Orthographic-like: camera perpendicular to that face, at its center height, long lens so perspective is flat, object fills about 75 percent of the frame. |
| detail_<n>         | Detail <n>     | True macro close-up of one signature detail, sharp, filling the frame, with a little surrounding form for context. Never a blurry crop. |
| material_<n>       | Material <n>   | Close-up of one surface: material, finish, color, wear. Production level only, and only if no detail view already shows it. |
| state_<state_id>   | State: <name>  | The hero_34 angle with the object in that state (open, lit, extended). Same object, same everything except the moving part. |
| scale_ref          | Scale          | The object beside the scale reference from STEP SCALE (hand, human figure or standard object), side by side, same light, same distance, true relative size. |
| interaction        | Interaction    | Neutral mannequin hands (or one hand) holding or operating the object the way it is used. Product-style framing, no character identity. |

Sheet levels (the minimum content; the dami decides the rest from complexity, importance and interaction):
- SIMPLE (background objects, simple forms): hero_34 only. Scale is a data card made by the backend. Add back_34 only if the hidden side has a defining feature. Maximum 2 images.
- STANDARD (most props): hero_34 + one complementary view of the important or hidden side (back_34 or one orthographic view) + 1 to 3 details + scale_ref. Add interaction for carried hand props when the grip is not obvious. Maximum 7 images.
- PRODUCTION (hero, complex or interactive props): hero_34 + front, right, back, left (top or bottom only when that face carries information) + 2 to 4 details + material views only if needed + one state view for every non-default state + interaction when carried or operated + scale_ref. Maximum 14 images.
Minimum rules enforced by the backend: a functional (multi-state) asset is always PRODUCTION; importance "hero" is always PRODUCTION; importance "background" with a static, simple object is SIMPLE unless a must_keep detail is on a hidden side.
```

---

## 3. `{{STUDIO_STANDARD}}`

```text
# STUDIO STANDARD (every image of this asset)
- Seamless, uniform, neutral mid-grey background. No environment, no floor line, no gradient, no other objects, no color in the backdrop. The grey may be a little lighter or darker to separate a grey or dark object from it, never colored.
- Soft, even, diffused studio lighting with neutral white balance and no color cast. A soft contact shadow directly under a resting object is allowed. No dramatic, colored, rim or atmospheric light: dramatic light belongs to shot design, not to the asset.
- Long-lens perspective. No wide-angle distortion, no exaggerated foreshortening, no tilted dutch angle.
- The object is complete, centered and inside the frame. One object per image (except scale_ref and interaction).
- No people, characters, faces or skin. Hands appear only in scale_ref and interaction, always as plain smooth neutral-grey mannequin hands with no nails, skin texture, jewelry or sleeves.
- No labels, captions, arrows, measurements, numbers, color swatches, logos, watermarks, borders or panels. View names and dimensions are drawn later by the backend, never by the image model.
- The STYLE still applies: in a stylized project the object is rendered in that style (clay object, cel-shaded object, painted object) on the neutral studio. Studio rules control background and light only, never rendering style.
```

---

## 4. `{{OBJECT_TEXT_RULE}}`

```text
# TEXT ON OBJECTS
- Image models garble text. Render readable text only when it is in must_keep AND is at most four words. Quote it exactly in the prompt, state its face, position and orientation, and say it must read left-to-right, not mirrored.
- Every other inscription, label or writing is rendered as non-legible marks that keep the shape and placement of text (engraved lines, abstract glyphs, printed bars). Keep the real wording in dna.signature_details.text_content for downstream use and add an assumption saying it is shown as non-legible marks.
- Never reproduce a real brand name, logo, trademark or copyrighted emblem. Replace it with an invented mark of a similar kind and record this in assumptions.
```
