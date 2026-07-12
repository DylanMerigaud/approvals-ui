"use client";

import { useState } from "react";
import {
  CircleMinus,
  CirclePlus,
  Loader2,
  MessageCircleQuestion,
  Pencil,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { hasChanges, summarizeChanges } from "@/lib/approvals-ui/diff";
import type { EditProposal, Proposer } from "@/lib/approvals-ui/edit-ops";
import type { ApprovalPolicy } from "@/lib/approvals-ui/policy";
import { cn } from "@/lib/utils";

/**
 * Edit the policy in plain language, behind a human gate: the proposer only
 * ever PROPOSES. The parent renders the returned diff on the canvas, and
 * nothing lands until Apply is clicked.
 *
 * Bring your own proposer: the bundled demoProposer is deterministic (no
 * model, no key). Swap it for an LLM that emits EditOp JSON and the UI does
 * not change.
 */
export type NlEditPanelProps = {
  policy: ApprovalPolicy;
  proposer: Proposer;
  proposal: EditProposal | null;
  onProposalChange: (proposal: EditProposal | null) => void;
  onApply: (policy: ApprovalPolicy) => void;
  /** Block Apply (for example when the proposed policy has validation errors). */
  blockApply?: boolean;
  blockApplyReason?: string;
  suggestions?: string[];
  placeholder?: string;
  className?: string;
};

export function NlEditPanel({
  policy,
  proposer,
  proposal,
  onProposalChange,
  onApply,
  blockApply = false,
  blockApplyReason,
  suggestions = [],
  placeholder = "Above $50k also require the CFO",
  className,
}: NlEditPanelProps) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function propose(text: string) {
    const trimmed = text.trim();
    if (trimmed.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    onProposalChange(null);
    try {
      onProposalChange(await proposer(trimmed, policy));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  function apply() {
    if (!proposal || blockApply) return;
    onApply(proposal.proposed);
    onProposalChange(null);
    setInstruction("");
  }

  function discard() {
    onProposalChange(null);
  }

  const mutating = proposal !== null && hasChanges(proposal.changes);

  return (
    <div className={cn("space-y-3", className)}>
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void propose(instruction);
        }}
      >
        <Input
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder={placeholder}
          disabled={busy}
          className="h-8 text-xs"
        />
        <Button type="submit" size="sm" disabled={busy || instruction.trim().length === 0}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          Propose
        </Button>
      </form>

      {suggestions.length > 0 && proposal === null && !busy && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => {
                setInstruction(suggestion);
                void propose(suggestion);
              }}
              className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-full border px-2.5 py-1 text-[11px] transition-colors"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-destructive text-xs">{error}</p>}

      {proposal?.clarify && (
        <div className="space-y-2 rounded-lg border p-3">
          <p className="flex items-start gap-2 text-xs">
            <MessageCircleQuestion className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
            {proposal.clarify.question}
          </p>
          {proposal.clarify.options && proposal.clarify.options.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pl-5">
              {proposal.clarify.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setInstruction(option)}
                  className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-full border px-2.5 py-0.5 text-[11px] transition-colors"
                >
                  {option}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {proposal && !proposal.clarify && (
        <div className="space-y-2.5 rounded-lg border p-3">
          <div className="space-y-1">
            <p className="text-xs font-medium">Proposal: {summarizeChanges(proposal.changes)}</p>
            {proposal.reason && <p className="text-muted-foreground text-xs">{proposal.reason}</p>}
          </div>

          {mutating && (
            <ul className="space-y-1">
              {proposal.changes
                .filter((change) => change.kind !== "unchanged")
                .map((change) => (
                  <li
                    key={`${change.kind}-${change.id}`}
                    className="flex items-center gap-2 text-xs"
                  >
                    {change.kind === "added" && (
                      <CirclePlus className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    )}
                    {change.kind === "changed" && (
                      <Pencil className="size-3.5 shrink-0 text-amber-500" />
                    )}
                    {change.kind === "removed" && (
                      <CircleMinus className="size-3.5 shrink-0 text-red-600 dark:text-red-400" />
                    )}
                    <span className="truncate">{change.label}</span>
                    {change.kind === "changed" && (
                      <span className="text-muted-foreground truncate font-mono text-[10px]">
                        {change.fields.join(", ")}
                      </span>
                    )}
                  </li>
                ))}
            </ul>
          )}

          <div className="flex items-center gap-2">
            {mutating && (
              <Button size="sm" onClick={apply} disabled={blockApply}>
                Apply
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={discard}>
              Discard
            </Button>
            {blockApply && blockApplyReason && (
              <p className="text-destructive text-[11px]">{blockApplyReason}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
