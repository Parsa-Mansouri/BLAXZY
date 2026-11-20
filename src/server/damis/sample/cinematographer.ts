/**
 * Sample CINEMATOGRAPHER: a deterministic answer from the input. `look` gives every scene the
 * card's mode A; `scene` uses the look's mode for the scene and fills each shot's look from the
 * director's camera, without describing any character or place.
 */
import { cinematographerCard } from "../cinematographer/library";
import { cinematographerInputSchema, type CinematographerOutput } from "../cinematographer/schema";

export function sampleCinematographer(raw: unknown): CinematographerOutput {
  const input = cinematographerInputSchema.parse(raw);
  const card = cinematographerCard(input.cinematographer_id);
  if (input.mode === "look") {
    const mode = card.modes[0];
    return {
      mode: "look",
      scene: null,
      look: {
        cinematographer_id: card.id,
        lens_and_camera: "Natural focal lengths, a steady mounted camera, deep focus in wides.",
        framing: "Classical framing with clear headroom; the horizon kept level.",
        multi_character_framing: "Two or more characters share the frame in depth, never stacked.",
        daylight: "One soft directional source from a window or the sky, little fill.",
        night: "Practical sources only; shadows allowed to fall toward black.",
        interiors_sealed_light: "Light from the room's own practicals, motivated and low.",
        color_contrast_texture: "Restrained colour, medium contrast, fine grain.",
        scene_modes: input.scenes.map((s) => ({
          scene_id: s.scene_id,
          mode_id: mode?.id ?? "A",
          reason: `${mode?.name ?? "Mode A"} fits ${s.location_label || "this scene"}.`,
        })),
      },
    };
  }
  const planned = input.look.scene_modes.find((m) => m.scene_id === input.scene.scene_id);
  return {
    mode: "scene",
    look: null,
    scene: {
      scene_id: input.scene.scene_id,
      mode_id: planned?.mode_id ?? card.modes[0]?.id ?? "A",
      shots: input.shots.map((shot) => ({
        shot_id: shot.shot_id,
        lens: /close/i.test(shot.size) ? "a slightly long lens" : "a normal lens",
        camera_height_angle: `${shot.camera.height}, ${shot.camera.angle}`,
        light: input.look.interiors_sealed_light,
        framing: input.look.framing,
        grade: input.look.color_contrast_texture,
        texture: "fine grain",
      })),
    },
  };
}
