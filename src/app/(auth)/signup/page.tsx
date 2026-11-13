import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  getSession,
  MAX_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "@/server/auth";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create Account · BLAXZY" };

export default async function SignupPage() {
  if (await getSession()) redirect("/dashboard");
  return (
    <SignupForm
      minPasswordLength={MIN_PASSWORD_LENGTH}
      maxPasswordLength={MAX_PASSWORD_LENGTH}
      maxNameLength={MAX_NAME_LENGTH}
    />
  );
}
