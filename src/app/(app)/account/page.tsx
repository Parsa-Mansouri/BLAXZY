import type { Metadata } from "next";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, requireUser } from "@/server/auth";
import { Toolbar } from "@/ui";
import { ChangePasswordForm } from "./_components/change-password-form";
import { ProfileForm } from "./_components/profile-form";
import { SignOutButton } from "./_components/sign-out-button";

export const metadata: Metadata = { title: "Account · BLAXZY" };

function initialOf(name: string, email: string): string {
  return (name.trim()[0] ?? email[0] ?? "?").toUpperCase();
}

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <>
      <Toolbar title="Account" />
      <div className="flex max-w-(--settings-w) flex-col gap-8 px-(--content-x) pt-4 pb-16 shell:pt-6">
        <div className="flex items-center gap-4 px-1">
          <span
            aria-hidden="true"
            className="flex size-14 shrink-0 items-center justify-center rounded-full bg-fill text-title-1 text-label"
          >
            {initialOf(user.name, user.email)}
          </span>
          <div className="flex min-w-0 flex-col">
            <p className="truncate text-title-2">{user.name}</p>
            <p className="truncate text-body text-label-2">{user.email}</p>
          </div>
        </div>
        <ProfileForm name={user.name} email={user.email} />
        <ChangePasswordForm
          minPasswordLength={MIN_PASSWORD_LENGTH}
          maxPasswordLength={MAX_PASSWORD_LENGTH}
        />
        <SignOutButton />
      </div>
    </>
  );
}
