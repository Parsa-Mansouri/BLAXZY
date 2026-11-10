"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { callAuth } from "@/lib/auth-call";
import { describeAuthFailure } from "@/lib/auth-errors";
import { Button, Field, Input } from "@/ui";
import { FormMessage } from "@/app/_components/form-message";
import { PasswordField } from "@/app/_components/password-field";
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
    if (!name.trim()) found.name = "Tell us what to call you.";
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      found.email = "That does not look like an email address. Check for a missing @ or dot.";
    }
    if (password.length < minPasswordLength) {
      found.password = `Your password needs at least ${minPasswordLength} characters. It has ${password.length}.`;
    } else if (password.length > maxPasswordLength) {
      found.password = `Your password can be at most ${maxPasswordLength} characters. Shorten it.`;
    }
    return found;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
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
        title="Check your email"
        intro="One more step: confirm your address and you are in."
        callbackURL={CALLBACK_URL}
        onBack={() => setSentTo(null)}
        backLabel="Use a different email"
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-sm text-fg-muted">Start your first film in a few minutes.</p>
      </div>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <Field label="Your name" required error={errors.name}>
          <Input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            autoFocus
          />
        </Field>
        <Field label="Email" required error={errors.email} hint="We send a confirmation link here.">
          <Input
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="you@example.com"
          />
        </Field>
        <PasswordField
          label="Password"
          name="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          minLength={minPasswordLength}
          error={errors.password}
        />
        {formError ? <FormMessage tone="error">{formError}</FormMessage> : null}
        <Button type="submit" size="lg" loading={submitting}>
          Create account
        </Button>
      </form>
      <p className="text-center text-sm text-fg-muted">
        Already have an account?{" "}
        <Link href="/login" className="rounded-xs text-accent-text focus-ring hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
