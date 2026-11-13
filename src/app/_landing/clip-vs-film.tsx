import { ContactSheet } from "./ContactSheet";
import { TREE_LINES } from "./content";
import { Reveal } from "./Reveal";

/** One clip versus the whole production: a statement, the film's contact sheet, the deliverable tree. */
export function ClipVsFilm() {
  return (
    <section aria-label="One clip or the whole film" className="flex flex-col gap-14 py-28">
      <Reveal mode="group" className="px-(--content-x)">
        <h2 className="-ml-[0.04em] text-hero-title text-balance">
          <span className="rise-mask">
            <span className="rise text-label-3">Other tools return a clip.</span>
          </span>
          <span className="rise-mask">
            <span className="rise text-label" style={{ animationDelay: "120ms" }}>
              BLAXZY returns the film.
            </span>
          </span>
        </h2>
      </Reveal>

      <ContactSheet />

      <Reveal
        mode="group"
        className="grid gap-12 px-(--content-x) shell:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] shell:gap-24"
      >
        <div className="flex enter flex-col gap-4" style={{ animationDelay: "0ms" }}>
          <p className="caps-label text-label-3">The deliverable</p>
          <p className="max-w-(--measure) text-row text-pretty text-label-2">
            A single clip is a moment. A film is every scene of every episode. BLAXZY hands you the
            whole production, organised by episode, scene and block, ready for your editor.
          </p>
        </div>
        <div
          role="img"
          aria-label="A deliverable: Episode 01 holds scenes, each scene holds blocks, each block is one clip of fifteen seconds."
          className="min-w-0 enter overflow-x-auto"
          style={{ animationDelay: "120ms" }}
        >
          <pre className="mono-value text-meta whitespace-pre text-label-3">
            {TREE_LINES.map((line, index) => (
              <span key={index} className="block">
                {line.structure}
                <span className="text-label">{line.name}</span>
                {line.time ? <span className="text-label-3">{`   ${line.time}`}</span> : null}
              </span>
            ))}
          </pre>
        </div>
      </Reveal>
    </section>
  );
}
