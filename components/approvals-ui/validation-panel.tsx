"use client";

import { CircleCheck, OctagonX, TriangleAlert } from "lucide-react";

import type { PolicyIssue } from "@/lib/approvals-ui/validate";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ValidationPanelProps = {
  issues: PolicyIssue[];
  /** Called with a step id when an issue is clicked: wire it to the canvas focus. */
  onFocusStep?: (stepId: string) => void;
  className?: string;
};

export const ValidationPanel = ({ issues, onFocusStep, className }: ValidationPanelProps) => {
  if (issues.length === 0) {
    return (
      <div className={cn("flex items-center gap-2 rounded-lg border p-3", className)}>
        <CircleCheck className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <p className="text-muted-foreground text-xs">No issues. The policy is safe to activate.</p>
      </div>
    );
  }

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-1.5">
        {errors > 0 && (
          <Badge variant="destructive" className="text-[10px]">
            {errors} error{errors === 1 ? "" : "s"}
          </Badge>
        )}
        {warnings > 0 && (
          <Badge
            variant="secondary"
            className="border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400"
          >
            {warnings} warning{warnings === 1 ? "" : "s"}
          </Badge>
        )}
      </div>
      <ul className="space-y-1">
        {issues.map((issue, index) => {
          const firstStepId = issue.stepIds[0];
          const clickable = onFocusStep && firstStepId !== undefined;
          return (
            <li key={`${issue.code}-${index}`}>
              <button
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onFocusStep(firstStepId)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-md p-2 text-left",
                  clickable && "hover:bg-muted/60 cursor-pointer transition-colors"
                )}
              >
                {issue.severity === "error" ? (
                  <OctagonX className="text-destructive mt-0.5 size-3.5 shrink-0" />
                ) : (
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                )}
                <span className="min-w-0 space-y-0.5">
                  <span className="block text-xs leading-snug">{issue.message}</span>
                  <span className="text-muted-foreground block font-mono text-[10px]">
                    {issue.code}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
