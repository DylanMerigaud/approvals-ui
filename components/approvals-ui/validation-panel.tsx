"use client"

import { CircleCheck, OctagonX, TriangleAlert } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import type { PolicyIssue } from "@/lib/approvals-ui/validate"
import { cn } from "@/lib/utils"

export type ValidationPanelProps = {
  issues: PolicyIssue[]
  /** Called with a step id when an issue is clicked: wire it to the canvas focus. */
  onFocusStep?: (stepId: string) => void
  className?: string
}

export function ValidationPanel({ issues, onFocusStep, className }: ValidationPanelProps) {
  const errors = issues.filter((i) => i.severity === "error").length
  const warnings = issues.length - errors

  if (issues.length === 0) {
    return (
      <div className={cn("flex items-center gap-2 rounded-lg border p-3", className)}>
        <CircleCheck className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <p className="text-xs text-muted-foreground">
          No issues. The policy is safe to activate.
        </p>
      </div>
    )
  }

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
          const clickable = onFocusStep && issue.stepIds.length > 0
          return (
            <li key={`${issue.code}-${index}`}>
              <button
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onFocusStep(issue.stepIds[0])}
                className={cn(
                  "flex w-full items-start gap-2 rounded-md p-2 text-left",
                  clickable && "cursor-pointer transition-colors hover:bg-muted/60",
                )}
              >
                {issue.severity === "error" ? (
                  <OctagonX className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                ) : (
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                )}
                <span className="min-w-0 space-y-0.5">
                  <span className="block text-xs leading-snug">{issue.message}</span>
                  <span className="block font-mono text-[10px] text-muted-foreground">
                    {issue.code}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
