import type { CanonicalUnitId, TraitShapeNode, UnitAmount } from '@wanderlust-vtt/common';

export const TRAIT_COMPOSITION_METAMODEL_VERSION = 'trait/2' as const;
export const LEGACY_TRAIT_COMPOSITION_METAMODEL_VERSION = 'trait/1' as const;
export const TRAIT_COMPOSITION_ARTIFACT_VERSION = 'trait-composition-artifact/1' as const;

export interface TraitCompositionSourceDefinition {
  externalId: string;
  name: string;
  body: Record<string, unknown>;
  tags?: string[];
}

export type CompiledTraitMountSelector =
  | { mode: 'all' }
  | { mode: 'ordinal'; ordinal: number }
  | { mode: 'trait'; traitId: string }
  | { mode: 'tag'; tag: string };

export interface TraitCompositionDiagnostic {
  code: string;
  message: string;
  path: string;
  severity: 'error' | 'warning';
  definitionExternalId?: string;
  definitionName?: string;
  grantIndex?: number;
}

export interface CompiledTraitModifier {
  sourceTraitId: string;
  anchor: 'self' | 'this';
  operation: 'increases' | 'decreases' | 'multiplies' | 'divides' | 'sets' | 'at-least' | 'at-most';
  path: string[];
  amount: string | number | boolean;
  priority?: number;
  condition?: {
    operator: 'equals' | 'gte' | 'lte';
    value: string | number | boolean;
    authoredValue?: UnitAmount;
    normalizedValue?: UnitAmount;
  };
  authoredAmount?: UnitAmount;
  normalizedAmount?: UnitAmount;
  targetUnit?: CanonicalUnitId;
  mountSelector?: CompiledTraitMountSelector;
  mountSelectors?: CompiledTraitMountSelector[];
}

export interface CompiledTraitContract {
  traitId: string;
  name: string;
  nodes: TraitShapeNode[];
  modifiers: CompiledTraitModifier[];
  tags: string[];
}

export interface CompiledTraitStructuralDirective {
  sourceTraitId: string;
  kind: 'suppression' | 'replacement';
  anchor: 'self' | 'this';
  path: string[];
  priority: number;
  replacementTraitId?: string;
  mountSelector?: CompiledTraitMountSelector;
  mountSelectors?: CompiledTraitMountSelector[];
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
  structuralDirectives: CompiledTraitStructuralDirective[];
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
    'media',
    'trait',
    'trait-collection',
    'modifier',
    'suppression',
    'replacement',
  ],
  mediaTypes: ['text', 'audio', 'video', 'image'],
  compositionOperations: ['adds', 'extends', 'requires', 'modifies', 'suppresses', 'replaces'],
  pathRoots: ['self', 'this'],
  artifactCapabilities: ['effective-shape', 'modifier-provenance', 'trait-activation-graph', 'instance-prerequisite-choices', 'counted-trait-instances', 'bounded-trait-collections', 'typed-instance-values', 'cross-mount-value-modifiers', 'repeated-mount-selectors', 'canonical-units', 'advanced-value-stacking', 'structural-directives', 'authoritative-structural-contracts', 'recursive-structural-directives', 'structural-mount-selectors', 'recursive-repeated-paths', 'trait-identity-selectors', 'semantic-tag-selectors'],
  compatibleSourceVersions: [LEGACY_TRAIT_COMPOSITION_METAMODEL_VERSION, TRAIT_COMPOSITION_METAMODEL_VERSION],
};
