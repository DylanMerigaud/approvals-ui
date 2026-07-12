import { proposeEdits, type EditOp, type EditProposal, type Proposer } from "./edit-ops";
import { isApprovalStep, isTerminalStep, type ApprovalPolicy, type ApprovalStep } from "./policy";

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

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanRole(text: string): string {
  return text
    .replace(/\b(approval|review|sign\s*off|gate|step)\b/gi, " ")
    .replace(/[^\w\s&-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(text: string): string {
  if (text === text.toUpperCase() && text.length <= 4) return text;
  return text
    .split(" ")
    .map((w) =>
      w === w.toUpperCase() && w.length <= 4 ? w : w.charAt(0).toUpperCase() + w.slice(1)
    )
    .join(" ");
}

function slugify(text: string): string {
  return normalize(text).replace(/\s/g, "-") || "step";
}

function parseAmount(raw: string, hasK: boolean): number {
  const value = Number(raw.replace(/,/g, ""));
  return hasK ? value * 1000 : value;
}

function matchSteps(policy: ApprovalPolicy, query: string): ApprovalStep[] {
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
}

function clarifyProposal(
  policy: ApprovalPolicy,
  question: string,
  options?: string[]
): EditProposal {
  return proposeEdits(policy, [{ op: "clarify", question, options }]);
}

function resolveStep(
  policy: ApprovalPolicy,
  query: string
): { step?: ApprovalStep; clarify?: EditProposal } {
  const matches = matchSteps(policy, query);
  if (matches.length === 1) return { step: matches[0] };
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
}

/** The gate that feeds an approved terminal, else the last gate. */
function lastGate(policy: ApprovalPolicy): ApprovalStep | undefined {
  const approvedIds = new Set(
    policy.steps
      .filter(isTerminalStep)
      .filter((t) => t.outcome === "approved")
      .map((t) => t.id)
  );
  const gates = policy.steps.filter(isApprovalStep);
  return gates.find((g) => g.next.some((id) => approvedIds.has(id))) ?? gates[gates.length - 1];
}

function uniqueId(policy: ApprovalPolicy, base: string): string {
  if (!policy.steps.some((s) => s.id === base)) return base;
  let i = 2;
  while (policy.steps.some((s) => s.id === `${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

export const demoProposer: Proposer = async (instruction, policy) => {
  const text = instruction.trim();

  // "Above $50k (also) require the CFO"
  const threshold = text.match(
    /(?:above|over)\s+\$?([\d][\d,.]*)\s*(k)?\b[,:]?\s*(?:also\s+)?require\s+(?:the\s+)?(.+)$/i
  );
  if (threshold) {
    const value = parseAmount(threshold[1], threshold[2] !== undefined);
    const role = cleanRole(threshold[3]);
    if (!Number.isFinite(value) || role.length === 0) {
      return clarifyProposal(
        policy,
        "I could not read the amount or the role in that instruction."
      );
    }
    const existing = matchSteps(policy, role);
    if (existing.length === 1) {
      return proposeEdits(
        policy,
        [{ op: "set-threshold", stepId: existing[0].id, value }],
        `Set the "${existing[0].label}" threshold to ${value.toLocaleString("en-US")}.`
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
    const { step, clarify } = resolveStep(policy, quorum[2]);
    if (!step) return clarify as EditProposal;
    return proposeEdits(
      policy,
      [{ op: "set-mode", stepId: step.id, mode: "quorum", quorum: Number(quorum[1]) }],
      `Require ${quorum[1]} of ${step.approvers.length} approvers on "${step.label}".`
    );
  }

  // "Add Maria Chen (Controller) to Manager review"
  const add = text.match(/add\s+(.+?)(?:\s*\(([^)]+)\))?\s+to\s+(?:the\s+)?(.+)$/i);
  if (add) {
    const { step, clarify } = resolveStep(policy, add[3]);
    if (!step) return clarify as EditProposal;
    const name = add[1].trim();
    const title = add[2]?.trim() || "Approver";
    return runOrExplain(
      policy,
      [{ op: "add-approver", stepId: step.id, approver: { name, title } }],
      `Add ${name} to "${step.label}".`
    );
  }

  // "Remove Maria Chen from Finance review"
  const removeFrom = text.match(/remove\s+(.+?)\s+from\s+(?:the\s+)?(.+)$/i);
  if (removeFrom) {
    const { step, clarify } = resolveStep(policy, removeFrom[2]);
    if (!step) return clarify as EditProposal;
    const who = removeFrom[1].trim();
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
    const { step, clarify } = resolveStep(policy, rename[1]);
    if (!step) return clarify as EditProposal;
    return proposeEdits(
      policy,
      [{ op: "rename-step", stepId: step.id, label: rename[2].trim() }],
      `Rename "${step.label}".`
    );
  }

  // "Remove the Director sign-off"
  const remove = text.match(/(?:remove|delete)\s+(?:the\s+)?(.+)$/i);
  if (remove) {
    const { step, clarify } = resolveStep(policy, remove[1]);
    if (!step) return clarify as EditProposal;
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

function runOrExplain(policy: ApprovalPolicy, ops: EditOp[], reason: string): EditProposal {
  try {
    return proposeEdits(policy, ops, reason);
  } catch (error) {
    return clarifyProposal(policy, error instanceof Error ? error.message : String(error));
  }
}
