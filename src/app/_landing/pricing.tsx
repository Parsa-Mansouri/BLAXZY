import { GUIDED_PLAN_NAME } from "./content";
import { CreditButton } from "./credit-button";
import { Reveal } from "./reveal";
import { SectionHead } from "./section-title";
import { Slate } from "./slate";

/** Two slates: the guided plan, open now, and Studio, coming soon. No prices yet. */
export function Pricing() {
  return (
    <section id="pricing" aria-label="Pricing" className="flex flex-col gap-24 py-36">
      <SectionHead title="Pay for what you make." />
      <Reveal
        mode="group"
        className="grid items-start gap-16 px-(--content-x) lg:grid-cols-2 lg:gap-10"
      >
        <div className="flex flex-col gap-8">
          <Slate
            kind="Plan"
            name={GUIDED_PLAN_NAME}
            live
            delay={200}
            fields={[
              { label: "Status", value: "Open now" },
              { label: "Billing", value: "Per generation" },
              { label: "Subscription", value: "None" },
              { label: "Models", value: "Chosen for you" },
            ]}
          />
          <CreditButton href="/signup" className="self-start">
            Create Account
          </CreditButton>
        </div>
        <Slate
          kind="Plan"
          name="Studio"
          live={false}
          delay={340}
          fields={[
            { label: "Status", value: "Coming soon" },
            { label: "For", value: "Professionals" },
            { label: "Control", value: "Full" },
            { label: "Access", value: "Later" },
          ]}
        />
      </Reveal>
    </section>
  );
}
