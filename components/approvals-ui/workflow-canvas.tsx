"use client"

import "@xyflow/react/dist/style.css"

import { useEffect, useMemo } from "react"
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeTypes,
  type EdgeTypes,
} from "@xyflow/react"
import {
  AlignedStepEdge,
  useAutoLayout,
  withAlignedElbows,
} from "react-flow-auto-layout/react"

import {
  ApprovalNode,
  type ApprovalFlowNode,
  type StepStatus,
} from "@/components/approvals-ui/approval-node"
import {
  TerminalNode,
  type TerminalFlowNode,
} from "@/components/approvals-ui/terminal-node"
import type { StepChange } from "@/lib/approvals-ui/diff"
import type { ApprovalPolicy } from "@/lib/approvals-ui/policy"
import type { PolicyIssue } from "@/lib/approvals-ui/validate"
import { cn } from "@/lib/utils"

export type CanvasNode = ApprovalFlowNode | TerminalFlowNode

const NODE_TYPES = {
  approval: ApprovalNode,
  terminal: TerminalNode,
} as NodeTypes

const EDGE_TYPES = {
  alignedStep: AlignedStepEdge,
} as EdgeTypes

export type WorkflowCanvasProps = {
  policy: ApprovalPolicy
  /** Diff overlay from a pending proposal: rings added/changed steps. */
  changes?: StepChange[]
  /** Validation overlay: rings steps carrying an error or warning. */
  issues?: PolicyIssue[]
  /** Live run overlay: per-step status for one request. */
  statuses?: Record<string, StepStatus>
  /** "LR" (default) lays out left to right, "TB" top to bottom. */
  direction?: "TB" | "LR"
  /** Gap between sibling branches. Defaults to the layout library's 40. */
  nodeSep?: number
  /** Gap between ranks. Defaults to the layout library's 110. */
  rankSep?: number
  selectedId?: string | null
  onSelectStep?: (stepId: string | null) => void
  /** Pass a fresh object to pan the viewport to a step. */
  focus?: { stepId: string } | null
  className?: string
  children?: React.ReactNode
}

function buildNodes(
  policy: ApprovalPolicy,
  props: Pick<WorkflowCanvasProps, "changes" | "issues" | "statuses" | "selectedId">,
  vertical: boolean,
): CanvasNode[] {
  const changeById = new Map<string, StepChange["kind"]>()
  for (const change of props.changes ?? []) {
    if (change.kind !== "unchanged") changeById.set(change.id, change.kind)
  }

  const issueById = new Map<string, "error" | "warning">()
  for (const issue of props.issues ?? []) {
    for (const stepId of issue.stepIds) {
      if (issue.severity === "error" || !issueById.has(stepId)) {
        issueById.set(stepId, issue.severity)
      }
    }
  }

  const hasIncoming = new Set<string>()
  for (const step of policy.steps) {
    for (const nextId of step.next) hasIncoming.add(nextId)
  }

  return policy.steps.map((step) => {
    const shared = {
      change: changeById.get(step.id),
      issue: issueById.get(step.id),
      status: props.statuses?.[step.id],
      selected: props.selectedId === step.id,
      vertical,
    }
    if (step.kind === "terminal") {
      return {
        id: step.id,
        type: "terminal",
        position: { x: 0, y: 0 },
        data: { step, ...shared },
      } satisfies TerminalFlowNode
    }
    return {
      id: step.id,
      type: "approval",
      position: { x: 0, y: 0 },
      data: {
        step,
        ...shared,
        hasIncoming: hasIncoming.has(step.id),
        hasOutgoing: step.next.length > 0,
      },
    } satisfies ApprovalFlowNode
  })
}

function buildEdges(policy: ApprovalPolicy): Edge[] {
  const ids = new Set(policy.steps.map((s) => s.id))
  const edges: Edge[] = []
  for (const step of policy.steps) {
    for (const nextId of step.next) {
      if (!ids.has(nextId)) continue
      edges.push({
        id: `${step.id}->${nextId}`,
        source: step.id,
        target: nextId,
        style: { stroke: "var(--border)", strokeWidth: 1.5 },
      })
    }
  }
  return withAlignedElbows(edges).map((edge) => ({ ...edge, type: "alignedStep" }))
}

function CanvasInner({
  policy,
  changes,
  issues,
  statuses,
  direction = "LR",
  nodeSep,
  rankSep,
  selectedId,
  onSelectStep,
  focus,
  children,
}: WorkflowCanvasProps) {
  const vertical = direction !== "LR"
  const reactFlow = useReactFlow()

  const sourceNodes = useMemo<Node[]>(
    () => buildNodes(policy, { changes, issues, statuses, selectedId }, vertical),
    [policy, changes, issues, statuses, selectedId, vertical],
  )
  const sourceEdges = useMemo(() => buildEdges(policy), [policy])

  const { nodes, edges, onNodesChange, onEdgesChange } = useAutoLayout({
    nodes: sourceNodes,
    edges: sourceEdges,
    vertical,
    nodeSep,
    rankSep,
  })

  const structureKey = useMemo(
    () => `${direction}:${policy.steps.map((s) => `${s.id}>${s.next.join("|")}`).join(",")}`,
    [policy, direction],
  )

  useEffect(() => {
    const frame = setTimeout(() => {
      reactFlow.fitView({ duration: 300, padding: 0.2, maxZoom: 1 })
    }, 180)
    return () => clearTimeout(frame)
  }, [structureKey, reactFlow])

  useEffect(() => {
    if (!focus) return
    const node = reactFlow.getNode(focus.stepId)
    if (!node) return
    reactFlow.fitView({ nodes: [node], duration: 400, padding: 0.4, maxZoom: 1.1 })
  }, [focus, reactFlow])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      fitView
      fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
      minZoom={0.3}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      onNodeClick={(_, node) => onSelectStep?.(node.id)}
      onPaneClick={() => onSelectStep?.(null)}
      className="bg-background"
    >
      <Background gap={18} />
      <Controls showInteractive={false} />
      {children}
    </ReactFlow>
  )
}

/**
 * Renders an ApprovalPolicy as a laid-out React Flow graph. Layout is
 * automatic (react-flow-auto-layout measures the real node sizes), so the
 * policy JSON is the only input: no positions to manage.
 *
 * The parent element must have a height.
 */
const FLOW_THEME = {
  "--xy-controls-button-background-color": "var(--card)",
  "--xy-controls-button-background-color-hover": "var(--muted)",
  "--xy-controls-button-color": "var(--foreground)",
  "--xy-controls-button-color-hover": "var(--foreground)",
  "--xy-controls-button-border-color": "var(--border)",
  "--xy-attribution-background-color": "transparent",
} as React.CSSProperties

export function WorkflowCanvas({ className, ...props }: WorkflowCanvasProps) {
  return (
    <div className={cn("h-full w-full", className)} style={FLOW_THEME}>
      <ReactFlowProvider>
        <CanvasInner {...props} />
      </ReactFlowProvider>
    </div>
  )
}
