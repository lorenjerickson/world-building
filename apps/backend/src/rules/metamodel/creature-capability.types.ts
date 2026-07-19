export const CREATURE_CAPABILITY_METAMODEL_VERSION = 'creature-capabilities/1' as const;
export const CREATURE_CAPABILITY_ARTIFACT_VERSION = 'creature-capability-artifact/1' as const;

export type PrimitiveValue = string | number | boolean;
export type ValueType =
  | 'boolean'
  | 'integer'
  | 'decimal'
  | 'text'
  | 'distance'
  | 'movement-rate';

export interface ValueSchema {
  type: ValueType;
  unit?: 'meter' | 'meter-per-turn';
  minimum?: number;
  maximum?: number;
  allowedValues?: string[];
}

export type Expression =
  | { op: 'literal'; value: PrimitiveValue; valueType: ValueType }
  | { op: 'parameter'; parameterId: string }
  | { op: 'get'; definitionId: string }
  | { op: 'capability'; capability: CapabilityId; property: string }
  | { op: 'add' | 'subtract' | 'multiply' | 'divide'; left: Expression; right: Expression }
  | { op: 'floor'; value: Expression };

export type Condition =
  | { op: 'equals'; left: Expression; right: Expression }
  | { op: 'all' | 'any'; conditions: Condition[] }
  | { op: 'not'; condition: Condition };

export interface RuleDefinitionBase {
  formatVersion: '1';
  metamodelVersion: typeof CREATURE_CAPABILITY_METAMODEL_VERSION;
  definitionId: string;
  name: string;
  description?: string;
}

export interface FieldDefinition extends RuleDefinitionBase {
  definitionType: 'field';
  value: ValueSchema;
  defaultValue?: PrimitiveValue;
}

export interface DerivedValueDefinition extends RuleDefinitionBase {
  definitionType: 'derived-value';
  value: ValueSchema;
  expression: Expression;
}

export interface ParameterDefinition {
  parameterId: string;
  name: string;
  value: ValueSchema;
  required?: boolean;
  defaultValue?: PrimitiveValue;
}

export type CapabilityId =
  | 'perception.visual'
  | 'perception.audio'
  | 'movement.walk'
  | 'movement.run';

export interface CapabilityContribution {
  capability: CapabilityId;
  values: Record<string, Expression>;
  when?: Condition;
}

export interface TraitDefinition extends RuleDefinitionBase {
  definitionType: 'trait';
  parameters?: ParameterDefinition[];
  contributes: CapabilityContribution[];
}

export type CreatureCapabilityDefinition =
  | FieldDefinition
  | DerivedValueDefinition
  | TraitDefinition;

export interface Diagnostic {
  code: string;
  message: string;
  path: string;
  severity: 'error' | 'warning';
}

export interface CompiledCreatureCapabilityArtifact {
  artifactVersion: typeof CREATURE_CAPABILITY_ARTIFACT_VERSION;
  metamodelVersion: typeof CREATURE_CAPABILITY_METAMODEL_VERSION;
  sourceHash: string;
  definitions: CreatureCapabilityDefinition[];
}

export interface CompilationResult {
  artifact?: CompiledCreatureCapabilityArtifact;
  diagnostics: Diagnostic[];
  valid: boolean;
}

export interface TraitApplication {
  traitId: string;
  parameters?: Record<string, PrimitiveValue>;
}

export interface CreatureEvaluationContext {
  fields?: Record<string, PrimitiveValue>;
  traits: TraitApplication[];
  environment?: {
    lighting?: string;
  };
}

export interface EvaluationTraceEntry {
  path: string;
  message: string;
  value?: PrimitiveValue;
}

export interface CreatureEvaluation {
  values: Record<string, PrimitiveValue>;
  capabilities: Record<string, Record<string, PrimitiveValue>>;
  trace: EvaluationTraceEntry[];
}

export interface VisualObservation {
  channel: 'visual';
  perceived: boolean;
  distance: number;
  maximumRange: number;
  blockedBy: 'range' | 'lighting' | 'line-of-sight' | 'opaque-barrier' | null;
}
