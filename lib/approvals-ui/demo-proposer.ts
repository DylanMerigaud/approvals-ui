import { type EditOp, type EditProposal, proposeEdits, type Proposer } from "./edit-ops";
import { type ApprovalPolicy, type ApprovalStep, isApprovalStep, isTerminalStep } from "./policy";

/**
 * A deterministic, dependency-free proposer so the edit panel works with no
 * model and no API key. It understands a handful of phrasings (thresholds,
 * approvers, quorums, renames, removals) and answers with the same
 * EditProposal contract a real LLM proposer would.
 *
 * In production you swap this for a model: have it emit `EditOp` JSON
 * (validate with `editOpSchema`), then call `proposeEdits`. The UI does not
 * change.
 */

export const demoInstructions = [
  "Above $50k also require the CFO",
  "Add Maria Chen (Controller) to Manager review",
  "Require 2 of the approvers on Finance review",
  "Rename Manager review to Budget owner review",
  "Remove the Director sign-off",
] as const;

const normalize = (text: string): string => {
  return text
    .toLowerCase()
    .replaceAll(/[^a-z0-9\s]/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
};

const cleanRole = (text: string): string => {
  return text
    .replaceAll(/\b(approval|review|sign\s*off|gate|step)\b/gi, " ")
    .replaceAll(/[^\w\s&-]/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
};

const titleCase = (text: string): string => {
  if (text === text.toUpperCase() && text.length <= 4) return text;
  return text
    .split(" ")
    .map((w) =>
      w === w.toUpperCase() && w.length <= 4 ? w : w.charAt(0).toUpperCase() + w.slice(1)
    )
    .join(" ");
};

const slugify = (text: string): string => {
  return normalize(text).replaceAll(/\s/g, "-") || "step";
};

const parseAmount = (raw: string, hasK: boolean): number => {
  const value = Number(raw.replaceAll(",", ""));
  return hasK ? value * 1000 : value;
};

const matchSteps = (policy: ApprovalPolicy, query: string): ApprovalStep[] => {
  const q = normalize(query);
  if (q.length === 0) return [];
  const gates = policy.steps.filter(isApprovalStep);
  const byLabel = gates.filter((s) => {
    const label = normalize(s.label);
    return label.includes(q) || q.includes(label);
  });
  if (byLabel.length > 0) return byLabel;
  return gates.filter((s) =>
    s.approvers.some((a) => {
      const title = normalize(a.title);
      return title.length > 0 && (title.includes(q) || q.includes(title));
    })
  );
};

const clarifyProposal = (
  policy: ApprovalPolicy,
  question: string,
  options?: string[]
): EditProposal => {
  return proposeEdits(policy, [{ op: "clarify", question, options }]);
};

type StepResolution =
  { step: ApprovalStep; clarify?: undefined } | { step?: undefined; clarify: EditProposal };

const resolveStep = (policy: ApprovalPolicy, query: string): StepResolution => {
  const matches = matchSteps(policy, query);
  const [only] = matches;
  if (matches.length === 1 && only) return { step: only };
  if (matches.length === 0) {
    return {
      clarify: clarifyProposal(
        policy,
        `I could not find a step matching "${query.trim()}". Which one did you mean?`,
        policy.steps.filter(isApprovalStep).map((s) => s.label)
      ),
    };
  }
  return {
    clarify: clarifyProposal(
      policy,
      `"${query.trim()}" matches several steps. Which one?`,
      matches.map((s) => s.label)
    ),
  };
};

/** The gate that feeds an approved terminal, else the last gate. */
const lastGate = (policy: ApprovalPolicy): ApprovalStep | undefined => {
  const approvedIds = new Set(
    policy.steps
      .filter(isTerminalStep)
      .filter((t) => t.outcome === "approved")
      .map((t) => t.id)
  );
  const gates = policy.steps.filter(isApprovalStep);
  return gates.find((g) => g.next.some((id) => approvedIds.has(id))) ?? gates.at(-1);
};

const uniqueId = (policy: ApprovalPolicy, base: string): string => {
  if (policy.steps.every((s) => s.id !== base)) return base;
  let i = 2;
  while (policy.steps.some((s) => s.id === `${base}-${i}`)) i += 1;
  return `${base}-${i}`;
};

/**
 * A mandatory regex capture group. When the overall match succeeded, a
 * non-optional group is always present; this asserts that so the value is a
 * `string` (not `string | undefined`) without an `as` cast.
 */
const group = (value: string | undefined): string => {
  if (value === undefined) throw new Error("Expected a matched capture group.");
  return value;
};

const proposeDemoEdit = (instruction: string, policy: ApprovalPolicy): EditProposal => {
  const text = instruction.trim();

  // "Above $50k (also) require the CFO"
  const threshold = text.match(
    /(?:above|over)\s+\$?([\d][\d,.]*)\s*(k)?\b[,:]?\s*(?:also\s+)?require\s+(?:the\s+)?(.+)$/i
  );
  if (threshold) {
    const [, rawAmount, kSuffix, rawRole] = threshold;
    const value = parseAmount(group(rawAmount), kSuffix !== undefined);
    const role = cleanRole(group(rawRole));
    if (!Number.isFinite(value) || role.length === 0) {
      return clarifyProposal(
        policy,
        "I could not read the amount or the role in that instruction."
      );
    }
    const existing = matchSteps(policy, role);
    const [onlyExisting] = existing;
    if (existing.length === 1 && onlyExisting) {
      return proposeEdits(
        policy,
        [{ op: "set-threshold", stepId: onlyExisting.id, value }],
        `Set the "${onlyExisting.label}" threshold to ${value.toLocaleString("en-US")}.`
      );
    }
    const after = lastGate(policy);
    if (!after) {
      return clarifyProposal(policy, "There is no approval gate to attach this to yet.");
    }
    const title = titleCase(role);
    const op: EditOp = {
      op: "insert-approval-after",
      afterId: after.id,
      step: {
        id: uniqueId(policy, slugify(role)),
        label: `${title} approval`,
        when: { kind: "leaf", field: "amount", op: ">", value },
        approvers: [{ name: null, title }],
      },
    };
    return proposeEdits(
      policy,
      [op],
      `Add a ${title} gate for requests above ${value.toLocaleString("en-US")}. The seat is unassigned until you name someone.`
    );
  }

  // "Require 2 of the approvers on Finance review"
  const quorum = text.match(
    /require\s+(\d+)\s+of\s+(?:the\s+)?(?:\d+\s+)?(?:approvers?\s+)?(?:on|for|in)\s+(.+)$/i
  );
  if (quorum) {
    const [, rawCount, rawTarget] = quorum;
    const { step, clarify } = resolveStep(policy, group(rawTarget));
    if (!step) return clarify;
    return proposeEdits(
      policy,
      [{ op: "set-mode", stepId: step.id, mode: "quorum", quorum: Number(rawCount) }],
      `Require ${group(rawCount)} of ${step.approvers.length} approvers on "${step.label}".`
    );
  }

  // "Add Maria Chen (Controller) to Manager review"
  const add = text.match(/add\s+(.+?)(?:\s*\(([^)]+)\))?\s+to\s+(?:the\s+)?(.+)$/i);
  if (add) {
    const [, rawName, rawTitle, rawTarget] = add;
    const { step, clarify } = resolveStep(policy, group(rawTarget));
    if (!step) return clarify;
    const name = group(rawName).trim();
    const title = rawTitle?.trim() || "Approver";
    return runOrExplain(
      policy,
      [{ op: "add-approver", stepId: step.id, approver: { name, title } }],
      `Add ${name} to "${step.label}".`
    );
  }

  // "Remove Maria Chen from Finance review"
  const removalMatch = text.match(/remove\s+(.+?)\s+from\s+(?:the\s+)?(.+)$/i);
  if (removalMatch) {
    const [, rawWho, rawTarget] = removalMatch;
    const { step, clarify } = resolveStep(policy, group(rawTarget));
    if (!step) return clarify;
    const who = group(rawWho).trim();
    const match = step.approvers.find(
      (a) => a.name !== null && normalize(a.name).includes(normalize(who))
    );
    if (!match || match.name === null) {
      return clarifyProposal(
        policy,
        `Nobody called "${who}" approves on "${step.label}".`,
        step.approvers.flatMap((a) => (a.name === null ? [] : [a.name]))
      );
    }
    return runOrExplain(
      policy,
      [{ op: "remove-approver", stepId: step.id, name: match.name }],
      `Remove ${match.name} from "${step.label}".`
    );
  }

  // "Rename Manager review to Budget owner review"
  const rename = text.match(/rename\s+(?:the\s+)?(.+?)\s+to\s+(.+)$/i);
  if (rename) {
    const [, rawFrom, rawTo] = rename;
    const { step, clarify } = resolveStep(policy, group(rawFrom));
    if (!step) return clarify;
    return proposeEdits(
      policy,
      [{ op: "rename-step", stepId: step.id, label: group(rawTo).trim() }],
      `Rename "${step.label}".`
    );
  }

  // "Remove the Director sign-off"
  const remove = text.match(/(?:remove|delete)\s+(?:the\s+)?(.+)$/i);
  if (remove) {
    const [, rawTarget] = remove;
    const { step, clarify } = resolveStep(policy, group(rawTarget));
    if (!step) return clarify;
    return proposeEdits(
      policy,
      [{ op: "remove-step", stepId: step.id }],
      `Remove "${step.label}" and rewire around it.`
    );
  }

  return clarifyProposal(
    policy,
    "The demo parser understands thresholds, approvers, quorums, renames, and removals.",
    [...demoInstructions]
  );
};

export const demoProposer: Proposer = async (instruction, policy) => {
  return await Promise.resolve(proposeDemoEdit(instruction, policy));
};

const runOrExplain = (policy: ApprovalPolicy, ops: EditOp[], reason: string): EditProposal => {
  try {
    return proposeEdits(policy, ops, reason);
  } catch (error) {
    return clarifyProposal(policy, error instanceof Error ? error.message : String(error));
  }
};
