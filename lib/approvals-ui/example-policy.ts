import type { ApprovalPolicy } from "./policy";

/**
 * A realistic procurement policy to start from: a manager gate, a finance
 * quorum above 5k, a director sign-off above 25k, then the approved terminal.
 * The director seat is deliberately unassigned so validation has something
 * honest to say out of the box.
 */
export const examplePolicy: ApprovalPolicy = {
  name: "Procurement approvals",
  roots: ["manager-review"],
  steps: [
    {
      id: "manager-review",
      kind: "approval",
      label: "Manager review",
      when: { kind: "always" },
      approvers: [{ name: "Alex Rivera", title: "Engineering Manager" }],
      mode: "all",
      next: ["finance-review"],
    },
    {
      id: "finance-review",
      kind: "approval",
      label: "Finance review",
      when: { kind: "leaf", field: "amount", op: ">", value: 5000 },
      approvers: [
        { name: "Priya Patel", title: "Controller" },
        { name: "Sam Okafor", title: "FP&A Lead" },
        { name: "Maria Chen", title: "Finance Ops" },
      ],
      mode: "quorum",
      quorum: 2,
      next: ["director-review"],
    },
    {
      id: "director-review",
      kind: "approval",
      label: "Director sign-off",
      when: { kind: "leaf", field: "amount", op: ">", value: 25_000 },
      approvers: [{ name: null, title: "Finance Director" }],
      mode: "all",
      sla: { hours: 48 },
      next: ["approved"],
    },
    {
      id: "approved",
      kind: "terminal",
      label: "Approved: post to ERP",
      when: { kind: "always" },
      outcome: "approved",
      next: [],
    },
  ],
};
