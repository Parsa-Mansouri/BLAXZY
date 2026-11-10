import type { Metadata } from "next";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/server/auth";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Choose a New Password · BLAXZY" };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = first(params.token);
  const linkProblem = !token || first(params.error) !== undefined;
  return (
    <ResetPasswordForm
      token={linkProblem ? null : (token ?? null)}
      minPasswordLength={MIN_PASSWORD_LENGTH}
      maxPasswordLength={MAX_PASSWORD_LENGTH}
    />
  );
}
