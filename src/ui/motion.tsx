import type { CSSProperties, ElementType, ReactNode } from "react";
import { cn } from "./cn";

/**
 * The delay for the i-th repeated item (tiles, list rows, option rows, form fields): 300ms, then
 * 40ms steps. Pair it with the `enter` class:
 *
 *   <li className="enter" style={stagger(i)}>
 *
 * After a state swap, start lower so the new set arrives quickly: `stagger(i, 40)`.
 */
export function stagger(index: number, base = 300, step = 40): CSSProperties {
  return { animationDelay: `${base + index * step}ms` };
}

export interface SwapFadeProps {
  /**
   * What is being shown, e.g. the question id, the scene number or the tab value. When it
   * changes, the content is remounted and replays a 250ms fade-in.
   */
  swapKey: string | number;
  children: ReactNode;
  as?: ElementType;
  className?: string;
}

/** State swaps (next question, another scene, another sheet) replay a 250ms fade-in. */
export function SwapFade({ swapKey, children, as: Tag = "div", className }: SwapFadeProps) {
  return (
    <Tag key={swapKey} className={cn("swap-in", className)}>
      {children}
    </Tag>
  );
}
