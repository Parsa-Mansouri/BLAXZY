import { stagger } from "@/ui";
import { WE_HANDLE, YOU_DECIDE, type SplitRow } from "./content";
import { Reveal } from "./Reveal";

function Column({
  title,
  rows,
  muted,
  offset,
}: {
  title: string;
  rows: readonly SplitRow[];
  muted?: boolean;
  offset: number;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <h3
        className={`-ml-[0.04em] text-display text-balance ${muted ? "text-label-3" : "text-label"}`}
      >
        {title}
      </h3>
      <ul className="flex flex-col">
        {rows.map((row, index) => (
          <li
            key={row.title}
            className="flex enter flex-col gap-1 py-5 hairline-b"
            style={stagger(index, offset)}
          >
            <span className="text-section text-label">{row.title}</span>
            <span className="text-secondary text-label-3">{row.note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What the director decides, and what BLAXZY takes off their hands. */
export function Split() {
  return (
    <section aria-label="Who decides what" className="flex flex-col gap-16 px-(--content-x) py-28">
      <Reveal mode="group" className="flex flex-col gap-12">
        <div className="grid gap-12 shell:grid-cols-[1fr_auto_1fr] shell:gap-0">
          <div className="shell:pr-16">
            <Column title="You decide." rows={YOU_DECIDE} offset={80} />
          </div>
          <div aria-hidden="true" className="h-px w-full bg-separator shell:h-auto shell:w-px" />
          <div className="shell:pl-16">
            <Column title="BLAXZY handles the rest." rows={WE_HANDLE} muted offset={200} />
          </div>
        </div>
        <p className="enter text-row text-label-2" style={stagger(0, 520)}>
          Nothing is lost. Every version and every decision is kept.
        </p>
      </Reveal>
    </section>
  );
}
