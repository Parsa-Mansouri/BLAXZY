import type { Metadata } from "next";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, requireUser } from "@/server/auth";
import { Card, CardHeader } from "@/ui";
import { ChangePasswordForm } from "./_components/change-password-form";
import { ProfileForm } from "./_components/profile-form";
import { SignOutButton } from "./_components/sign-out-button";

export const metadata: Metadata = { title: "Account · BLAXZY" };

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">Account</h1>
      <Card padding="lg" className="flex flex-col gap-6">
        <CardHeader title="Your details" />
        <ProfileForm name={user.name} email={user.email} />
      </Card>
      <Card padding="lg" className="flex flex-col gap-6">
        <CardHeader
          title="Password"
          description="Changing it signs you out on all your other devices."
        />
        <ChangePasswordForm
          minPasswordLength={MIN_PASSWORD_LENGTH}
          maxPasswordLength={MAX_PASSWORD_LENGTH}
        />
      </Card>
      <Card padding="lg" className="flex flex-col gap-4">
        <CardHeader title="Sign out" description="You will need your password to come back." />
        <div>
          <SignOutButton />
        </div>
      </Card>
    </div>
  );
}
