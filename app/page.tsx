"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowRight, Check, Copy, Moon, RotateCcw, Sparkles, Sun } from "lucide-react";

import { NlEditPanel } from "@/components/approvals-ui/nl-edit-panel";
import { ValidationPanel } from "@/components/approvals-ui/validation-panel";
import { WorkflowCanvas } from "@/components/approvals-ui/workflow-canvas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { demoInstructions, demoProposer } from "@/lib/approvals-ui/demo-proposer";
import { hasChanges } from "@/lib/approvals-ui/diff";
import type { EditProposal } from "@/lib/approvals-ui/edit-ops";
import { examplePolicy } from "@/lib/approvals-ui/example-policy";
import { isActivatable, validatePolicy } from "@/lib/approvals-ui/validate";

const REGISTRY_URL = "https://approvals-ui.vercel.app";
const GITHUB_URL = "https://github.com/DylanMerigaud/approvals-ui";

const AGENT_PROMPT = `Add the approvals-ui approval-workflow screen to this project.

1. It is a shadcn registry, not an npm package. If the project has no components.json yet,
   run: npx shadcn@latest init
   Then: npx shadcn@latest add ${REGISTRY_URL}/r/workflow-canvas.json
   Also add ${REGISTRY_URL}/r/nl-edit-panel.json and
   ${REGISTRY_URL}/r/validation-panel.json if we want the editing and lint panels.

2. Components land in components/approvals-ui/, the headless core in lib/approvals-ui/.
   Render the canvas inside a container with a real height:

   import { WorkflowCanvas } from "@/components/approvals-ui/workflow-canvas"
   import { examplePolicy } from "@/lib/approvals-ui/example-policy"

   <div className="h-[600px]">
     <WorkflowCanvas policy={examplePolicy} />
   </div>

3. Replace examplePolicy with our own ApprovalPolicy (schema: lib/approvals-ui/policy.ts).
   Steps are approval gates or terminals; each has a "when" guard, approvers, and "next"
   edges. Validate with validatePolicy() from lib/approvals-ui/validate.ts and surface the
   issues (ValidationPanel renders them; isActivatable() should gate activation).

4. direction="TB" for top to bottom; the default lays out left to right.

5. For plain-language editing, wire NlEditPanel with the bundled demoProposer first. To use
   a real model, implement a Proposer that emits one EditOp (validate with editOpSchema) and
   apply it with proposeEdits. Keep the Apply/Discard review step: nothing lands without it.`;

const ITEMS = [
  {
    name: "workflow-canvas",
    summary:
      "The whole screen in one component: policy JSON in, laid-out graph out. Pulls the nodes and the core with it.",
  },
  {
    name: "nl-edit-panel",
    summary:
      "Plain-language edits behind a human gate: propose, review the diff on the canvas, apply or discard.",
  },
  {
    name: "validation-panel",
    summary:
      "The policy lint, rendered: structural errors and best-practice warnings, click to focus the step.",
  },
  {
    name: "approval-node",
    summary:
      "The gate card: approvers, unassigned seats, quorum badge, condition pill, SLA, diff and issue rings.",
  },
  {
    name: "terminal-node",
    summary: "Approved and rejected outcome pills.",
  },
  {
    name: "approvals-core",
    summary:
      "Headless core only: Zod policy schema, validation rules, step diff, deterministic edit ops.",
  },
] as const;

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      aria-label="Copy to clipboard"
    >
      {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
    </Button>
  );
}

function InstallCommand({ item, className }: { item: string; className?: string }) {
  const command = `npx shadcn@latest add ${REGISTRY_URL}/r/${item}.json`;
  return (
    <div
      className={`bg-muted/40 flex items-center gap-1 rounded-lg border pr-1 pl-3 ${className ?? ""}`}
    >
      <code className="text-muted-foreground min-w-0 flex-1 truncate py-2 font-mono text-[11px]">
        {command}
      </code>
      <CopyButton text={command} className="size-7 shrink-0" />
    </div>
  );
}

function AgentPromptButton() {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className="shrink-0"
      onClick={async () => {
        await navigator.clipboard.writeText(AGENT_PROMPT);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
    >
      {copied ? <Check className="size-3.5 text-emerald-500" /> : <Sparkles className="size-3.5" />}
      {copied ? "Copied" : "Copy agent prompt"}
    </Button>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  if (dark === null) return <Button variant="ghost" size="icon" aria-hidden className="size-8" />;
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      aria-label="Toggle theme"
      onClick={() => {
        const next = !dark;
        document.documentElement.classList.toggle("dark", next);
        try {
          localStorage.setItem("theme", next ? "dark" : "light");
        } catch {}
        setDark(next);
      }}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}

export default function Home() {
  const [policy, setPolicy] = useState(examplePolicy);
  const [proposal, setProposal] = useState<EditProposal | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ stepId: string } | null>(null);
  const [tab, setTab] = useState("edit");
  const [direction, setDirection] = useState<"LR" | "TB">("LR");

  const previewing = proposal !== null && hasChanges(proposal.changes);
  const displayed = previewing ? proposal.proposed : policy;
  const issues = useMemo(() => validatePolicy(displayed), [displayed]);
  const blockApply = previewing && !isActivatable(issues);

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 sm:px-6">
      <header className="flex items-center justify-between py-5">
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-sm font-semibold">approvals-ui</span>
          <Badge variant="secondary" className="hidden text-[10px] sm:inline-flex">
            shadcn registry for React Flow
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<a href={GITHUB_URL} target="_blank" rel="noreferrer" />}
          >
            <GithubIcon className="size-4" />
            GitHub
          </Button>
        </div>
      </header>

      <section className="py-10 sm:py-14">
        <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          The approval workflow screen, as components you own.
        </h1>
        <p className="text-muted-foreground mt-4 max-w-2xl text-sm leading-relaxed text-pretty sm:text-base">
          React Flow gives you the canvas. This registry adds the approval semantics: quorum gates,
          amount thresholds, unassigned seats, a policy lint that knows what segregation of duties
          means, and plain-language editing where a human reviews the diff before anything lands.
          Install with one command, the code lands in your project, it is yours.
        </p>
        <div className="mt-6 flex max-w-2xl flex-col gap-2 sm:flex-row sm:items-center">
          <InstallCommand item="workflow-canvas" className="min-w-0 flex-1" />
          <AgentPromptButton />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="overflow-hidden py-0">
          <CardHeader className="flex-row items-center justify-between border-b !py-3">
            <div className="space-y-0.5">
              <CardTitle className="text-sm">{displayed.name}</CardTitle>
              <CardDescription className="text-xs">
                {previewing
                  ? "Previewing a proposal. Nothing is applied yet."
                  : "Live demo. Try an edit on the right."}
              </CardDescription>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant={direction === "LR" ? "secondary" : "ghost"}
                size="icon-sm"
                aria-label="Left to right"
                onClick={() => setDirection("LR")}
              >
                <ArrowRight className="size-3.5" />
              </Button>
              <Button
                variant={direction === "TB" ? "secondary" : "ghost"}
                size="icon-sm"
                aria-label="Top to bottom"
                onClick={() => setDirection("TB")}
              >
                <ArrowDown className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPolicy(examplePolicy);
                  setProposal(null);
                  setSelectedId(null);
                }}
              >
                <RotateCcw className="size-3.5" />
                Reset
              </Button>
            </div>
          </CardHeader>
          <CardContent className="h-[540px] p-0 sm:h-[600px]">
            <WorkflowCanvas
              policy={displayed}
              changes={proposal?.changes}
              issues={issues}
              direction={direction}
              rankSep={direction === "TB" ? 56 : undefined}
              selectedId={selectedId}
              onSelectStep={setSelectedId}
              focus={focus}
            />
          </CardContent>
        </Card>

        <Card className="h-fit py-0">
          <Tabs value={tab} onValueChange={setTab} className="gap-0">
            <CardHeader className="border-b !py-3">
              <TabsList className="w-full">
                <TabsTrigger value="edit">Edit in English</TabsTrigger>
                <TabsTrigger value="validation">
                  Validation
                  {issues.length > 0 && (
                    <Badge variant="secondary" className="ml-1 px-1.5 text-[10px]">
                      {issues.length}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="json">JSON</TabsTrigger>
              </TabsList>
            </CardHeader>
            <CardContent className="p-4">
              <TabsContent value="edit" className="mt-0 space-y-3">
                <NlEditPanel
                  policy={policy}
                  proposer={demoProposer}
                  proposal={proposal}
                  onProposalChange={setProposal}
                  onApply={setPolicy}
                  blockApply={blockApply}
                  blockApplyReason="The proposed policy has validation errors."
                  suggestions={[...demoInstructions]}
                />
                <p className="text-muted-foreground text-[11px] leading-relaxed">
                  This demo uses the bundled deterministic parser, no model and no API key. In
                  production you swap it for an LLM that emits EditOp JSON (validated by
                  editOpSchema). The review-then-apply gate stays exactly the same.
                </p>
              </TabsContent>
              <TabsContent value="validation" className="mt-0">
                <ValidationPanel
                  issues={issues}
                  onFocusStep={(stepId) => {
                    setSelectedId(stepId);
                    setFocus({ stepId });
                  }}
                />
              </TabsContent>
              <TabsContent value="json" className="mt-0">
                <div className="relative">
                  <CopyButton
                    text={JSON.stringify(displayed, null, 2)}
                    className="absolute top-1 right-1 z-10 size-7"
                  />
                  <ScrollArea className="bg-muted/30 h-[480px] rounded-lg border">
                    <pre className="p-3 font-mono text-[11px] leading-relaxed">
                      {JSON.stringify(displayed, null, 2)}
                    </pre>
                  </ScrollArea>
                </div>
              </TabsContent>
            </CardContent>
          </Tabs>
        </Card>
      </section>

      <section className="py-14">
        <h2 className="text-xl font-semibold tracking-tight">Install</h2>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm">
          Each item is copied into your codebase by the shadcn CLI, with its npm dependencies and
          its registry dependencies resolved. Start with workflow-canvas, it pulls everything it
          needs.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {ITEMS.map((item) => (
            <Card key={item.name} className="gap-3 py-4">
              <CardHeader className="!py-0">
                <CardTitle className="font-mono text-sm">{item.name}</CardTitle>
                <CardDescription className="text-xs leading-relaxed">
                  {item.summary}
                </CardDescription>
              </CardHeader>
              <CardContent className="!pt-0">
                <InstallCommand item={item.name} />
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <footer className="border-t py-8">
        <p className="text-muted-foreground text-xs leading-relaxed">
          Built by{" "}
          <a
            href="https://www.linkedin.com/in/dylanmerigaud"
            target="_blank"
            rel="noreferrer"
            className="text-foreground font-medium underline-offset-4 hover:underline"
          >
            Dylan Mérigaud
          </a>
          , freelance AI full-stack engineer (ex-Pivot, procurement fintech). Extracted from{" "}
          <a
            href="https://ledgerloop-eta.vercel.app"
            target="_blank"
            rel="noreferrer"
            className="text-foreground font-medium underline-offset-4 hover:underline"
          >
            ledgerloop
          </a>
          , where an agent derives this exact screen from a client&apos;s HRIS. Uses{" "}
          <a
            href="https://www.npmjs.com/package/react-flow-auto-layout"
            target="_blank"
            rel="noreferrer"
            className="text-foreground font-medium underline-offset-4 hover:underline"
          >
            react-flow-auto-layout
          </a>{" "}
          for the layout. MIT.
        </p>
      </footer>
    </div>
  );
}
