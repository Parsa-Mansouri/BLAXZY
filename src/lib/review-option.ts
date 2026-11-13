/**
 * The review menus as the browser sees them. The server's `ReviewOption` also carries the fix
 * prompts sent to the model (`instruction`, `instructionTemplate`, `instructionTemplateAuto`);
 * those must never reach a client component. Pages and loaders project every option through
 * `toClientOption` before handing it down, and client code only knows this type.
 */

/** A follow-up chip: a label for the person, the value sent back. */
export type ClientFollowupChoice = { label: string; labelFa?: string; value: string };

export type ClientFollowupStep = {
  type: string;
  label?: string;
  labelFa?: string;
  allowCustom: boolean;
  options: ClientFollowupChoice[];
  dynamicOptionsSource?: string;
  display?: string;
};

export type ClientFollowup = {
  type: string;
  options: ClientFollowupChoice[];
  allowCustom: boolean;
  dynamicOptionsSource?: string;
  steps?: ClientFollowupStep[];
};

export type ClientReviewOptionKind =
  "technical" | "preference" | "regenerate" | "route" | "backend";

export type ClientReviewOption = {
  code: string;
  kind: ClientReviewOptionKind;
  group?: string;
  label: string;
  followup?: ClientFollowup;
  needsText: boolean;
  proOnly: boolean;
  /** The server-computed answer to "does the fix instruction take the person's value?". */
  takesValue: boolean;
  targetCount?: number;
  conflictsWithReference?: string;
  suggestFirst?: string;
  action?: string;
};

/** The fields of a server `ReviewOption` the projection reads. */
export type ServerReviewOptionLike = Omit<ClientReviewOption, "takesValue" | "followup"> & {
  followup?: ClientFollowup;
  instructionTemplate?: string;
};

function choice(c: ClientFollowupChoice): ClientFollowupChoice {
  return c.labelFa === undefined
    ? { label: c.label, value: c.value }
    : { label: c.label, labelFa: c.labelFa, value: c.value };
}

function step(s: ClientFollowupStep): ClientFollowupStep {
  const out: ClientFollowupStep = {
    type: s.type,
    allowCustom: s.allowCustom,
    options: s.options.map(choice),
  };
  if (s.label !== undefined) out.label = s.label;
  if (s.labelFa !== undefined) out.labelFa = s.labelFa;
  if (s.dynamicOptionsSource !== undefined) out.dynamicOptionsSource = s.dynamicOptionsSource;
  if (s.display !== undefined) out.display = s.display;
  return out;
}

function followup(f: ClientFollowup): ClientFollowup {
  const out: ClientFollowup = {
    type: f.type,
    allowCustom: f.allowCustom,
    options: f.options.map(choice),
  };
  if (f.dynamicOptionsSource !== undefined) out.dynamicOptionsSource = f.dynamicOptionsSource;
  if (f.steps) out.steps = f.steps.map(step);
  return out;
}

/**
 * Copies only the client-safe fields (an allow-list, so a field added to the server type later
 * stays server-side) and computes `takesValue` from the instruction template.
 */
export function toClientOption(option: ServerReviewOptionLike): ClientReviewOption {
  const out: ClientReviewOption = {
    code: option.code,
    kind: option.kind,
    label: option.label,
    needsText: option.needsText,
    proOnly: option.proOnly,
    takesValue: option.instructionTemplate?.includes("{value}") ?? false,
  };
  if (option.group !== undefined) out.group = option.group;
  if (option.followup) out.followup = followup(option.followup);
  if (option.targetCount !== undefined) out.targetCount = option.targetCount;
  if (option.conflictsWithReference !== undefined) {
    out.conflictsWithReference = option.conflictsWithReference;
  }
  if (option.suggestFirst !== undefined) out.suggestFirst = option.suggestFirst;
  if (option.action !== undefined) out.action = option.action;
  return out;
}

export function toClientOptions(options: readonly ServerReviewOptionLike[]): ClientReviewOption[] {
  return options.map(toClientOption);
}
