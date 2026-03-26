/**
 * Shared types for the Canvas Flow Execution Engine
 */

export interface FlowContext {
  contactId: string;
  tenantId: string;
  flowId: string;
  executionId: string;
  /** Variables accumulated across node executions */
  vars: {
    contact?: Record<string, string>;
    ext?: Record<string, unknown>;   // from API Fetch nodes
    gen?: Record<string, string>;    // from AI Gen nodes
    [key: string]: unknown;
  };
}

export type NodeType =
  | 'TRIGGER'
  | 'MESSAGE'
  | 'WAIT'
  | 'CONDITION'
  | 'API_FETCH'
  | 'AI_GEN'
  | 'ACTION';

export interface FlowNode {
  id: string;
  flowId: string;
  nodeType: NodeType;
  label: string;
  config: Record<string, unknown>;
  nextNodeId?: string | null;
  falseNodeId?: string | null;
  sortOrder: number;
}

export interface FlowDefinition {
  id: string;
  tenantId: string;
  name: string;
  maxStepLimit: number;
  nodes: FlowNode[];
}
