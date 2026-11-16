import type { ReactNode } from "react";
import { Reveal } from "./reveal";

/** A section's one title, centred, its letters settling on sight. */
export function SectionHead({ title }: { title: ReactNode }) {
  return (
    <Reveal mode="group" className="px-(--content-x)">
      <h2 className="credit-title settle text-center text-balance">{title}</h2>
    </Reveal>
  );
}
