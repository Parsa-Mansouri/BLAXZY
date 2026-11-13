import { SHEET_SCENES } from "./content";
import { formatTimecode } from "./timecode-format";
import { Sketch } from "./vignettes";

/** Every block is one clip of fifteen seconds, at 24 fps. */
const BLOCK_FRAMES = 15 * 24;
const pad = (n: number) => String(n).padStart(2, "0");

/** One copy of the sheet: the episode's title frame, then each scene's blocks with their start times. */
function Sheet() {
  let block = 0;
  return (
    <div className="flex shrink-0 gap-10 pr-10">
      <div className="flex w-[180px] shrink-0 flex-col justify-end gap-2 rounded-tile bg-elevated-2 p-4">
        <p className="caps-label text-label-3">Episode 01</p>
        <p className="text-heading-sm text-label">The Keeper</p>
      </div>
      {SHEET_SCENES.map((scene, s) => (
        <div key={scene.heading} className="flex shrink-0 flex-col gap-3">
          <p className="flex items-baseline gap-3 text-meta">
            <span className="mono-value text-label-2">S{pad(s + 1)}</span>
            <span className="text-label-3">{scene.heading}</span>
          </p>
          <div className="flex gap-3">
            {scene.blocks.map((kind, b) => {
              const start = formatTimecode(block++ * BLOCK_FRAMES);
              return (
                <div key={b} className="flex w-[200px] shrink-0 flex-col gap-2">
                  <div className="relative">
                    <Sketch kind={kind} still className="aspect-video rounded-tile" />
                    <span className="absolute top-2.5 left-3 mono-value text-meta text-label-2">
                      B{pad(b + 1)}
                    </span>
                    <span className="absolute right-3 bottom-2.5 mono-value text-meta text-label-3">
                      00:00:15:00
                    </span>
                  </div>
                  <span className="mono-value text-meta text-label-3">{start}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * A full-bleed contact sheet of the film: episode, scenes and their fifteen-second blocks with
 * start timecodes, drifting slowly sideways. Decorative: the deliverable tree below says the same
 * in words.
 */
export function ContactSheet() {
  return (
    <div aria-hidden="true" inert className="w-full overflow-hidden edge-fade-x">
      <div className="flex w-max sheet-drift">
        <Sheet />
        <Sheet />
      </div>
    </div>
  );
}
