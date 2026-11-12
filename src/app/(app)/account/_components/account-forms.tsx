"use client";

import { useState } from "react";
import { ChangePasswordForm } from "./change-password-form";
import { ProfileForm } from "./profile-form";

type Editing = "name" | "password" | null;

/** The profile and password rows. Only one is open at a time, so there is one Save on screen. */
export function AccountForms({
  name,
  email,
  minPasswordLength,
  maxPasswordLength,
}: {
  name: string;
  email: string;
  minPasswordLength: number;
  maxPasswordLength: number;
}) {
  const [editing, setEditing] = useState<Editing>(null);
  return (
    <>
      <ProfileForm
        name={name}
        email={email}
        editing={editing === "name"}
        onEditingChange={(next) => setEditing(next ? "name" : null)}
      />
      <ChangePasswordForm
        minPasswordLength={minPasswordLength}
        maxPasswordLength={maxPasswordLength}
        open={editing === "password"}
        onOpenChange={(next) => setEditing(next ? "password" : null)}
      />
    </>
  );
}
