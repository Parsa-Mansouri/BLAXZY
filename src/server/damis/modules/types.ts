/** The tasks damis perform; a module may add guidance specific to each. */
export const DAMI_TASKS = ["write", "check", "revise", "detect", "section", "reference"] as const;
export type DamiTask = (typeof DAMI_TASKS)[number];

/**
 * A prompt module: plain data plus text, composed into a dami's system prompt after the dami's
 * own base prompt. `core` applies to every task; `tasks` adds task-specific guidance.
 * Modules are stable text (no per-project values) so they can be prompt-cached.
 */
export type PromptModule = {
  kind: "genre" | "style";
  /** Stable key, e.g. "thriller". */
  key: string;
  /** Label for the UI, e.g. "Thriller". */
  label: string;
  /** Other names the Style stage may store for this module (matched case- and punctuation-insensitively). */
  aliases: readonly string[];
  core: string;
  tasks: Partial<Record<DamiTask, string>>;
};
