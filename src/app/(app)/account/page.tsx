import type { Metadata } from "next";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, requireUser } from "@/server/auth";
import { getBalance } from "@/server/billing";
import { PageHeader, Toolbar, stagger } from "@/ui";
import { ChangePasswordForm } from "./_components/change-password-form";
import { ProfileForm } from "./_components/profile-form";
import { SignOutButton } from "./_components/sign-out-button";

export const metadata: Metadata = { title: "Account · BLAXZY" };

const creditFormat = new Intl.NumberFormat("en-US");

function formatCredits(credits: number): string {
  return `${creditFormat.format(credits)} ${credits === 1 ? "Credit" : "Credits"}`;
}

/** Account (Account.dc.html): profile, password, credits and Sign Out, as hairline rows. */
export default async function AccountPage() {
  const user = await requireUser();
  const credits = await getBalance(user.id);
  return (
    <>
      <Toolbar />
      <div className="flex flex-1 flex-col px-(--content-x) pt-8 pb-18">
        <PageHeader title="Account" description="Your details, your password and your credits." />
        <div className="grid flex-1 gap-x-16 gap-y-12 lg:grid-cols-2">
          <div className="flex flex-col gap-12">
            <ProfileForm name={user.name} email={user.email} />
            <ChangePasswordForm
              minPasswordLength={MIN_PASSWORD_LENGTH}
              maxPasswordLength={MAX_PASSWORD_LENGTH}
            />
          </div>
          <div className="flex flex-col gap-12">
            <section
              aria-labelledby="acc-credits"
              className="flex enter flex-col"
              style={stagger(0, 420)}
            >
              <h2 id="acc-credits" className="mb-4 text-section">
                Credits
              </h2>
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-y border-separator py-4">
                <div className="w-24 shrink-0 text-secondary text-label-2">Balance</div>
                <div className="min-w-0 flex-1 text-row font-medium tabular-nums">
                  {formatCredits(credits)}
                </div>
              </div>
              <p className="mt-3 text-secondary text-label-2">
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
