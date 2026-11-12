"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { callAuth } from "@/lib/auth-call";
import { describeAuthFailure } from "@/lib/auth-errors";
import { Button, stagger } from "@/ui";
import { FormMessage } from "@/app/_components/form-message";
import { AuthField, AuthPasswordField } from "../_components/auth-fields";
import { AuthLink, AuthLinks, AuthScreen } from "../_components/auth-parts";
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
    if (submitting) return;
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
        title={["Verify Your", "Email"]}
        intro="This email address is not verified yet, so a new link was sent."
        callbackURL={next}
        onBack={() => setNeedsVerification(false)}
        backLabel="Back to Sign In"
      />
    );
  }

  return (
    <AuthScreen
      title={["Sign In"]}
      description="Your films are where you left them."
      label="Sign in"
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <AuthField
          label="Email"
          name="email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          placeholder="you@example.com"
          autoFocus
          style={stagger(0)}
        />
        <AuthPasswordField
          label="Password"
          name="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          style={stagger(1)}
        >
          <div className="mt-2">
            <AuthLink href="/forgot-password">Forgot Password?</AuthLink>
          </div>
        </AuthPasswordField>
        {error ? <FormMessage tone="error">{error}</FormMessage> : null}
        <div className="mt-3 flex enter flex-col items-start gap-6" style={stagger(2)}>
          <Button type="submit" variant="primary" size="large" loading={submitting}>
            Sign In
          </Button>
          <AuthLinks>
            <p>
              No account yet? <AuthLink href="/signup">Create one.</AuthLink>
            </p>
          </AuthLinks>
        </div>
      </form>
    </AuthScreen>
  );
}
