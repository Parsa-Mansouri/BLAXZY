"use client";

import { useRef, useState, type DragEvent } from "react";

/** True when the drag carries files (not text or a link dragged from the page). */
function carriesFiles(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

export interface FileDropProps {
  onDragEnter: (event: DragEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}

/**
 * Makes an element a drop target for one file. Spread `dropProps` on it and style it with
 * `dragging` (true while files are held over it). Entering and leaving its children does not
 * flicker: enters and leaves are counted. While `disabled` nothing is accepted, but a file let go
 * over the element still does not make the browser open it.
 */
export function useFileDrop({
  disabled = false,
  onFile,
}: {
  disabled?: boolean;
  onFile: (file: File) => void;
}): { dragging: boolean; dropProps: FileDropProps } {
  const depth = useRef(0);
  const [over, setOver] = useState(false);

  const dropProps: FileDropProps = {
    onDragEnter(event) {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth.current += 1;
      setOver(true);
    },
    onDragOver(event) {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = disabled ? "none" : "copy";
    },
    onDragLeave(event) {
      if (!carriesFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    },
    onDrop(event) {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setOver(false);
      if (disabled) return;
      const file = event.dataTransfer.files[0];
      if (file) onFile(file);
    },
  };

  return { dragging: over && !disabled, dropProps };
}
