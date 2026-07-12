import { type ApprovalPolicy, describeCondition, type PolicyStep } from "./policy";

/**
 * Step-level diff between two policies, keyed by step id. This is the unit
 * the canvas renders (rings on added/changed/removed nodes) and the unit an
 * edit proposal reports before the human applies it.
 */
export type StepChange =
  | { kind: "added"; id: string; label: string }
  | { kind: "removed"; id: string; label: string }
  | { kind: "changed"; id: string; label: string; fields: string[] }
  | { kind: "unchanged"; id: string; label: string };

const roster = (step: PolicyStep): string => {
  if (step.kind !== "approval") return "";
  return step.approvers.map((a) => `${a.name ?? "?"}:${a.title}`).join("|");
};

const slaKey = (step: PolicyStep): string => {
  if (step.kind !== "approval" || !step.sla) return "";
  const escalate = step.sla.escalateTo
    ? `${step.sla.escalateTo.name ?? "?"}:${step.sla.escalateTo.title}`
    : "";
  return `${step.sla.hours}h${escalate}`;
};

export const stepFieldDiffs = (before: PolicyStep, after: PolicyStep): string[] => {
  const fields: string[] = [];
  if (before.kind !== after.kind) fields.push("type");
  if (before.label !== after.label) fields.push("label");
  if (describeCondition(before.when) !== describeCondition(after.when)) {
    fields.push("condition");
  }
  if (roster(before) !== roster(after)) fields.push("approvers");
  if (
    before.kind === "approval" &&
    after.kind === "approval" &&
    (before.mode !== after.mode || before.quorum !== after.quorum)
  ) {
    fields.push("mode");
  }
  if (slaKey(before) !== slaKey(after)) fields.push("sla");
  if (before.kind === "terminal" && after.kind === "terminal" && before.outcome !== after.outcome) {
    fields.push("outcome");
  }
  if (before.next.join(",") !== after.next.join(",")) fields.push("routing");
  return fields;
};

export const diffPolicies = (current: ApprovalPolicy, proposed: ApprovalPolicy): StepChange[] => {
  const before = new Map(current.steps.map((s) => [s.id, s]));
  const after = new Map(proposed.steps.map((s) => [s.id, s]));
  const changes: StepChange[] = [];

  for (const step of proposed.steps) {
    const prev = before.get(step.id);
    if (!prev) {
      changes.push({ kind: "added", id: step.id, label: step.label });
      continue;
    }
    const fields = stepFieldDiffs(prev, step);
    changes.push(
      fields.length > 0
        ? { kind: "changed", id: step.id, label: step.label, fields }
        : { kind: "unchanged", id: step.id, label: step.label }
    );
  }

  for (const step of current.steps) {
    if (!after.has(step.id)) {
      changes.push({ kind: "removed", id: step.id, label: step.label });
    }
  }

  return changes;
};

/** True when the diff contains a real mutation. */
export const hasChanges = (changes: StepChange[]): boolean => {
  return changes.some((c) => c.kind !== "unchanged");
};

/** "2 added, 1 changed, 1 removed" style summary for the proposal banner. */
export const summarizeChanges = (changes: StepChange[]): string => {
  const counts = {
    added: changes.filter((c) => c.kind === "added").length,
    changed: changes.filter((c) => c.kind === "changed").length,
    removed: changes.filter((c) => c.kind === "removed").length,
  };
  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => `${n} ${kind}`);
  return parts.length > 0 ? parts.join(", ") : "no changes";
};
