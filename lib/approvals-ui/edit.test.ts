import { describe, expect, it } from "vitest"
import { demoProposer } from "./demo-proposer"
import { diffPolicies, hasChanges, summarizeChanges } from "./diff"
import { applyEditOp, EditError, proposeEdits } from "./edit-ops"
import { examplePolicy } from "./example-policy"
import { isApprovalStep, type ApprovalStep } from "./policy"

function step(policyLike: typeof examplePolicy, id: string): ApprovalStep {
  const found = policyLike.steps.find((s) => s.id === id)
  if (!found || !isApprovalStep(found)) throw new Error(`no approval step ${id}`)
  return found
}

describe("diffPolicies", () => {
  it("reports renames as changed with the label field", () => {
    const proposed = applyEditOp(examplePolicy, {
      op: "rename-step",
      stepId: "manager-review",
      label: "Budget owner review",
    })
    const changes = diffPolicies(examplePolicy, proposed)
    const changed = changes.find((c) => c.id === "manager-review")
    expect(changed).toMatchObject({ kind: "changed", fields: ["label"] })
    expect(hasChanges(changes)).toBe(true)
    expect(summarizeChanges(changes)).toBe("1 changed")
  })
})

describe("applyEditOp", () => {
  it("set-threshold updates an existing amount leaf", () => {
    const proposed = applyEditOp(examplePolicy, {
      op: "set-threshold",
      stepId: "director-review",
      value: 40_000,
    })
    expect(step(proposed, "director-review").when).toEqual({
      kind: "leaf",
      field: "amount",
      op: ">",
      value: 40_000,
    })
  })

  it("set-threshold replaces an always guard with a leaf", () => {
    const proposed = applyEditOp(examplePolicy, {
      op: "set-threshold",
      stepId: "manager-review",
      value: 1_000,
    })
    expect(step(proposed, "manager-review").when).toMatchObject({ kind: "leaf", value: 1_000 })
  })

  it("set-threshold wraps an unrelated guard in an all()", () => {
    const withDept = applyEditOp(examplePolicy, {
      op: "set-condition",
      stepId: "manager-review",
      when: { kind: "leaf", field: "department", op: "==", value: "Engineering" },
    })
    const proposed = applyEditOp(withDept, {
      op: "set-threshold",
      stepId: "manager-review",
      value: 2_000,
    })
    expect(step(proposed, "manager-review").when.kind).toBe("all")
  })

  it("refuses to add an approver twice", () => {
    expect(() =>
      applyEditOp(examplePolicy, {
        op: "add-approver",
        stepId: "finance-review",
        approver: { name: "Maria Chen", title: "Finance Ops" },
      }),
    ).toThrow(EditError)
  })

  it("refuses to remove the last approver", () => {
    expect(() =>
      applyEditOp(examplePolicy, {
        op: "remove-approver",
        stepId: "manager-review",
        name: "Alex Rivera",
      }),
    ).toThrow(EditError)
  })

  it("remove-step rewires edges and roots", () => {
    const withoutRoot = applyEditOp(examplePolicy, { op: "remove-step", stepId: "manager-review" })
    expect(withoutRoot.roots).toEqual(["finance-review"])

    const withoutMiddle = applyEditOp(examplePolicy, { op: "remove-step", stepId: "director-review" })
    expect(step(withoutMiddle, "finance-review").next).toEqual(["approved"])
  })

  it("insert-approval-after splices into the chain", () => {
    const proposed = applyEditOp(examplePolicy, {
      op: "insert-approval-after",
      afterId: "director-review",
      step: {
        id: "cfo",
        label: "CFO approval",
        approvers: [{ name: null, title: "CFO" }],
      },
    })
    expect(step(proposed, "director-review").next).toEqual(["cfo"])
    expect(step(proposed, "cfo").next).toEqual(["approved"])
  })
})

describe("proposeEdits", () => {
  it("passes clarify through without mutating", () => {
    const proposal = proposeEdits(examplePolicy, [
      { op: "clarify", question: "Which step?" },
    ])
    expect(proposal.clarify?.question).toBe("Which step?")
    expect(hasChanges(proposal.changes)).toBe(false)
  })
})

describe("demoProposer", () => {
  it("inserts a new gate for an unknown role above a threshold", async () => {
    const proposal = await demoProposer("Above $50k also require the CFO", examplePolicy)
    const added = proposal.changes.find((c) => c.kind === "added")
    expect(added?.label).toBe("CFO approval")
    expect(step(proposal.proposed, "director-review").next).toEqual([added?.id])
    const inserted = step(proposal.proposed, added?.id as string)
    expect(inserted.when).toEqual({ kind: "leaf", field: "amount", op: ">", value: 50_000 })
    expect(inserted.approvers).toEqual([{ name: null, title: "CFO" }])
  })

  it("retargets the threshold of an existing gate matched by title", async () => {
    const proposal = await demoProposer("Above $40k require the finance director", examplePolicy)
    const changed = proposal.changes.find((c) => c.id === "director-review")
    expect(changed?.kind).toBe("changed")
    expect(step(proposal.proposed, "director-review").when).toMatchObject({ value: 40_000 })
  })

  it("adds an approver to a step matched by label", async () => {
    const proposal = await demoProposer("Add John Smith (CFO) to Manager review", examplePolicy)
    expect(step(proposal.proposed, "manager-review").approvers).toHaveLength(2)
  })

  it("sets a quorum", async () => {
    const proposal = await demoProposer("Require 3 of the approvers on Finance review", examplePolicy)
    expect(step(proposal.proposed, "finance-review")).toMatchObject({ mode: "quorum", quorum: 3 })
  })

  it("removes a step and rewires", async () => {
    const proposal = await demoProposer("Remove the Director sign-off", examplePolicy)
    expect(proposal.changes.some((c) => c.kind === "removed")).toBe(true)
    expect(step(proposal.proposed, "finance-review").next).toEqual(["approved"])
  })

  it("clarifies instead of guessing", async () => {
    const proposal = await demoProposer("make it rain", examplePolicy)
    expect(proposal.clarify).toBeDefined()
    expect(hasChanges(proposal.changes)).toBe(false)
  })
})
