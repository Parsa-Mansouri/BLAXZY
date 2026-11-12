"use client";

import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { callAuth } from "@/lib/auth-call";
import { describeAuthFailure } from "@/lib/auth-errors";
import { Button, stagger } from "@/ui";
import { FormMessage } from "@/app/_components/form-message";
import { AuthField, AuthPasswordField } from "../_components/auth-fields";
import { AuthLink, AuthLinks, AuthScreen } from "../_components/auth-parts";
import { CheckEmail } from "../_components/check-email";

const CALLBACK_URL = "/dashboard";

type Errors = { name?: string; email?: string; password?: string };

export function SignupForm({
  minPasswordLength,
  maxPasswordLength,
}: {
  minPasswordLength: number;
  maxPasswordLength: number;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  function validate(): Errors {
    const found: Errors = {};
    if (!name.trim()) found.name = "Enter your name.";
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      found.email = "Enter an email address such as name@example.com.";
    }
    if (password.length < minPasswordLength) {
      found.password = `Use at least ${minPasswordLength} characters. This has ${password.length}.`;
    } else if (password.length > maxPasswordLength) {
      found.password = `Use at most ${maxPasswordLength} characters.`;
    }
    return found;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const found = validate();
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    const result = await callAuth((fetchOptions) =>
      authClient.signUp.email({
        name: name.trim(),
        email: email.trim(),
        password,
        callbackURL: CALLBACK_URL,
        fetchOptions,
      }),
    );
    setSubmitting(false);
    if (result.ok) {
      setSentTo(email.trim());
    } else {
      setFormError(describeAuthFailure(result.failure, "sign-up"));
    }
  }

  if (sentTo) {
    return (
      <CheckEmail
        email={sentTo}
        title={["Check Your", "Email"]}
        intro="Open the link in the email to confirm your address and finish creating the account."
        callbackURL={CALLBACK_URL}
        onBack={() => setSentTo(null)}
        backLabel="Use a Different Email"
      />
    );
  }

  return (
    <AuthScreen
      title={["Create", "Account"]}
      description="An account keeps your films, scripts and assets in one place."
      label="Create account"
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <AuthField
          label="Name"
          name="name"
          value={name}
          onChange={setName}
          autoComplete="name"
          error={errors.name}
          autoFocus
          style={stagger(0)}
        />
        <AuthField
          label="Email"
          name="email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          placeholder="you@example.com"
          error={errors.email}
          style={stagger(1)}
        />
        <AuthPasswordField
          label="Password"
          name="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          error={errors.password}
          hint={`Use at least ${minPasswordLength} characters.`}
          style={stagger(2)}
        />
        {formError ? <FormMessage tone="error">{formError}</FormMessage> : null}
        <div className="mt-3 flex enter flex-col items-start gap-6" style={stagger(3)}>
          <Button type="submit" variant="primary" size="large" loading={submitting}>
            Create Account
          </Button>
          <AuthLinks>
            <p>
              Already have an account? <AuthLink href="/login">Sign in.</AuthLink>
            </p>
          </AuthLinks>
        </div>
      </form>
    </AuthScreen>
  );
}
