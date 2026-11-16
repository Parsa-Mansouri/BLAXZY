"use client";

import { ActionMenu, SelectRow, stagger } from "@/ui";
import type { Scene } from "../_lib/scenes";

/** Name of a scene in the list: its heading, or "Opening" for the text before the first one. */
export const sceneName = (scene: Scene) => scene.heading ?? "Opening";

/** A scene row's count of comments and script checks; nothing when there are none. */
function NoteCount({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <>
      {/* Keyed by the count: a new comment makes the number settle in again. */}
      <span key={count} aria-hidden="true" className="inline-block swap-in tabular-nums">
        {count}
      </span>
      <span className="sr-only">
        , {count} {count === 1 ? "note" : "notes"}
      </span>
    </>
  );
}

/**
 * The scene list on the left; it chooses which scene the sheet shows (the accepted script), or
 * jumps to a scene on the one long sheet and marks the scene in view (the review). Selected rows
 * get `aria-current`.
 */
export function SceneList({
  scenes,
  index,
  onSelect,
  counts,
}: {
  scenes: Scene[];
  index: number;
  onSelect: (index: number) => void;
  /** Comments and script checks on each scene, shown at the row's end. */
  counts?: number[];
}) {
  return (
    <nav aria-label="Scenes" className="flex flex-col gap-0.5">
      {scenes.map((scene, i) => {
        const count = counts?.[i] ?? 0;
        return (
          // Right-click or long press only: a "…" would crowd the note count.
          <ActionMenu
            key={scene.key}
            label={`Actions for ${sceneName(scene)}`}
            actions={[[{ id: "go-to-scene", label: "Go to Scene", onSelect: () => onSelect(i) }]]}
            className="enter"
            style={stagger(i)}
          >
            <SelectRow
              size="regular"
              label={sceneName(scene)}
              active={i === index}
              onClick={() => onSelect(i)}
              trailing={count > 0 ? <NoteCount count={count} /> : undefined}
            />
          </ActionMenu>
        );
      })}
    </nav>
  );
}
