"use client";

import { Accordion } from "@base-ui/react/accordion";
import { Plus } from "lucide-react";
import { FAQ_ITEMS } from "./content";
import { Reveal } from "./Reveal";

/** Questions as typographic rows: a hairline between them, a plus that turns to a cross. */
export function Faq() {
  return (
    <section
      id="faq"
      aria-label="Questions"
      className="grid scroll-mt-(--toolbar-h) gap-12 px-(--content-x) py-28 shell:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] shell:gap-24"
    >
      <Reveal mode="group" className="flex flex-col gap-6 self-start">
        <h2 className="-ml-[0.04em] text-display text-balance">
          <span className="rise-mask">
            <span className="rise">Questions.</span>
          </span>
        </h2>
        <div
          aria-hidden="true"
          className="h-[3px] w-12 rule-in rounded-capsule bg-brand"
          style={{ animationDelay: "320ms" }}
        />
      </Reveal>

      <Reveal>
        <Accordion.Root className="flex flex-col">
          {FAQ_ITEMS.map((item) => (
            <Accordion.Item key={item.question} className="hairline-b">
              <Accordion.Header>
                <Accordion.Trigger className="group flex w-full cursor-pointer items-center justify-between gap-6 rounded-nested py-6 text-left text-section text-label focus-ring">
                  {item.question}
                  <Plus
                    aria-hidden="true"
                    className="size-(--icon-lg) shrink-0 text-label-3 transition-transform duration-(--dur-tab) ease-(--ease-curve) group-data-[panel-open]:rotate-45 group-data-[panel-open]:text-label"
                  />
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Panel className="accordion-panel">
                <p className="max-w-(--measure) pb-6 text-row text-pretty text-label-2">
                  {item.answer}
                </p>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion.Root>
      </Reveal>
    </section>
  );
}
