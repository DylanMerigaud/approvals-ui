"use client";

import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { CircleCheck, CircleX } from "lucide-react";

import type { StepChange } from "@/lib/approvals-ui/diff";
import type { TerminalStep } from "@/lib/approvals-ui/policy";
import type { IssueSeverity } from "@/lib/approvals-ui/validate";

import { stateRing, type StepStatus } from "@/components/approvals-ui/approval-node";
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

export const TerminalNode = ({ data }: NodeProps<TerminalFlowNode>) => {
  const { step } = data;
  const isVertical = data.vertical !== false;
  const isApproved = step.outcome === "approved";

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
        position={isVertical ? Position.Top : Position.Left}
        className="!bg-border !size-2 !border-none"
      />
      {isApproved ? (
        <CircleCheck className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <CircleX className="size-4 shrink-0 text-red-600 dark:text-red-400" />
      )}
      <span className="text-sm leading-none font-medium">{step.label}</span>
    </div>
  );
};
