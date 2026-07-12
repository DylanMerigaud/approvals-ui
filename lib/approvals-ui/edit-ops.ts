import { z } from "zod";

import { diffPolicies, type StepChange } from "./diff";
import {
  approvalModes,
  type ApprovalPolicy,
  type ApprovalStep,
  approverSchema,
  type Condition,
  conditionSchema,
  isApprovalStep,
} from "./policy";

/**
 * Edit ops: the safe write surface for a policy.
 *
 * A proposer (an LLM, a form, the demo parser) never regenerates the whole
 * policy. It emits one small op; `applyEditOp` applies it deterministically
 * and copies everything unrelated verbatim. That keeps proposals reviewable:
 * the diff is exactly what the op touched, nothing can drift.
 *
 * "none" and "clarify" are part of the contract so a proposer can decline or
 * ask instead of guessing.
 */

const clarifyOptionsSchema = z.array(z.string()).optional();

const insertApprovalStepSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  when: conditionSchema.optional(),
  approvers: z.array(approverSchema).min(1),
  mode: z.enum(approvalModes).optional(),
  quorum: z.number().int().positive().optional(),
});

export const editOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("set-condition"),
    stepId: z.string(),
    when: conditionSchema,
  }),
  z.object({
    op: z.literal("set-threshold"),
    stepId: z.string(),
    value: z.number(),
    field: z.string().optional(),
    comparator: z.enum([">", ">="]).optional(),
  }),
  z.object({
    op: z.literal("add-approver"),
    stepId: z.string(),
    approver: approverSchema,
  }),
  z.object({
    op: z.literal("remove-approver"),
    stepId: z.string(),
    name: z.string(),
  }),
  z.object({
    op: z.literal("set-approvers"),
    stepId: z.string(),
    approvers: z.array(approverSchema).min(1),
  }),
  z.object({
    op: z.literal("set-mode"),
    stepId: z.string(),
    mode: z.enum(approvalModes),
    quorum: z.number().int().positive().optional(),
  }),
  z.object({
    op: z.literal("rename-step"),
    stepId: z.string(),
    label: z.string().min(1),
  }),
  z.object({ op: z.literal("remove-step"), stepId: z.string() }),
  z.object({
    op: z.literal("insert-approval-after"),
    afterId: z.string(),
    step: insertApprovalStepSchema,
  }),
  z.object({ op: z.literal("none"), reason: z.string() }),
  z.object({
    op: z.literal("clarify"),
    question: z.string(),
    options: clarifyOptionsSchema,
  }),
]);
export type EditOp = z.infer<typeof editOpSchema>;

export class EditError extends Error {}

/**
 * The contract between an edit UI and whatever proposes edits. Wire it to a
 * model (parse its output with `editOpSchema`, apply with `proposeEdits`) or
 * to anything else that returns a proposed policy plus its diff.
 */
export type EditProposal = {
  proposed: ApprovalPolicy;
  changes: StepChange[];
  reason?: string;
  clarify?: { question: string; options?: string[] };
};

export type Proposer = (instruction: string, policy: ApprovalPolicy) => Promise<EditProposal>;

// ---------------------------------------------------------------------------

const mustGetApproval = (policy: ApprovalPolicy, stepId: string): ApprovalStep => {
  const step = policy.steps.find((s) => s.id === stepId);
  if (!step) throw new EditError(`Unknown step "${stepId}".`);
  if (!isApprovalStep(step)) {
    throw new EditError(`"${step.label}" is a terminal step, not an approval gate.`);
  }
  return step;
};

const setThreshold = (
  when: Condition,
  field: string,
  comparator: ">" | ">=",
  value: number
): { condition: Condition; replaced: boolean } => {
  switch (when.kind) {
    case "always": {
      return { condition: { kind: "leaf", field, op: comparator, value }, replaced: true };
    }
    case "leaf": {
      if (when.field === field) {
        return { condition: { kind: "leaf", field, op: comparator, value }, replaced: true };
      }
      return { condition: when, replaced: false };
    }
    case "all":
    case "any": {
      let isReplaced = false;
      const conditions = when.conditions.map((c) => {
        const result = setThreshold(c, field, comparator, value);
        isReplaced ||= result.replaced;
        return result.condition;
      });
      return { condition: { kind: when.kind, conditions }, replaced: isReplaced };
    }
  }
};

export const applyEditOp = (policy: ApprovalPolicy, op: EditOp): ApprovalPolicy => {
  const next = structuredClone(policy);
  switch (op.op) {
    case "none":
    case "clarify": {
      return next;
    }

    case "set-condition": {
      const step = next.steps.find((s) => s.id === op.stepId);
      if (!step) throw new EditError(`Unknown step "${op.stepId}".`);
      step.when = op.when;
      return next;
    }

    case "set-threshold": {
      const step = next.steps.find((s) => s.id === op.stepId);
      if (!step) throw new EditError(`Unknown step "${op.stepId}".`);
      const field = op.field ?? "amount";
      const comparator = op.comparator ?? ">";
      const result = setThreshold(step.when, field, comparator, op.value);
      step.when = result.replaced
        ? result.condition
        : {
            kind: "all",
            conditions: [step.when, { kind: "leaf", field, op: comparator, value: op.value }],
          };
      return next;
    }

    case "add-approver": {
      const step = mustGetApproval(next, op.stepId);
      const isExists = step.approvers.some((a) => a.name !== null && a.name === op.approver.name);
      if (isExists)
        throw new EditError(`${op.approver.name} is already an approver on "${step.label}".`);
      step.approvers.push(op.approver);
      return next;
    }

    case "remove-approver": {
      const step = mustGetApproval(next, op.stepId);
      const remaining = step.approvers.filter((a) => a.name !== op.name);
      if (remaining.length === step.approvers.length) {
        throw new EditError(`${op.name} is not an approver on "${step.label}".`);
      }
      if (remaining.length === 0) {
        throw new EditError(
          `"${step.label}" needs at least one approver. Remove the step instead.`
        );
      }
      step.approvers = remaining;
      if (step.mode === "quorum" && step.quorum !== undefined && step.quorum > remaining.length) {
        step.quorum = remaining.length;
      }
      return next;
    }

    case "set-approvers": {
      const step = mustGetApproval(next, op.stepId);
      step.approvers = op.approvers;
      if (
        step.mode === "quorum" &&
        step.quorum !== undefined &&
        step.quorum > op.approvers.length
      ) {
        step.quorum = op.approvers.length;
      }
      return next;
    }

    case "set-mode": {
      const step = mustGetApproval(next, op.stepId);
      step.mode = op.mode;
      step.quorum = op.mode === "quorum" ? (op.quorum ?? step.quorum) : undefined;
      return next;
    }

    case "rename-step": {
      const step = next.steps.find((s) => s.id === op.stepId);
      if (!step) throw new EditError(`Unknown step "${op.stepId}".`);
      step.label = op.label;
      return next;
    }

    case "remove-step": {
      const removed = next.steps.find((s) => s.id === op.stepId);
      if (!removed) throw new EditError(`Unknown step "${op.stepId}".`);
      next.steps = next.steps.filter((s) => s.id !== op.stepId);
      for (const step of next.steps) {
        if (!step.next.includes(op.stepId)) continue;
        const rewired = step.next.flatMap((id) =>
          id === op.stepId ? removed.next.filter((n) => n !== step.id) : [id]
        );
        step.next = [...new Set(rewired)];
      }
      if (next.roots.includes(op.stepId)) {
        next.roots = [
          ...new Set(next.roots.flatMap((id) => (id === op.stepId ? removed.next : [id]))),
        ];
      }
      return next;
    }

    case "insert-approval-after": {
      if (next.steps.some((s) => s.id === op.step.id)) {
        throw new EditError(`Step id "${op.step.id}" already exists.`);
      }
      const after = mustGetApproval(next, op.afterId);
      const inserted: ApprovalStep = {
        id: op.step.id,
        kind: "approval",
        label: op.step.label,
        when: op.step.when ?? { kind: "always" },
        approvers: op.step.approvers,
        mode: op.step.mode ?? "all",
        quorum: op.step.quorum,
        next: [...after.next],
      };
      after.next = [inserted.id];
      next.steps.push(inserted);
      return next;
    }
  }
};

/**
 * Apply a sequence of ops and report the resulting diff. "none" and
 * "clarify" ops short-circuit into the proposal metadata instead of mutating.
 */
export const proposeEdits = (
  policy: ApprovalPolicy,
  ops: EditOp[],
  reason?: string
): EditProposal => {
  let proposed = policy;
  let clarify: EditProposal["clarify"];
  let declined: string | undefined;
  for (const op of ops) {
    if (op.op === "clarify") {
      clarify = { question: op.question, options: op.options };
      continue;
    }
    if (op.op === "none") {
      declined = op.reason;
      continue;
    }
    proposed = applyEditOp(proposed, op);
  }
  return {
    proposed,
    changes: diffPolicies(policy, proposed),
    reason: reason ?? declined,
    clarify,
  };
};
