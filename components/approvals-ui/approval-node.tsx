"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { CircleCheck, CircleX, Clock, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { humanizeCondition, summarizeMode, type ApprovalStep } from "@/lib/approvals-ui/policy";
import type { StepChange } from "@/lib/approvals-ui/diff";
import type { IssueSeverity } from "@/lib/approvals-ui/validate";
import { cn } from "@/lib/utils";

/** Live run overlay: where a given request currently sits. */
export type StepStatus = "pending" | "approved" | "rejected" | "skipped";

export type ApprovalNodeData = {
  step: ApprovalStep;
  /** Diff overlay from a pending proposal. */
  change?: StepChange["kind"];
  /** Worst validation severity touching this step. */
  issue?: IssueSeverity;
  status?: StepStatus;
  selected?: boolean;
  vertical?: boolean;
  hasIncoming?: boolean;
  hasOutgoing?: boolean;
  [key: string]: unknown;
};

export type ApprovalFlowNode = Node<ApprovalNodeData, "approval">;

export function stateRing(data: {
  change?: StepChange["kind"];
  issue?: IssueSeverity;
  selected?: boolean;
}): string {
  if (data.change === "added") return "ring-2 ring-emerald-500/70 border-emerald-500/40";
  if (data.change === "changed") return "ring-2 ring-amber-500/70 border-amber-500/40";
  if (data.change === "removed") return "opacity-50 border-dashed ring-2 ring-red-500/50";
  if (data.issue === "error") return "ring-2 ring-destructive/70";
  if (data.issue === "warning") return "ring-2 ring-amber-500/50";
  if (data.selected) return "ring-2 ring-ring";
  return "";
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function StatusBadge({ status }: { status: StepStatus }) {
  if (status === "approved") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
        <CircleCheck className="size-3.5" /> Approved
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-600 dark:text-red-400">
        <CircleX className="size-3.5" /> Rejected
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="text-foreground inline-flex items-center gap-1 text-[11px] font-medium">
        <span className="relative flex size-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-amber-500" />
        </span>
        Awaiting decision
      </span>
    );
  }
  return <span className="text-muted-foreground text-[11px]">Skipped</span>;
}

export function ApprovalNode({ data }: NodeProps<ApprovalFlowNode>) {
  const { step } = data;
  const vertical = data.vertical !== false;
  const condition = humanizeCondition(step.when);

  return (
    <div
      className={cn(
        "bg-card text-card-foreground w-64 rounded-xl border shadow-sm",
        data.status === "skipped" && "opacity-45",
        stateRing(data)
      )}
    >
      {data.hasIncoming !== false && (
        <Handle
          type="target"
          position={vertical ? Position.Top : Position.Left}
          className="!bg-border !size-2 !border-none"
        />
      )}

      <div className="space-y-1 px-3.5 pt-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm leading-tight font-medium">{step.label}</p>
          {data.status && <StatusBadge status={data.status} />}
        </div>
        {condition !== "always" && (
          <Badge
            variant="outline"
            className="text-muted-foreground max-w-full font-mono text-[10px] font-normal"
          >
            <span className="truncate">{condition}</span>
          </Badge>
        )}
      </div>

      <div className="space-y-1.5 px-3.5 py-3">
        {step.approvers.map((approver, index) => (
          <div key={`${approver.name ?? "open"}-${index}`} className="flex items-center gap-2">
            {approver.name === null ? (
              <span className="border-muted-foreground/50 text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed">
                <UserRound className="size-3" />
              </span>
            ) : (
              <span className="bg-muted flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium">
                {initials(approver.name)}
              </span>
            )}
            <div className="min-w-0 leading-tight">
              <p
                className={cn(
                  "truncate text-xs",
                  approver.name === null && "text-muted-foreground italic"
                )}
              >
                {approver.name ?? "Unassigned"}
              </p>
              <p className="text-muted-foreground truncate text-[10px]">{approver.title}</p>
            </div>
          </div>
        ))}
      </div>

      {(step.approvers.length > 1 || step.sla) && (
        <div className="flex flex-wrap items-center gap-1.5 border-t px-3.5 py-2">
          {step.approvers.length > 1 && (
            <Badge variant="secondary" className="text-[10px] font-normal">
              {summarizeMode(step)}
            </Badge>
          )}
          {step.sla && (
            <Badge variant="secondary" className="gap-1 text-[10px] font-normal">
              <Clock className="size-3" />
              {step.sla.hours}h{step.sla.escalateTo ? ` then ${step.sla.escalateTo.title}` : ""}
            </Badge>
          )}
        </div>
      )}

      {data.hasOutgoing !== false && (
        <Handle
          type="source"
          position={vertical ? Position.Bottom : Position.Right}
          className="!bg-border !size-2 !border-none"
        />
      )}
    </div>
  );
}
