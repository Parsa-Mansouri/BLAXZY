/**
 * The owner's shared location modules (source/location_shared_modules_v1.md), copied
 * verbatim: the orientation system, and one genre lens and one style lens per owner genre and
 * style. Shared by the Location Generator and (later) the location sheet. Generated; do not edit
 * by hand. location-generator.test.ts checks every block still matches the source.
 */

export const LOCATION_ORIENTATION_SYSTEM = `<orientation_system>
INTERIOR. Compass labels are a shared reference frame, not real-world north. The HERO camera stands at the middle of the SOUTH wall, looks NORTH, and sees the NORTH wall straight ahead, the WEST wall on its left and the EAST wall on its right. The SOUTH wall is behind the Hero camera.

position_pct is measured from 0 to 100, from the left end to the right end of a wall as seen by a person standing inside and facing that wall: N wall 0 = west end; E wall 0 = north end; S wall 0 = east end; W wall 0 = south end.

Standard cameras:
- hero_wide: stands S, looks N. Left = W wall, right = E wall.
- reverse_wide: stands N, looks S. Sees the S wall ahead. Left = E wall, right = W wall.
- corner_a: stands in the SW corner, looks NE. Sees the N wall on the left and the E wall on the right.
- corner_b: stands in the SE corner, looks NW. Sees the W wall on the left and the N wall on the right.
- side_west: stands at the W wall, looks E. Sees the E wall ahead. Left = N, right = S.
- side_east: stands at the E wall, looks W. Sees the W wall ahead. Left = S, right = N.

RULE: when the camera turns, left and right change meaning. Always translate positions through this table. Never copy "left" or "right" from one view to another. Something on the Hero's left wall appears on the RIGHT side of the reverse view.

EXTERIOR. The main facade or entrance of the location faces SOUTH. Cameras: establishing_wide stands far to the S, looks N at the facade; reverse_establishing stands N of the site, looks S; approach_left stands SW, looks NE; approach_right stands SE, looks NW; human_level stands S at eye height (about 1.7 m), looks N. The same left/right and position_pct rules apply to the facade and the site edges.
</orientation_system>`;

export const LOCATION_GENRE_LENSES = {
  Drama: `GENRE LENS: Drama
Space serves emotion and choice: places where people confront, hide or reveal. Lived-in, specific, believable. Provide natural staging places (a table, a doorway, a window to look out of) and sightlines that allow intimate scenes. Light is motivated and natural. Avoid: decorative melodrama, symbolism that has no use in the scene.`,
  Comedy: `GENRE LENS: Comedy
Space stages gags and reactions. Readable geography with clear sightlines so audiences see setup and reaction; doors, obstacles, stairs and objects that can trigger escalation; mild exaggeration of clutter, scale or asymmetry. Open, brighter, readable light. Avoid: dark ambiguity that hides faces and reactions.`,
  Horror: `GENRE LENS: Horror
Space withholds. Limited sightlines, thresholds, deep recesses, areas just out of view, isolation, slight wrongness in symmetry or scale. Pools of light with dark corners where detail is still readable. Avoid: gore, monsters or threats placed in the set; only the space itself is unsettling.`,
  Thriller: `GENRE LENS: Thriller
Space is about control and exposure. Exits and the lack of them, windows to watch from or be watched through, long approach lines, public versus private areas, places to hide and observe. Controlled, restrained light and palette. Avoid: overt violence or props that imply a plot the script does not contain.`,
  Action: `GENRE LENS: Action
Space is clear geography for movement. Readable lanes, multiple routes, obstacles, vertical elements, surfaces and set pieces that characters can use. The layout must be easy to follow so cuts do not confuse the audience. Avoid: unexplained clutter that blocks movement; geography that cannot be understood from the Hero view.`,
  "Science Fiction": `GENRE LENS: Science Fiction
Space expresses one coherent design logic tied to the story's premise. Technology is visible through how the space is organized and used, with a consistent system of forms and lighting. Avoid: decorative gadgets with no function, and design logic that changes between views.`,
} as const;

export const LOCATION_STYLE_LENSES = {
  Realistic: `STYLE LENS: Realistic
Believable architecture, plausible scale, materials with weight and honest wear. Natural, motivated light. Avoid: stylization, and the words "photorealistic", lens or camera settings.`,
  Noir: `STYLE LENS: Noir
Confined spaces, blocked sightlines, hard-edged shadow shapes cast by windows, blinds or doorways, high contrast, restrained palette, reflective surfaces. Avoid: assuming crime or pessimism; adding trench coats, rain or smoke the user did not ask for. Apply noir's visual language to whatever place was given.`,
  Futuristic: `STYLE LENS: Futuristic
Forward-looking architecture, objects and technology with clean surfaces, integrated light and a consistent design logic across all views. Each technological element has a function. Avoid: material lists and CGI effects with no purpose.`,
  "Horror Visual Style": `STYLE LENS: Horror Visual Style
Unease through placement and condition: limited sightlines, stillness, uneven light, subtle decay and wrongness in details. Atmosphere only. Avoid: adding threats, creatures, blood or events; the genre of the story does not change.`,
  "3D Animation": `STYLE LENS: 3D Animation
Stylized forms with clear volume and readable spatial relationships, clean appealing materials, soft readable light, consistent scale. Avoid: render-engine, shader or technical parameter language.`,
  Anime: `STYLE LENS: Anime
Background-art sensibility: carefully designed environments, expressive light and sky, selective emphasis on a few important details, clean simplified surfaces. Avoid: photoreal texture noise and cliches that the script does not support.`,
  Claymation: `STYLE LENS: Claymation
A physically buildable miniature set: handmade surfaces, visible fingerprints and small irregularities, simple chunky forms, small-scale props, soft studio-like light. Avoid: structures that could not be built, and unlimited fine detail.`,
} as const;
