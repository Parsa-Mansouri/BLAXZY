"use client";

import { StandaloneError } from "../_components/standalone-error";

/** An unexpected failure on a sign-in page (login, sign-up, verification, password reset). */
export default function AuthError({ error, retry }: { error: unknown; retry: () => void }) {
  return <StandaloneError error={error} retry={retry} home="/login" homeLabel="Sign In" />;
}
