"use client";

import { useState, type ChangeEvent, type CSSProperties, type ReactNode } from "react";
import { Field, Input } from "@/ui";

/** A labelled 48px text field of the sign-in screens. */
export function AuthField({
  label,
  error,
  hint,
  style,
  name,
  type = "text",
  value,
  onChange,
  autoComplete,
  placeholder,
  autoFocus,
  maxLength,
}: {
  label: string;
  error?: string;
  hint?: ReactNode;
  /** `stagger(i)` for the entrance (the field's wrapper carries the `enter` class). */
  style?: CSSProperties;
  name: string;
  type?: "text" | "email";
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  placeholder?: string;
  autoFocus?: boolean;
  maxLength?: number;
}) {
  return (
    <div className={style ? "enter" : undefined} style={style}>
      <Field label={label} error={error} hint={hint} required>
        <Input
          name={name}
          type={type}
          value={value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
          autoComplete={autoComplete}
          autoCapitalize={type === "email" ? "none" : undefined}
          spellCheck={type === "email" ? false : undefined}
          placeholder={placeholder}
          autoFocus={autoFocus}
          maxLength={maxLength}
          className="h-12"
        />
      </Field>
    </div>
  );
}

/** A labelled 48px password field with a text "Show" / "Hide" button (also used on Account). */
export function AuthPasswordField({
  label,
  error,
  hint,
  style,
  name,
  value,
  onChange,
  autoComplete,
  autoFocus,
  children,
}: {
  label: string;
  error?: string;
  hint?: ReactNode;
  style?: CSSProperties;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  autoFocus?: boolean;
  /** Extra content under the field, e.g. the Forgot Password link. */
  children?: ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className={style ? "enter" : undefined} style={style}>
      <Field label={label} error={error} hint={hint} required>
        <Input
          name={name}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          spellCheck={false}
          autoCapitalize="none"
          className="h-12 pr-1.5"
          trailing={
            <button
              type="button"
              aria-pressed={visible}
              aria-label={visible ? "Hide Password" : "Show Password"}
              onClick={() => setVisible((v) => !v)}
              className="h-9 press rounded-row px-2.5 text-secondary font-medium text-label-2 focus-ring hover:text-label"
            >
              {visible ? "Hide" : "Show"}
            </button>
          }
        />
        {children}
      </Field>
    </div>
  );
}
