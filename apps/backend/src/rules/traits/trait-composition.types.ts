import type { TraitShapeNode } from '@world-building/common';

export const TRAIT_COMPOSITION_METAMODEL_VERSION = 'trait/2' as const;
export const LEGACY_TRAIT_COMPOSITION_METAMODEL_VERSION = 'trait/1' as const;
export const TRAIT_COMPOSITION_ARTIFACT_VERSION = 'trait-composition-artifact/1' as const;

export interface TraitCompositionSourceDefinition {
  externalId: string;
  name: string;
  body: Record<string, unknown>;
}

export interface TraitCompositionDiagnostic {
  code: string;
  message: string;
  path: string;
  severity: 'error' | 'warning';
}

export interface CompiledTraitModifier {
  sourceTraitId: string;
  anchor: 'self' | 'this';
  operation: 'increases' | 'decreases' | 'multiplies' | 'divides' | 'sets';
  path: string[];
  amount: string | number | boolean;
  mountSelector?: { mode: 'all' } | { mode: 'ordinal'; ordinal: number };
}

export interface CompiledTraitContract {
  traitId: string;
  name: string;
  nodes: TraitShapeNode[];
  modifiers: CompiledTraitModifier[];
}

export interface CompiledTraitActivationEdge {
  fromTraitId: string;
  toTraitId: string;
  kind: 'requires' | 'adds';
  path?: string;
  count?: number;
}

export interface CompiledTraitActivationChoice {
  traitId: string;
  optionTraitIds: string[];
}

export interface CompiledTraitCompositionArtifact {
  artifactVersion: typeof TRAIT_COMPOSITION_ARTIFACT_VERSION;
  metamodelVersion: typeof TRAIT_COMPOSITION_METAMODEL_VERSION;
  sourceHash: string;
  traits: CompiledTraitContract[];
  activationEdges: CompiledTraitActivationEdge[];
  activationChoices: CompiledTraitActivationChoice[];
}

export interface TraitCompositionCompilationResult {
  valid: boolean;
  diagnostics: TraitCompositionDiagnostic[];
  artifact?: CompiledTraitCompositionArtifact;
}

export const traitCompositionMetamodelDescriptor = {
  metamodelVersion: TRAIT_COMPOSITION_METAMODEL_VERSION,
  artifactVersion: TRAIT_COMPOSITION_ARTIFACT_VERSION,
  definitionTypes: ['trait'],
  grantTypes: [
    'text',
    'number',
    'boolean',
    'enum',
    'trait',
    'trait-collection',
    'modifier',
    'slot',
    'slot-affinity',
  ],
  compositionOperations: ['adds', 'extends', 'requires', 'modifies'],
  pathRoots: ['self', 'this', 'owner', 'target'],
  artifactCapabilities: ['effective-shape', 'modifier-provenance', 'trait-activation-graph', 'instance-prerequisite-choices', 'counted-trait-instances', 'typed-instance-values', 'cross-mount-value-modifiers', 'repeated-mount-selectors'],
  compatibleSourceVersions: [LEGACY_TRAIT_COMPOSITION_METAMODEL_VERSION, TRAIT_COMPOSITION_METAMODEL_VERSION],
};
