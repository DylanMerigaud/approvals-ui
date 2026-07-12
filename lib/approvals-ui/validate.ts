import {
  type ApprovalPolicy,
  type ApprovalStep,
  approverNames,
  collectLeaves,
  describeCondition,
  isApprovalStep,
  isTerminalStep,
  type PolicyStep,
  stepById,
} from "./policy";

/**
 * Deterministic policy validation. Two severities:
 *
 * - "error": the graph is structurally broken (dangling edge, cycle,
 *   unreachable step, no approved outcome). Block activation on these.
 * - "warning": the graph works but breaks an approval best practice
 *   (unassigned seat, duplicate gate, segregation of duties, a high-value
 *   path with a single approver). Surface them, let the human decide.
 */

export type IssueSeverity = "error" | "warning";

export type PolicyIssue = {
  severity: IssueSeverity;
  code: string;
  message: string;
  stepIds: string[];
};

export type ValidateOptions = {
  /** Amount above which a path should carry at least two approval gates. */
  materiality?: number;
  /** The request field carrying the monetary amount. */
  amountField?: string;
};

const DEFAULTS: Required<ValidateOptions> = {
  materiality: 25_000,
  amountField: "amount",
};

export const validatePolicy = (
  policy: ApprovalPolicy,
  options: ValidateOptions = {}
): PolicyIssue[] => {
  const opts = { ...DEFAULTS, ...options };
  const byId = stepById(policy);
  const issues: PolicyIssue[] = [
    ...duplicateStepIds(policy),
    ...danglingEdges(policy, byId),
    ...rootsValid(policy, byId),
    ...cycleFree(policy, byId),
    ...reachability(policy, byId),
    ...terminals(policy, byId),
    ...quorumValid(policy),
    ...unresolvedApprovers(policy),
    ...duplicateGates(policy),
    ...pathRules(policy, byId, opts),
  ];
  return dedupe(issues);
};

/** No error-severity issue: safe to activate. */
export const isActivatable = (issues: PolicyIssue[]): boolean => {
  return issues.every((i) => i.severity !== "error");
};

// ---------------------------------------------------------------------------
// Structural rules (errors)
// ---------------------------------------------------------------------------

const duplicateStepIds = (policy: ApprovalPolicy): PolicyIssue[] => {
  const seen = new Map<string, number>();
  for (const step of policy.steps) {
    seen.set(step.id, (seen.get(step.id) ?? 0) + 1);
  }
  return [...seen]
    .filter(([, count]) => count > 1)
    .map(([id]) => ({
      severity: "error" as const,
      code: "duplicate-step-id",
      message: `Step id "${id}" is used more than once.`,
      stepIds: [id],
    }));
};

const danglingEdges = (policy: ApprovalPolicy, byId: Map<string, PolicyStep>): PolicyIssue[] => {
  const issues: PolicyIssue[] = [];
  for (const step of policy.steps) {
    for (const nextId of step.next) {
      if (!byId.has(nextId)) {
        issues.push({
          severity: "error",
          code: "dangling-edge",
          message: `"${step.label}" routes to a step that does not exist ("${nextId}").`,
          stepIds: [step.id],
        });
      }
    }
  }
  return issues;
};

const rootsValid = (policy: ApprovalPolicy, byId: Map<string, PolicyStep>): PolicyIssue[] => {
  if (policy.roots.length === 0) {
    return [
      {
        severity: "error",
        code: "no-roots",
        message: "The policy has no entry point.",
        stepIds: [],
      },
    ];
  }
  return policy.roots
    .filter((id) => !byId.has(id))
    .map((id) => ({
      severity: "error" as const,
      code: "unknown-root",
      message: `Entry point "${id}" is not a step in the policy.`,
      stepIds: [id],
    }));
};

/**
 * Drop one from the indegree of each existing successor of `step`, and queue
 * any successor whose indegree reaches zero. The inner half of Kahn's loop,
 * lifted into its own function so the outer traversal stays a single loop.
 */
const relaxSuccessors = (
  step: PolicyStep,
  byId: Map<string, PolicyStep>,
  indegree: Map<string, number>,
  queue: string[]
): void => {
  for (const nextId of step.next) {
    if (!byId.has(nextId)) continue;
    const d = (indegree.get(nextId) ?? 0) - 1;
    indegree.set(nextId, d);
    if (d === 0) queue.push(nextId);
  }
};

const cycleFree = (policy: ApprovalPolicy, byId: Map<string, PolicyStep>): PolicyIssue[] => {
  const indegree = new Map<string, number>();
  for (const step of policy.steps) indegree.set(step.id, 0);
  for (const step of policy.steps) {
    for (const nextId of step.next) {
      if (byId.has(nextId)) {
        indegree.set(nextId, (indegree.get(nextId) ?? 0) + 1);
      }
    }
  }
  const queue = [...indegree].filter(([, d]) => d === 0).map(([id]) => id);
  let processed = 0;
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) continue;
    processed += 1;
    const step = byId.get(id);
    if (!step) continue;
    relaxSuccessors(step, byId, indegree, queue);
  }
  if (processed >= byId.size) return [];
  const stuck = [...indegree].filter(([, d]) => d > 0).map(([id]) => id);
  return [
    {
      severity: "error",
      code: "cycle",
      message: "Approvals must flow one way: the policy contains a cycle.",
      stepIds: stuck,
    },
  ];
};

const reachableFromRoots = (policy: ApprovalPolicy, byId: Map<string, PolicyStep>): Set<string> => {
  const reached = new Set<string>();
  const queue = policy.roots.filter((id) => byId.has(id));
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) continue;
    if (reached.has(id)) continue;
    reached.add(id);
    const step = byId.get(id);
    if (!step) continue;
    for (const nextId of step.next) {
      if (byId.has(nextId) && !reached.has(nextId)) queue.push(nextId);
    }
  }
  return reached;
};

const reachability = (policy: ApprovalPolicy, byId: Map<string, PolicyStep>): PolicyIssue[] => {
  const reached = reachableFromRoots(policy, byId);
  return policy.steps
    .filter((step) => !reached.has(step.id))
    .map((step) => ({
      severity: "error" as const,
      code: "unreachable-step",
      message: `"${step.label}" can never be reached from an entry point.`,
      stepIds: [step.id],
    }));
};

const terminals = (policy: ApprovalPolicy, byId: Map<string, PolicyStep>): PolicyIssue[] => {
  const terminalSteps = policy.steps.filter(isTerminalStep);
  if (terminalSteps.length === 0) {
    return [
      {
        severity: "error",
        code: "no-terminal",
        message: "The policy has no terminal step, so no request can ever finish.",
        stepIds: [],
      },
    ];
  }
  const approved = terminalSteps.filter((t) => t.outcome === "approved");
  if (approved.length === 0) {
    return [
      {
        severity: "error",
        code: "no-approved-terminal",
        message: "No terminal step has the approved outcome: nothing can ever pass.",
        stepIds: terminalSteps.map((t) => t.id),
      },
    ];
  }
  const reached = reachableFromRoots(policy, byId);
  if (approved.every((t) => !reached.has(t.id))) {
    return [
      {
        severity: "error",
        code: "approved-terminal-unreachable",
        message: "The approved outcome can never be reached from an entry point.",
        stepIds: approved.map((t) => t.id),
      },
    ];
  }
  return [];
};

const quorumValid = (policy: ApprovalPolicy): PolicyIssue[] => {
  const issues: PolicyIssue[] = [];
  for (const step of policy.steps) {
    if (!isApprovalStep(step)) continue;
    if (step.mode === "quorum") {
      if (step.quorum === undefined || step.quorum > step.approvers.length) {
        issues.push({
          severity: "error",
          code: "quorum-invalid",
          message: `"${step.label}" asks for a quorum of ${step.quorum ?? "?"} but has ${step.approvers.length} approver${step.approvers.length === 1 ? "" : "s"}.`,
          stepIds: [step.id],
        });
      }
    } else if (step.quorum !== undefined) {
      issues.push({
        severity: "warning",
        code: "quorum-ignored",
        message: `"${step.label}" sets a quorum but its mode is "${step.mode}", so the quorum is ignored.`,
        stepIds: [step.id],
      });
    }
  }
  return issues;
};

// ---------------------------------------------------------------------------
// Best-practice rules (warnings)
// ---------------------------------------------------------------------------

const unresolvedApprovers = (policy: ApprovalPolicy): PolicyIssue[] => {
  const issues: PolicyIssue[] = [];
  for (const step of policy.steps) {
    if (!isApprovalStep(step)) continue;
    for (const approver of step.approvers) {
      if (approver.name === null) {
        issues.push({
          severity: "warning",
          code: "unresolved-approver",
          message: `"${step.label}" has an unassigned ${approver.title} seat.`,
          stepIds: [step.id],
        });
      }
    }
  }
  return issues;
};

const duplicateGates = (policy: ApprovalPolicy): PolicyIssue[] => {
  const seen = new Map<string, ApprovalStep>();
  const issues: PolicyIssue[] = [];
  for (const step of policy.steps) {
    if (!isApprovalStep(step)) continue;
    const roster = step.approvers.map((a) => `${a.name ?? "?"}:${a.title}`);
    roster.sort((a, b) => a.localeCompare(b));
    const key = [roster.join("|"), describeCondition(step.when)].join("::");
    const prior = seen.get(key);
    if (prior) {
      issues.push({
        severity: "warning",
        code: "duplicate-gate",
        message: `"${prior.label}" and "${step.label}" ask the same approvers under the same condition.`,
        stepIds: [prior.id, step.id],
      });
    } else {
      seen.set(key, step);
    }
  }
  return issues;
};

// ---------------------------------------------------------------------------
// Path rules (walk every root-to-approved path)
// ---------------------------------------------------------------------------

const MAX_PATHS = 2000;

const pathsToApproved = (policy: ApprovalPolicy, byId: Map<string, PolicyStep>): PolicyStep[][] => {
  const paths: PolicyStep[][] = [];
  const walk = (step: PolicyStep, path: PolicyStep[], seen: Set<string>) => {
    if (paths.length >= MAX_PATHS || seen.has(step.id)) return;
    const nextPath = [...path, step];
    if (isTerminalStep(step)) {
      if (step.outcome === "approved") paths.push(nextPath);
      return;
    }
    const nextSeen = new Set(seen);
    nextSeen.add(step.id);
    for (const nextId of step.next) {
      const next = byId.get(nextId);
      if (next) walk(next, nextPath, nextSeen);
    }
  };
  for (const rootId of policy.roots) {
    const root = byId.get(rootId);
    if (root) walk(root, [], new Set());
  }
  return paths;
};

/**
 * The lowest amount that traverses this path: the max of the lower bounds
 * set by amount guards along it. A path guarded by "amount > 25,000" has a
 * floor of 25,000; an unguarded path has a floor of 0.
 */
const amountFloor = (path: PolicyStep[], amountField: string): number => {
  let floor = 0;
  for (const step of path) {
    for (const l of collectLeaves(step.when)) {
      if (
        l.field === amountField &&
        typeof l.value === "number" &&
        (l.op === ">" || l.op === ">=")
      ) {
        floor = Math.max(floor, l.value);
      }
    }
  }
  return floor;
};

const pathRules = (
  policy: ApprovalPolicy,
  byId: Map<string, PolicyStep>,
  opts: Required<ValidateOptions>
): PolicyIssue[] => {
  const issues: PolicyIssue[] = [];
  for (const path of pathsToApproved(policy, byId)) {
    const gates = path.filter(isApprovalStep);
    const terminal = path.at(-1);
    // Every path built by pathsToApproved is non-empty and ends at a terminal.
    if (!terminal) continue;

    if (gates.length === 0) {
      issues.push({
        severity: "warning",
        code: "no-approval-before-terminal",
        message: `A request can reach "${terminal.label}" without any human approval.`,
        stepIds: [terminal.id],
      });
    }

    const floor = amountFloor(path, opts.amountField);
    if (floor >= opts.materiality && gates.length < 2) {
      issues.push({
        severity: "warning",
        code: "single-approver-high-value",
        message: `Requests above ${floor.toLocaleString("en-US")} can pass with ${gates.length === 0 ? "no approval gate" : "a single approval gate"}.`,
        stepIds: gates.map((g) => g.id),
      });
    }

    const gatesByName = new Map<string, ApprovalStep[]>();
    for (const gate of gates) {
      for (const name of approverNames(gate)) {
        const list = gatesByName.get(name) ?? [];
        if (!list.includes(gate)) list.push(gate);
        gatesByName.set(name, list);
      }
    }
    for (const [name, dupGates] of gatesByName) {
      if (dupGates.length >= 2) {
        issues.push({
          severity: "warning",
          code: "segregation-of-duties",
          message: `${name} approves twice on the same path (${dupGates.map((g) => `"${g.label}"`).join(", ")}).`,
          stepIds: dupGates.map((g) => g.id),
        });
      }
    }
  }
  return issues;
};

// ---------------------------------------------------------------------------

const dedupe = (issues: PolicyIssue[]): PolicyIssue[] => {
  const seen = new Set<string>();
  const out: PolicyIssue[] = [];
  for (const issue of issues) {
    const sortedStepIds = [...issue.stepIds];
    sortedStepIds.sort((a, b) => a.localeCompare(b));
    const key = `${issue.code}::${sortedStepIds.join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
};
