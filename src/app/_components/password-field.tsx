"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { GroupedListField, IconButton, Input } from "@/ui";

export interface PasswordFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  error?: string;
  name?: string;
  autoFocus?: boolean;
}

/** A grouped-list password row with a show/hide button. The length rule goes in the group footer. */
export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  error,
  name,
  autoFocus,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <GroupedListField label={label} required error={error}>
      <Input
        name={name}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        spellCheck={false}
        autoCapitalize="none"
        trailing={
          <IconButton
            type="button"
            label={visible ? "Hide Password" : "Show Password"}
            aria-pressed={visible}
            icon={visible ? <EyeOff /> : <Eye />}
            onClick={() => setVisible((v) => !v)}
            className="-mr-2 text-label-2 hover:text-label"
          />
        }
      />
    </GroupedListField>
  );
}
