export const RESOLUTION_METAMODEL_VERSION = 'resolution/1' as const;
export const RESOLUTION_ARTIFACT_VERSION = 'resolution-artifact/1' as const;

export type ResolutionPrimitive = string | number | boolean;
export type ResolutionExpression =
  | { op: 'literal'; value: ResolutionPrimitive }
  | { op: 'actor-field'; key: string }
  | { op: 'target-field'; key: string }
  | { op: 'input'; key: string }
  | { op: 'result'; key: string; property: string }
  | { op: 'add' | 'subtract' | 'multiply' | 'divide'; left: ResolutionExpression; right: ResolutionExpression };

export type ResolutionCondition =
  | { op: 'equals' | 'gte' | 'lte'; left: ResolutionExpression; right: ResolutionExpression }
  | { op: 'all'; conditions: ResolutionCondition[] }
  | { op: 'any'; conditions: ResolutionCondition[] }
  | { op: 'not'; condition: ResolutionCondition };

interface ResolutionDefinitionBase {
  formatVersion: '1';
  metamodelVersion: typeof RESOLUTION_METAMODEL_VERSION;
  definitionId: string;
  name: string;
  description?: string;
}

export interface ModifierDefinition extends ResolutionDefinitionBase {
  definitionType: 'modifier';
  targetCheckId: string;
  operation: 'add' | 'multiply';
  value: ResolutionExpression;
  when?: ResolutionCondition;
}

export interface CheckDefinition extends ResolutionDefinitionBase {
  definitionType: 'check';
  checkKind: 'target-number';
  roll: { count: number; sides: number };
  bonus: ResolutionExpression;
  target: ResolutionExpression;
  comparison: 'gte';
}

export interface ResourceDefinition extends ResolutionDefinitionBase {
  definitionType: 'resource';
  capacity: number;
  minimum: number;
  refresh: 'manual' | 'encounter' | 'turn';
}

export interface EffectDefinition extends ResolutionDefinitionBase {
  definitionType: 'effect';
  duration: { kind: 'instant' | 'turns' | 'persistent'; turns?: number };
  modifierIds?: string[];
}

export interface EventDefinition extends ResolutionDefinitionBase {
  definitionType: 'event';
  visibility: 'public' | 'gm';
  payload: Record<string, 'string' | 'number' | 'boolean'>;
}

export type OperationStep =
  | { stepId: string; kind: 'validate'; condition: ResolutionCondition; failureMessage: string; next: string }
  | { stepId: string; kind: 'consume-resource'; resourceId: string; amount: ResolutionExpression; next: string }
  | { stepId: string; kind: 'perform-check'; checkId: string; resultKey: string; onSuccess: string; onFailure: string }
  | { stepId: string; kind: 'apply-effect'; effectId: string; target: 'actor' | 'target'; next: string }
  | { stepId: string; kind: 'emit-event'; eventId: string; payload: Record<string, ResolutionExpression>; next: string }
  | { stepId: string; kind: 'return'; outcome: 'success' | 'failure'; data?: Record<string, ResolutionExpression> };

export interface OperationDefinition extends ResolutionDefinitionBase {
  definitionType: 'operation';
  startStepId: string;
  steps: OperationStep[];
  budget: { maximumSteps: number };
}

export type ResolutionDefinition =
  | ModifierDefinition
  | CheckDefinition
  | ResourceDefinition
  | EffectDefinition
  | EventDefinition
  | OperationDefinition;

export interface ResolutionDiagnostic {
  code: string;
  message: string;
  path: string;
  severity: 'error' | 'warning';
}

export interface CompiledResolutionArtifact {
  artifactVersion: typeof RESOLUTION_ARTIFACT_VERSION;
  metamodelVersion: typeof RESOLUTION_METAMODEL_VERSION;
  sourceHash: string;
  definitions: ResolutionDefinition[];
}

export interface ResolutionCompilationResult {
  valid: boolean;
  diagnostics: ResolutionDiagnostic[];
  artifact?: CompiledResolutionArtifact;
}

export interface ResolutionContext {
  actor: { id: string; fields: Record<string, ResolutionPrimitive>; resources: Record<string, number> };
  target: { id: string; fields: Record<string, ResolutionPrimitive> };
  input?: Record<string, ResolutionPrimitive>;
  activeModifierIds?: string[];
  entropy: number[];
}

export interface ResolutionTraceEntry {
  stepId: string;
  kind: string;
  message: string;
  values?: Record<string, ResolutionPrimitive>;
}

export interface ResolutionPreview {
  outcome: 'success' | 'failure';
  data: Record<string, ResolutionPrimitive>;
  resourceChanges: Array<{ resourceId: string; before: number; after: number }>;
  effects: Array<{ effectId: string; targetId: string }>;
  events: Array<{ eventId: string; visibility: string; payload: Record<string, ResolutionPrimitive> }>;
  entropyConsumed: number[];
  trace: ResolutionTraceEntry[];
}

export interface ResolutionFixture {
  name: string;
  operationId: string;
  context: ResolutionContext;
  expected: Partial<Pick<ResolutionPreview, 'outcome' | 'effects' | 'events'>>;
}
