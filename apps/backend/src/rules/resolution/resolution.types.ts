export const RESOLUTION_METAMODEL_VERSION = 'resolution/1' as const;
export const RESOLUTION_ARTIFACT_VERSION = 'resolution-artifact/1' as const;

export type ResolutionPrimitive = string | number | boolean;
export type ResolutionExpression =
  | { op: 'literal'; value: ResolutionPrimitive }
  | { op: 'actor-field'; key: string }
  | { op: 'target-field'; key: string }
  | { op: 'trait-instance-field'; instanceId: string; key: string }
  | { op: 'trait-path-field'; path: string; mountSelector?: { mode: 'ordinal'; ordinal: number } }
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
  subjectTraitIds?: string[];
  subjectTraitSelections?: Record<string, string[]>;
}

export type RollKind = 'saving' | 'hit' | 'damage' | 'other';
export type DieResultOrigin = 'original' | 'added' | 'replacement';

export interface ResolutionDiePool {
  dieTraitId: string;
  count: number;
  sides: number;
  rollKind?: RollKind;
}

export type ResolutionRollSpec =
  | { count: number; sides: number; dieTraitId?: string; rollKind?: RollKind }
  | { dice: ResolutionDiePool[]; rollKind?: RollKind; rollTraitId?: string };

export interface ModifierAppliesTo {
  allRolls?: true;
  checkIds?: string[];
  rollKinds?: RollKind[];
  rollTraitIds?: string[];
}

export interface TotalModifierDefinition extends ResolutionDefinitionBase {
  definitionType: 'modifier';
  modifierKind?: 'total';
  targetCheckId?: string;
  appliesTo?: ModifierAppliesTo;
  activatedByTraitIds?: string[];
  operation: 'add' | 'multiply';
  value: ResolutionExpression;
  when?: ResolutionCondition;
}

export interface RollResultSelector {
  dieTraitIds?: string[];
  rollKinds?: RollKind[];
  rawResults?: number[];
  origins?: DieResultOrigin[];
}

export type RollResultOperation =
  | { kind: 'add-dice'; dice: ResolutionDiePool }
  | { kind: 'replace-result'; die: Omit<ResolutionDiePool, 'count'>; maximumApplications?: number }
  | { kind: 'increase-result'; value: ResolutionExpression };

export interface RollModifierDefinition extends ResolutionDefinitionBase {
  definitionType: 'modifier';
  modifierKind: 'roll-result';
  targetCheckId?: string;
  appliesTo?: ModifierAppliesTo;
  activatedByTraitIds?: string[];
  priority?: number;
  selector?: RollResultSelector;
  rollOperation: RollResultOperation;
  when?: ResolutionCondition;
}

export type ModifierDefinition = TotalModifierDefinition | RollModifierDefinition;

export interface CheckDefinition extends ResolutionDefinitionBase {
  definitionType: 'check';
  checkKind: 'target-number';
  roll: ResolutionRollSpec;
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
  operationSubjectContracts?: Record<string, {
    directTraitIds: string[];
    inheritedTraitIds: string[];
    effectiveTraitIds: string[];
    effectiveTraitSelections?: Record<string, string[]>;
    checkSources: Array<{ checkId: string; traitIds: string[]; traitSelections?: Record<string, string[]> }>;
  }>;
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
  activeTraitIds?: string[];
  activeTraitInstances?: Array<{
    instanceId: string;
    traitId: string;
    values?: Record<string, ResolutionPrimitive>;
  }>;
  traitPrerequisiteSelections?: Record<string, string[]>;
  traitInstancePrerequisiteSelections?: Record<string, string[]>;
  traitInstanceValues?: Record<string, Record<string, ResolutionPrimitive>>;
  activeEffectIds?: string[];
  entropy: number[];
}

export interface ResolutionTraceEntry {
  stepId: string;
  kind: string;
  message: string;
  values?: Record<string, ResolutionPrimitive>;
}

export interface ResolutionDieResult {
  resultId: string;
  dieTraitId: string;
  sides: number;
  rollKind: RollKind;
  rawResult: number;
  effectiveResult: number;
  origin: DieResultOrigin;
  sourceDefinitionId: string;
  sourceRollTraitId?: string;
  active: boolean;
  replacesResultId?: string;
  replacedByResultId?: string;
  appliedModifierIds: string[];
}

export interface ResolutionRollResult {
  resultKey: string;
  checkId: string;
  rollTraitId?: string;
  dice: ResolutionDieResult[];
  appliedModifierIds: string[];
  modifierActivations: Array<{
    modifierId: string;
    sources: Array<{
      kind: 'explicit' | 'trait' | 'effect';
      id: string;
      rootTraitId?: string;
      traitChain?: string[];
      instanceId?: string;
      rootInstanceId?: string;
      instanceChain?: string[];
    }>;
  }>;
  totals: Partial<Record<RollKind, number>>;
  roll: number;
  bonus: number;
  total: number;
  target: number;
  success: boolean;
}

export interface ResolutionActiveTrait {
  traitId: string;
  roots: Array<{ rootTraitId: string; traitChain: string[] }>;
}

export interface ResolutionTraitChoice {
  traitId: string;
  traitInstanceId?: string;
  selectedTraitIds: string[];
  source: 'context' | 'active-roots';
}

export interface ResolutionActiveTraitInstance {
  instanceId: string;
  traitId: string;
  rootInstanceId: string;
  rootTraitId: string;
  parentInstanceId?: string;
  relation?: 'requires' | 'adds' | 'choice';
  path?: string;
  ordinal?: number;
  mountPath: string[];
  traitChain: string[];
  instanceChain: string[];
  values: Record<string, ResolutionPrimitive>;
  valueModifiers: Array<{
    sourceInstanceId: string;
    sourceTraitId: string;
    anchor: 'self' | 'this';
    operation: 'increases' | 'decreases' | 'multiplies' | 'divides' | 'sets';
    path: string[];
    amount: ResolutionPrimitive;
    mountSelector?: { mode: 'all' } | { mode: 'ordinal'; ordinal: number };
    before?: ResolutionPrimitive;
    after: ResolutionPrimitive;
  }>;
}

export interface ResolutionPreview {
  outcome: 'success' | 'failure';
  data: Record<string, ResolutionPrimitive>;
  resourceChanges: Array<{ resourceId: string; before: number; after: number }>;
  effects: Array<{ effectId: string; targetId: string }>;
  events: Array<{ eventId: string; visibility: string; payload: Record<string, ResolutionPrimitive> }>;
  activeTraits: ResolutionActiveTrait[];
  activeTraitInstances: ResolutionActiveTraitInstance[];
  traitChoices: ResolutionTraitChoice[];
  rolls: ResolutionRollResult[];
  entropyConsumed: number[];
  trace: ResolutionTraceEntry[];
}

export interface ResolutionFixture {
  name: string;
  operationId: string;
  context: ResolutionContext;
  expected: Partial<Pick<ResolutionPreview, 'outcome' | 'effects' | 'events'>>;
}
