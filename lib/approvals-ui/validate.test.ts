import { describe, expect, it } from "vitest";

import type { ApprovalPolicy, ApprovalStep, PolicyStep } from "./policy";

import { examplePolicy } from "./example-policy";
import { isActivatable, validatePolicy } from "./validate";

const policy = (steps: PolicyStep[], roots: string[]): ApprovalPolicy => {
  return { name: "test", steps, roots };
};

const approvedTerminal = (id = "approved"): PolicyStep => {
  return {
    id,
    kind: "terminal",
    label: "Approved",
    when: { kind: "always" },
    outcome: "approved",
    next: [],
  };
};

type GateExtra = Partial<Pick<ApprovalStep, "label" | "when" | "approvers" | "mode" | "quorum">>;

const gate = (id: string, next: string[], extra: GateExtra = {}): PolicyStep => {
  return {
    id,
    kind: "approval",
    label: extra.label ?? id,
    when: extra.when ?? { kind: "always" },
    approvers: extra.approvers ?? [{ name: `Person ${id}`, title: "Manager" }],
    mode: extra.mode ?? "all",
    quorum: extra.quorum,
    next,
  };
};

const codes = (p: ApprovalPolicy): string[] => {
  return validatePolicy(p).map((i) => i.code);
};

describe("validatePolicy", () => {
  it("flags only the unassigned director seat on the example policy", () => {
    const issues = validatePolicy(examplePolicy);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: "unresolved-approver",
      severity: "warning",
      stepIds: ["director-review"],
    });
    expect(isActivatable(issues)).toBe(true);
  });

  it("errors on a dangling edge", () => {
    const p = policy([gate("a", ["ghost"]), approvedTerminal()], ["a"]);
    expect(codes(p)).toContain("dangling-edge");
    expect(isActivatable(validatePolicy(p))).toBe(false);
  });

  it("errors on a cycle", () => {
    const p = policy([gate("a", ["b"]), gate("b", ["a"]), approvedTerminal()], ["a"]);
    expect(codes(p)).toContain("cycle");
  });

  it("errors on an unreachable step", () => {
    const p = policy(
      [gate("a", ["approved"]), gate("island", ["approved"]), approvedTerminal()],
      ["a"]
    );
    expect(codes(p)).toContain("unreachable-step");
  });

  it("errors when there is no terminal", () => {
    const p = policy([gate("a", [])], ["a"]);
    expect(codes(p)).toContain("no-terminal");
  });

  it("errors on an impossible quorum", () => {
    const p = policy(
      [
        gate("a", ["approved"], {
          mode: "quorum",
          quorum: 5,
          approvers: [
            { name: "A", title: "T" },
            { name: "B", title: "T" },
          ],
        }),
        approvedTerminal(),
      ],
      ["a"]
    );
    expect(codes(p)).toContain("quorum-invalid");
  });

  it("warns when a high-value path has a single gate", () => {
    const p = policy(
      [
        gate("big", ["approved"], {
          when: { kind: "leaf", field: "amount", op: ">", value: 30_000 },
        }),
        approvedTerminal(),
      ],
      ["big"]
    );
    expect(codes(p)).toContain("single-approver-high-value");
  });

  it("warns on segregation of duties", () => {
    const same = [{ name: "Jordan Lee", title: "Manager" }];
    const p = policy(
      [
        gate("a", ["b"], { approvers: same, label: "First" }),
        gate("b", ["approved"], {
          approvers: same,
          label: "Second",
          when: { kind: "leaf", field: "amount", op: ">", value: 1 },
        }),
        approvedTerminal(),
      ],
      ["a"]
    );
    expect(codes(p)).toContain("segregation-of-duties");
  });

  it("warns when a request can pass with no human approval", () => {
    const p = policy([approvedTerminal()], ["approved"]);
    const issues = validatePolicy(p);
    expect(issues.map((i) => i.code)).toContain("no-approval-before-terminal");
    expect(isActivatable(issues)).toBe(true);
  });

  it("warns on duplicate gates", () => {
    const roster = [{ name: "Ana Cruz", title: "Controller" }];
    const p = policy(
      [
        gate("a", ["b"], { approvers: roster, label: "Gate one" }),
        gate("b", ["approved"], { approvers: roster, label: "Gate two" }),
        approvedTerminal(),
      ],
      ["a"]
    );
    expect(codes(p)).toContain("duplicate-gate");
  });
});
