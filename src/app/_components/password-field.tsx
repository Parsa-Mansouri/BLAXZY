"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Field, IconButton, Input } from "@/ui";

export interface PasswordFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  /** Shows "At least N characters" as the hint (new passwords only). */
  minLength?: number;
  error?: string;
  name?: string;
  labelAccessory?: React.ReactNode;
}

/** Password input with a show/hide toggle and the length rule shown before the user fails it. */
export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  minLength,
  error,
  name,
  labelAccessory,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <Field
      label={label}
      required
      error={error}
      labelAccessory={labelAccessory}
      hint={
        minLength ? `Use at least ${minLength} characters. A short sentence works well.` : undefined
      }
    >
      <Input
        name={name}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        spellCheck={false}
        autoCapitalize="none"
        trailing={
          <IconButton
            type="button"
            size="sm"
            variant="ghost"
            label={visible ? "Hide password" : "Show password"}
            aria-pressed={visible}
            icon={visible ? <EyeOff /> : <Eye />}
            onClick={() => setVisible((v) => !v)}
          />
        }
      />
    </Field>
  );
}
