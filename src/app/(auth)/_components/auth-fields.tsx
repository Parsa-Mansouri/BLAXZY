"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { Button, Field, Input } from "@/ui";

/** The short sideways nudge of a field whose error just appeared (250ms, the app's curve). */
const NUDGE: Keyframe[] = [
  { transform: "translateX(0)" },
  { transform: "translateX(-6px)", offset: 0.25 },
  { transform: "translateX(5px)", offset: 0.5 },
  { transform: "translateX(-3px)", offset: 0.75 },
  { transform: "translateX(0)" },
];

/** Nudges the returned element once whenever `error` changes to a new message. Off under reduced motion. */
function useNudgeOnError(error: string | undefined): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!error || !element || typeof element.animate !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    element.animate(NUDGE, { duration: 250, easing: "cubic-bezier(.32,.72,0,1)" });
  }, [error]);
  return ref;
}

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
  const nudge = useNudgeOnError(error);
  return (
    <div ref={nudge} className={style ? "enter" : undefined} style={style}>
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
          className="h-(--btn-lg)"
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
  const nudge = useNudgeOnError(error);
  return (
    <div ref={nudge} className={style ? "enter" : undefined} style={style}>
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
          className="h-(--btn-lg) pr-1.5"
          trailing={
            <Button
              variant="plain"
              size="small"
              aria-pressed={visible}
              aria-label={visible ? "Hide Password" : "Show Password"}
              onClick={() => setVisible((v) => !v)}
            >
              {visible ? "Hide" : "Show"}
            </Button>
          }
        />
        {children}
      </Field>
    </div>
  );
}
