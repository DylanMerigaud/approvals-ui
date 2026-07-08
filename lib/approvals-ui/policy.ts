import { z } from "zod"

/**
 * approvals-ui policy schema.
 *
 * An ApprovalPolicy is a DAG of steps. Execution enters at `roots`, follows
 * `next` edges, and ends at terminal steps. Every step carries a `when`
 * condition (a guard): a step whose condition is false for a given request is
 * skipped and its edges pass through. Conditions never live on edges, so the
 * graph stays legible and the diff stays small.
 */

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

export const conditionOps = [">", ">=", "<", "<=", "==", "!="] as const
export type ConditionOp = (typeof conditionOps)[number]

export type ConditionLeaf = {
  kind: "leaf"
  /** The request field this guard reads, e.g. "amount", "department". */
  field: string
  op: ConditionOp
  value: string | number
}

export type Condition =
  | { kind: "always" }
  | ConditionLeaf
  | { kind: "all"; conditions: Condition[] }
  | { kind: "any"; conditions: Condition[] }

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("always") }),
    z.object({
      kind: z.literal("leaf"),
      field: z.string().min(1),
      op: z.enum(conditionOps),
      value: z.union([z.string(), z.number()]),
    }),
    z.object({
      kind: z.literal("all"),
      conditions: z.array(conditionSchema).min(1),
    }),
    z.object({
      kind: z.literal("any"),
      conditions: z.array(conditionSchema).min(1),
    }),
  ]),
) as z.ZodType<Condition>

export const always: Condition = { kind: "always" }

export function leaf(
  field: string,
  op: ConditionOp,
  value: string | number,
): Condition {
  return { kind: "leaf", field, op, value }
}

/** Every leaf in the condition tree, in reading order. */
export function collectLeaves(condition: Condition): ConditionLeaf[] {
  switch (condition.kind) {
    case "always":
      return []
    case "leaf":
      return [condition]
    case "all":
    case "any":
      return condition.conditions.flatMap(collectLeaves)
  }
}

function formatValue(value: string | number): string {
  return typeof value === "number" ? value.toLocaleString("en-US") : value
}

/** Human-readable condition, for pills and tooltips. */
export function humanizeCondition(condition: Condition): string {
  switch (condition.kind) {
    case "always":
      return "always"
    case "leaf":
      return `${condition.field} ${condition.op} ${formatValue(condition.value)}`
    case "all":
      return condition.conditions
        .map((c) => (c.kind === "all" || c.kind === "any" ? `(${humanizeCondition(c)})` : humanizeCondition(c)))
        .join(" and ")
    case "any":
      return condition.conditions
        .map((c) => (c.kind === "all" || c.kind === "any" ? `(${humanizeCondition(c)})` : humanizeCondition(c)))
        .join(" or ")
  }
}

/** Canonical string for a condition. Stable, locale-free: used by the diff. */
export function describeCondition(condition: Condition): string {
  switch (condition.kind) {
    case "always":
      return "always"
    case "leaf":
      return `${condition.field}${condition.op}${String(condition.value)}`
    case "all":
      return `all(${condition.conditions.map(describeCondition).join(",")})`
    case "any":
      return `any(${condition.conditions.map(describeCondition).join(",")})`
  }
}

// ---------------------------------------------------------------------------
// Approvers and steps
// ---------------------------------------------------------------------------

export const approverSchema = z.object({
  /** null = seat exists but nobody is assigned yet (surfaced by validation). */
  name: z.string().min(1).nullable(),
  title: z.string().min(1),
})
export type Approver = z.infer<typeof approverSchema>

export const approvalModes = ["all", "any", "quorum"] as const
export type ApprovalMode = (typeof approvalModes)[number]

export const slaSchema = z.object({
  hours: z.number().positive(),
  escalateTo: approverSchema.optional(),
})
export type Sla = z.infer<typeof slaSchema>

export const approvalStepSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("approval"),
  label: z.string().min(1),
  when: conditionSchema,
  approvers: z.array(approverSchema).min(1),
  /** all = every approver signs, any = one is enough, quorum = `quorum` of them. */
  mode: z.enum(approvalModes),
  quorum: z.number().int().positive().optional(),
  sla: slaSchema.optional(),
  next: z.array(z.string()),
})
export type ApprovalStep = z.infer<typeof approvalStepSchema>

export const terminalStepSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("terminal"),
  label: z.string().min(1),
  when: conditionSchema,
  outcome: z.enum(["approved", "rejected"]),
  next: z.array(z.string()).max(0),
})
export type TerminalStep = z.infer<typeof terminalStepSchema>

export const policyStepSchema = z.discriminatedUnion("kind", [
  approvalStepSchema,
  terminalStepSchema,
])
export type PolicyStep = z.infer<typeof policyStepSchema>

export const approvalPolicySchema = z.object({
  name: z.string().min(1),
  steps: z.array(policyStepSchema),
  /** Entry points: step ids with no incoming edge. */
  roots: z.array(z.string()).min(1),
})
export type ApprovalPolicy = z.infer<typeof approvalPolicySchema>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isApprovalStep(step: PolicyStep): step is ApprovalStep {
  return step.kind === "approval"
}

export function isTerminalStep(step: PolicyStep): step is TerminalStep {
  return step.kind === "terminal"
}

export function stepById(policy: ApprovalPolicy): Map<string, PolicyStep> {
  return new Map(policy.steps.map((s) => [s.id, s]))
}

/** Assigned approver names on a gate (unassigned seats excluded). */
export function approverNames(step: ApprovalStep): string[] {
  return step.approvers.flatMap((a) => (a.name === null ? [] : [a.name]))
}

/** How many signatures the gate needs before it passes. */
export function requiredApprovals(step: ApprovalStep): number {
  switch (step.mode) {
    case "all":
      return step.approvers.length
    case "any":
      return 1
    case "quorum":
      return step.quorum ?? step.approvers.length
  }
}

/** "2 of 3", "any of 2", or "all" style summary for badges. */
export function summarizeMode(step: ApprovalStep): string {
  const total = step.approvers.length
  switch (step.mode) {
    case "all":
      return total > 1 ? `all ${total}` : "1 approver"
    case "any":
      return `any of ${total}`
    case "quorum":
      return `${step.quorum ?? total} of ${total}`
  }
}
