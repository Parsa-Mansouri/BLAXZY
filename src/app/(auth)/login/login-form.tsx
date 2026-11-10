"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { callAuth } from "@/lib/auth-call";
import { describeAuthFailure } from "@/lib/auth-errors";
import { Button, Field, Input } from "@/ui";
import { FormMessage } from "@/app/_components/form-message";
import { PasswordField } from "@/app/_components/password-field";
import { CheckEmail } from "../_components/check-email";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError("Enter your email and password to sign in.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await callAuth((fetchOptions) =>
      authClient.signIn.email({ email: email.trim(), password, callbackURL: next, fetchOptions }),
    );
    if (result.ok) {
      router.replace(next);
      router.refresh();
      return;
    }
    setSubmitting(false);
    if (result.failure.code === "EMAIL_NOT_VERIFIED") {
      setNeedsVerification(true);
      return;
    }
    setError(describeAuthFailure(result.failure, "sign-in"));
  }

  if (needsVerification) {
    return (
      <CheckEmail
        email={email.trim()}
        title="Verify your email first"
        intro="Your email is not verified yet, so we just sent you a fresh link."
        callbackURL={next}
        onBack={() => setNeedsVerification(false)}
        backLabel="Back to sign in"
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-sm text-fg-muted">Sign in to pick up your films where you left them.</p>
      </div>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <Field label="Email" required>
          <Input
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="you@example.com"
            autoFocus
          />
        </Field>
        <PasswordField
          label="Password"
          name="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        <Link
          href="/forgot-password"
          className="-mt-2 w-fit rounded-xs text-sm text-accent-text focus-ring hover:underline"
        >
          Forgot your password?
        </Link>
        {error ? <FormMessage tone="error">{error}</FormMessage> : null}
        <Button type="submit" size="lg" loading={submitting}>
          Sign in
        </Button>
      </form>
      <p className="text-center text-sm text-fg-muted">
        New here?{" "}
        <Link href="/signup" className="rounded-xs text-accent-text focus-ring hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
