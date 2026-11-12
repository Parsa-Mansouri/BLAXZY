import type { Metadata } from "next";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, requireUser } from "@/server/auth";
import { getBalance } from "@/server/billing";
import { PageHeader, Toolbar, stagger } from "@/ui";
import { AccountForms } from "./_components/account-forms";
import { SignOutButton } from "./_components/sign-out-button";

export const metadata: Metadata = { title: "Account · BLAXZY" };

const creditFormat = new Intl.NumberFormat("en-US");

/** Account (Account.dc.html): profile, password, the credit balance and Sign Out. */
export default async function AccountPage() {
  const user = await requireUser();
  const credits = await getBalance(user.id);
  return (
    <>
      <Toolbar />
      <div className="flex flex-1 flex-col px-(--content-x) pt-8 pb-18">
        <PageHeader title="Account" />
        <div className="grid flex-1 gap-x-16 gap-y-16 lg:grid-cols-2">
          <div className="flex flex-col gap-12">
            <AccountForms
              name={user.name}
              email={user.email}
              minPasswordLength={MIN_PASSWORD_LENGTH}
              maxPasswordLength={MAX_PASSWORD_LENGTH}
            />
          </div>
          <div className="flex flex-col gap-16">
            <section
              aria-labelledby="acc-credits"
              className="flex enter flex-col gap-3"
              style={stagger(0, 420)}
            >
              <h2 id="acc-credits" className="text-section">
                Credit Balance
              </h2>
              <p className="text-heading text-label tabular-nums">
                {creditFormat.format(credits)}
                <span className="sr-only"> {credits === 1 ? "credit" : "credits"}</span>
              </p>
              <p className="max-w-(--measure) text-secondary text-pretty text-label-2">
                The price of each step is shown before anything is generated.
              </p>
            </section>
            <div className="mt-auto">
              <SignOutButton />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
