"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { CircleCheck, CircleX } from "lucide-react";

import { stateRing, type StepStatus } from "@/components/approvals-ui/approval-node";
import type { StepChange } from "@/lib/approvals-ui/diff";
import type { IssueSeverity } from "@/lib/approvals-ui/validate";
import type { TerminalStep } from "@/lib/approvals-ui/policy";
import { cn } from "@/lib/utils";

export type TerminalNodeData = {
  step: TerminalStep;
  change?: StepChange["kind"];
  issue?: IssueSeverity;
  status?: StepStatus;
  selected?: boolean;
  vertical?: boolean;
  [key: string]: unknown;
};

export type TerminalFlowNode = Node<TerminalNodeData, "terminal">;

export function TerminalNode({ data }: NodeProps<TerminalFlowNode>) {
  const { step } = data;
  const vertical = data.vertical !== false;
  const approved = step.outcome === "approved";

  return (
    <div
      className={cn(
        "bg-card text-card-foreground flex items-center gap-2 rounded-full border px-4 py-2 shadow-sm",
        data.status === "skipped" && "opacity-45",
        stateRing(data)
      )}
    >
      <Handle
        type="target"
        position={vertical ? Position.Top : Position.Left}
        className="!bg-border !size-2 !border-none"
      />
      {approved ? (
        <CircleCheck className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <CircleX className="size-4 shrink-0 text-red-600 dark:text-red-400" />
      )}
      <span className="text-sm leading-none font-medium">{step.label}</span>
    </div>
  );
}
