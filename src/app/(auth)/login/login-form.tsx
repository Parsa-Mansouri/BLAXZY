"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { callAuth } from "@/lib/auth-call";
import { describeAuthFailure } from "@/lib/auth-errors";
import { Button, GroupedList, GroupedListField, Input } from "@/ui";
import { FormMessage } from "@/app/_components/form-message";
import { PasswordField } from "@/app/_components/password-field";
import { AuthHeading, AuthLink, AuthLinks } from "../_components/auth-parts";
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
      setError("Enter your email and password.");
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
        title="Verify Your Email"
        intro="This email address is not verified yet, so a new link was sent."
        callbackURL={next}
        onBack={() => setNeedsVerification(false)}
        backLabel="Back to Sign In"
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading title="Sign In" />
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <GroupedList size="large">
          <GroupedListField label="Email" required>
            <Input
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
            />
          </GroupedListField>
          <PasswordField
            label="Password"
            name="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />
        </GroupedList>
        {error ? <FormMessage tone="error">{error}</FormMessage> : null}
        <Button
          type="submit"
          variant="prominent"
          size="large"
          loading={submitting}
          className="mt-2 w-full"
        >
          Sign In
        </Button>
      </form>
      <AuthLinks>
        <AuthLink href="/forgot-password">Forgot Password?</AuthLink>
        <p>
          No account? <AuthLink href="/signup">Create Account</AuthLink>
        </p>
      </AuthLinks>
    </div>
  );
}
