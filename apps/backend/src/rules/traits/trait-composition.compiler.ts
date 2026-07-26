import { createHash } from 'crypto';
import {
  buildTraitShape,
  convertUnitValue,
  isCanonicalUnitId,
  resolveTraitShapeTerminal,
  traitSatisfiesCollection,
  traitShapeTerminalPaths,
  unitsAreCompatible,
  type CanonicalUnitId,
  type TraitGrantDataType,
  type TraitShape,
  type TraitShapeNode,
} from '@world-building/common';
import {
  TRAIT_COMPOSITION_ARTIFACT_VERSION,
  TRAIT_COMPOSITION_METAMODEL_VERSION,
  LEGACY_TRAIT_COMPOSITION_METAMODEL_VERSION,
  type CompiledTraitActivationEdge,
  type CompiledTraitActivationChoice,
  type CompiledTraitContract,
  type CompiledTraitModifier,
  type CompiledTraitMountSelector,
  type CompiledTraitStructuralDirective,
  type TraitCompositionCompilationResult,
  type TraitCompositionDiagnostic,
  type TraitCompositionSourceDefinition,
} from './trait-composition.types';

const DATA_TYPES: TraitGrantDataType[] = [
  'text',
  'number',
  'boolean',
  'enum',
  'trait',
  'trait-collection',
  'modifier',
  'suppression',
  'replacement',
  'slot',
  'slot-affinity',
];
const MODIFIER_OPERATIONS = ['increases', 'decreases', 'multiplies', 'divides', 'sets', 'at-least', 'at-most'] as const;
const MAXIMUM_DEFINITIONS = 2_000;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (record(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function diagnostic(
  diagnostics: TraitCompositionDiagnostic[],
  code: string,
  path: string,
  message: string,
  severity: 'error' | 'warning' = 'error',
): void {
  diagnostics.push({ code, path, message, severity });
}

function definitionPath(
  definition: TraitCompositionSourceDefinition,
  index: number,
): string {
  const label = definition.name?.trim() || definition.externalId?.trim() || `#${index + 1}`;
  return `definitions[${JSON.stringify(label)}]`;
}

function contextualizeDiagnostics(
  diagnostics: TraitCompositionDiagnostic[],
  definitions: TraitCompositionSourceDefinition[],
): void {
  for (const item of diagnostics) {
    const match = definitions
      .map((definition, index) => ({ definition, prefix: definitionPath(definition, index) }))
      .find(({ prefix }) => item.path === prefix || item.path.startsWith(`${prefix}.`));
    if (!match) continue;
    item.definitionExternalId = match.definition.externalId;
    item.definitionName = match.definition.name;
    const grantMatch = item.path.match(/\.body\.grants\[(\d+)\]/);
    if (grantMatch) item.grantIndex = Number(grantMatch[1]);
  }
}

function validateStringArray(
  value: unknown,
  path: string,
  diagnostics: TraitCompositionDiagnostic[],
): value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    diagnostic(diagnostics, 'RULE_TRAIT_STRING_LIST_INVALID', path, 'Expected a list of non-empty trait IDs.');
    return false;
  }
  return true;
}

function validatePrerequisites(
  body: Record<string, unknown>,
  path: string,
  diagnostics: TraitCompositionDiagnostic[],
): void {
  if (body.prerequisites === undefined) return;
  if (Array.isArray(body.prerequisites)) {
    validateStringArray(body.prerequisites, path, diagnostics);
    return;
  }
  if (!record(body.prerequisites)) {
    diagnostic(diagnostics, 'RULE_TRAIT_PREREQUISITES_INVALID', path, 'Prerequisites must be a trait-ID list or an object containing mode and ids.');
    return;
  }
  if (body.prerequisites.mode !== 'any' && body.prerequisites.mode !== 'all') {
    diagnostic(diagnostics, 'RULE_TRAIT_PREREQUISITE_MODE_INVALID', `${path}.mode`, "Prerequisite mode must be 'any' or 'all'.");
  }
  validateStringArray(body.prerequisites.ids, `${path}.ids`, diagnostics);
}

function validateMountSelector(
  value: unknown,
  path: string,
  diagnostics: TraitCompositionDiagnostic[],
  allowAll: boolean,
): boolean {
  if (!record(value)) {
    diagnostic(diagnostics, 'RULE_TRAIT_SELECTOR_INVALID', path, 'A mount selector must be an object.');
    return false;
  }
  if (value.mode === 'all' || value.mode === 'wildcard') {
    if (!allowAll) {
      diagnostic(diagnostics, 'RULE_TRAIT_SELECTOR_COLLECTION_RESULT_INVALID', `${path}.mode`, 'Scalar paths cannot select all collection entries.');
      return false;
    }
    return true;
  }
  if (value.mode === 'ordinal') {
    if (!Number.isInteger(value.ordinal) || Number(value.ordinal) < 1) {
      diagnostic(diagnostics, 'RULE_TRAIT_SELECTOR_INVALID', `${path}.ordinal`, 'Ordinal selectors require a positive whole number.');
      return false;
    }
    return true;
  }
  if (value.mode === 'trait') {
    if (typeof value.traitId !== 'string' || !value.traitId.trim()) {
      diagnostic(diagnostics, 'RULE_TRAIT_SELECTOR_INVALID', `${path}.traitId`, 'Trait selectors require a stable trait identity.');
      return false;
    }
    return true;
  }
  if (value.mode === 'tag') {
    if (typeof value.tag !== 'string' || !value.tag.trim()) {
      diagnostic(diagnostics, 'RULE_TRAIT_SELECTOR_INVALID', `${path}.tag`, 'Semantic-tag selectors require a non-empty tag.');
      return false;
    }
    return true;
  }
  diagnostic(diagnostics, 'RULE_TRAIT_SELECTOR_INVALID', `${path}.mode`, "Selector mode must be 'all', 'wildcard', 'ordinal', 'trait', or 'tag'.");
  return false;
}

function validateRepeatedMountSelectors(
  grant: Record<string, unknown>,
  authoredPath: unknown,
  path: string,
  diagnostics: TraitCompositionDiagnostic[],
  label: string,
): void {
  const repeatedCount = typeof authoredPath === 'string'
    ? authoredPath.split('.').filter((segment) => segment.trim().endsWith('[]')).length
    : 0;
  if (!repeatedCount) {
    if (grant.mountSelector !== undefined || grant.mountSelectors !== undefined) {
      diagnostic(diagnostics, `RULE_TRAIT_${label}_SELECTOR_UNUSED`, `${path}.mountSelectors`, 'Mount selectors require a repeated [] path segment.');
    }
    return;
  }
  if (grant.mountSelector !== undefined && grant.mountSelectors !== undefined) {
    diagnostic(diagnostics, `RULE_TRAIT_${label}_SELECTOR_AMBIGUOUS`, `${path}.mountSelectors`, 'Use either the legacy single mountSelector or the ordered mountSelectors list, not both.');
    return;
  }
  if (grant.mountSelector !== undefined) {
    if (repeatedCount !== 1) {
      diagnostic(diagnostics, `RULE_TRAIT_${label}_SELECTORS_REQUIRED`, `${path}.mountSelectors`, `A path with ${repeatedCount} repeated segments requires ${repeatedCount} ordered selectors.`);
      return;
    }
    validateMountSelector(grant.mountSelector, `${path}.mountSelector`, diagnostics, true);
    return;
  }
  if (!Array.isArray(grant.mountSelectors) || grant.mountSelectors.length !== repeatedCount) {
    diagnostic(
      diagnostics,
      `RULE_TRAIT_${label}_${repeatedCount === 1 ? 'SELECTOR' : 'SELECTORS'}_REQUIRED`,
      repeatedCount === 1 ? `${path}.mountSelector` : `${path}.mountSelectors`,
      repeatedCount === 1
        ? 'A repeated path requires one mount selector.'
        : `A path with ${repeatedCount} repeated segments requires ${repeatedCount} ordered selectors.`,
    );
    return;
  }
  grant.mountSelectors.forEach((selector, index) =>
    validateMountSelector(selector, `${path}.mountSelectors[${index}]`, diagnostics, true));
}

function compiledMountSelector(value: unknown): CompiledTraitMountSelector | undefined {
  if (!record(value)) return undefined;
  if (value.mode === 'all' || value.mode === 'wildcard') return { mode: 'all' };
  if (value.mode === 'ordinal') return { mode: 'ordinal', ordinal: Number(value.ordinal) };
  if (value.mode === 'trait') return { mode: 'trait', traitId: String(value.traitId) };
  if (value.mode === 'tag') return { mode: 'tag', tag: String(value.tag) };
  return undefined;
}

function compiledMountSelectors(value: Record<string, unknown>): {
  mountSelector?: CompiledTraitMountSelector;
  mountSelectors?: CompiledTraitMountSelector[];
} {
  const legacy = compiledMountSelector(value.mountSelector);
  if (legacy) return { mountSelector: legacy };
  if (!Array.isArray(value.mountSelectors)) return {};
  const selectors = value.mountSelectors.map(compiledMountSelector)
    .filter((selector): selector is CompiledTraitMountSelector => selector !== undefined);
  return selectors.length === value.mountSelectors.length ? { mountSelectors: selectors } : {};
}

function mountSelectorKey(selector: CompiledTraitMountSelector | undefined): string {
  if (!selector) return '';
  if (selector.mode === 'ordinal') return `ordinal:${selector.ordinal}`;
  if (selector.mode === 'trait') return `trait:${selector.traitId}`;
  if (selector.mode === 'tag') return `tag:${selector.tag}`;
  return 'all';
}

function validateGrant(
  grant: unknown,
  path: string,
  diagnostics: TraitCompositionDiagnostic[],
): void {
  if (!record(grant)) {
    diagnostic(diagnostics, 'RULE_TRAIT_GRANT_INVALID', path, 'A grant must be an object.');
    return;
  }
  if (!DATA_TYPES.includes(grant.dataType as TraitGrantDataType)) {
    diagnostic(diagnostics, 'RULE_TRAIT_GRANT_TYPE_INVALID', `${path}.dataType`, 'Grant dataType is unsupported.');
    return;
  }
  const dataType = grant.dataType as TraitGrantDataType;
  const keyRequired = ['text', 'number', 'boolean', 'enum', 'trait-collection'].includes(dataType)
    || (dataType === 'trait' && typeof grant.into !== 'string' && typeof grant.at !== 'string');
  if (keyRequired && (typeof grant.key !== 'string' || !grant.key.trim())) {
    diagnostic(diagnostics, 'RULE_TRAIT_GRANT_KEY_REQUIRED', `${path}.key`, `${dataType} grants require a non-empty path name.`);
  }
  if (grant.key !== undefined && typeof grant.key !== 'string') {
    diagnostic(diagnostics, 'RULE_TRAIT_GRANT_KEY_INVALID', `${path}.key`, 'Grant path names must be strings.');
  }
  if (grant.unit !== undefined) {
    if (dataType !== 'number') {
      diagnostic(diagnostics, 'RULE_TRAIT_FIELD_UNIT_UNSUPPORTED', `${path}.unit`, 'Only numeric fields may declare a unit.');
    } else if (!isCanonicalUnitId(grant.unit)) {
      diagnostic(diagnostics, 'RULE_TRAIT_FIELD_UNIT_INVALID', `${path}.unit`, `Unknown canonical unit '${String(grant.unit)}'.`);
    }
  }
  if (grant.required !== undefined && typeof grant.required !== 'boolean') {
    diagnostic(diagnostics, 'RULE_TRAIT_FIELD_REQUIRED_INVALID', `${path}.required`, 'Field requiredness must be a Boolean.');
  }
  if (['text', 'number', 'boolean', 'enum'].includes(dataType)) {
    if (dataType === 'number') {
      if (grant.min !== undefined && (typeof grant.min !== 'number' || !Number.isFinite(grant.min))) {
        diagnostic(diagnostics, 'RULE_TRAIT_FIELD_BOUND_INVALID', `${path}.min`, 'Numeric minimum must be a finite number.');
      }
      if (grant.max !== undefined && (typeof grant.max !== 'number' || !Number.isFinite(grant.max))) {
        diagnostic(diagnostics, 'RULE_TRAIT_FIELD_BOUND_INVALID', `${path}.max`, 'Numeric maximum must be a finite number.');
      }
      if (typeof grant.min === 'number' && Number.isFinite(grant.min)
        && typeof grant.max === 'number' && Number.isFinite(grant.max)
        && grant.min > grant.max) {
        diagnostic(diagnostics, 'RULE_TRAIT_FIELD_BOUNDS_INVALID', path, 'Numeric minimum cannot be greater than maximum.');
      }
    } else if (grant.min !== undefined || grant.max !== undefined) {
      diagnostic(diagnostics, 'RULE_TRAIT_FIELD_BOUND_UNSUPPORTED', path, 'Only numeric fields may declare minimum or maximum values.');
    }
    if (grant.default !== undefined) {
      const defaultTypeValid = dataType === 'number'
        ? typeof grant.default === 'number' && Number.isFinite(grant.default)
        : dataType === 'boolean'
          ? typeof grant.default === 'boolean'
          : typeof grant.default === 'string';
      if (!defaultTypeValid) {
        diagnostic(diagnostics, 'RULE_TRAIT_FIELD_DEFAULT_INVALID', `${path}.default`, `Default value must match the ${dataType} field type.`);
      } else if (dataType === 'number'
        && typeof grant.default === 'number'
        && ((typeof grant.min === 'number' && grant.default < grant.min)
          || (typeof grant.max === 'number' && grant.default > grant.max))) {
        diagnostic(diagnostics, 'RULE_TRAIT_FIELD_DEFAULT_OUT_OF_RANGE', `${path}.default`, 'Numeric default must fall within the declared bounds.');
      }
    }
  }
  if (dataType === 'trait') {
    if (typeof grant.ref !== 'string' || !grant.ref.trim()) {
      diagnostic(diagnostics, 'RULE_TRAIT_REFERENCE_REQUIRED', `${path}.ref`, 'Trait additions require a referenced trait.');
    }
    if (grant.into !== undefined && grant.at !== undefined) {
      diagnostic(diagnostics, 'RULE_TRAIT_DESTINATION_AMBIGUOUS', path, "A trait addition cannot use both 'into' and 'at'.");
    }
    if (grant.into !== undefined && (typeof grant.into !== 'string' || !grant.into.trim())) {
      diagnostic(diagnostics, 'RULE_TRAIT_COLLECTION_PATH_INVALID', `${path}.into`, 'Collection destination must be a non-empty path.');
    }
    if (grant.at !== undefined && (typeof grant.at !== 'string' || !grant.at.trim())) {
      diagnostic(diagnostics, 'RULE_TRAIT_ADDITION_PATH_INVALID', `${path}.at`, 'Nested destination must be a non-empty path.');
    }
    if (grant.into !== undefined) {
      const count = grant.count ?? 1;
      if (!Number.isInteger(count) || Number(count) < 1) {
        diagnostic(diagnostics, 'RULE_TRAIT_COUNT_INVALID', `${path}.count`, 'Counted trait additions require a positive whole-number count.');
      }
    }
  }
  if (dataType === 'trait-collection' || dataType === 'slot') {
    if (grant.acceptedTraits !== undefined) {
      validateStringArray(grant.acceptedTraits, `${path}.acceptedTraits`, diagnostics);
    }
    if (grant.acceptsMode !== undefined && grant.acceptsMode !== 'any' && grant.acceptsMode !== 'all') {
      diagnostic(diagnostics, 'RULE_TRAIT_ACCEPTANCE_MODE_INVALID', `${path}.acceptsMode`, "Acceptance mode must be 'any' or 'all'.");
    }
  }
  if (dataType === 'enum' && grant.allowedValues !== undefined) {
    validateStringArray(grant.allowedValues, `${path}.allowedValues`, diagnostics);
    if (typeof grant.default === 'string'
      && Array.isArray(grant.allowedValues)
      && !grant.allowedValues.includes(grant.default)) {
      diagnostic(diagnostics, 'RULE_TRAIT_FIELD_DEFAULT_INVALID', `${path}.default`, 'Enum default must be one of the allowed values.');
    }
  }
  if (dataType === 'modifier') {
    if (!MODIFIER_OPERATIONS.includes(grant.operation as typeof MODIFIER_OPERATIONS[number])) {
      diagnostic(diagnostics, 'RULE_TRAIT_MODIFIER_OPERATION_INVALID', `${path}.operation`, 'Modifier operation is unsupported.');
    }
    if (typeof grant.field !== 'string' || !grant.field.trim()) {
      diagnostic(diagnostics, 'RULE_TRAIT_MODIFIER_PATH_REQUIRED', `${path}.field`, 'A modifier requires an exact target path.');
    } else if (!['self', 'this'].includes(grant.field.split('.')[0]?.trim())) {
      diagnostic(
        diagnostics,
        'RULE_TRAIT_MODIFIER_ROOT_INVALID',
        `${path}.field`,
        "Trait value modifiers must use an explicit 'self' or 'this' root.",
      );
    }
    if (!('amount' in grant)) {
      diagnostic(diagnostics, 'RULE_TRAIT_MODIFIER_AMOUNT_REQUIRED', `${path}.amount`, 'A modifier amount is required.');
    }
    if (grant.priority !== undefined
      && (!Number.isInteger(grant.priority) || Number(grant.priority) < -1_000 || Number(grant.priority) > 1_000)) {
      diagnostic(diagnostics, 'RULE_TRAIT_MODIFIER_PRIORITY_INVALID', `${path}.priority`, 'Modifier priority must be a whole number from -1000 through 1000.');
    }
    if (grant.when !== undefined) {
      if (!record(grant.when)) {
        diagnostic(diagnostics, 'RULE_TRAIT_MODIFIER_CONDITION_INVALID', `${path}.when`, 'Modifier condition must be an object.');
      } else {
        if (!['equals', 'gte', 'lte'].includes(String(grant.when.operator))) {
          diagnostic(diagnostics, 'RULE_TRAIT_MODIFIER_CONDITION_OPERATOR_INVALID', `${path}.when.operator`, "Condition operator must be 'equals', 'gte', or 'lte'.");
        }
        if (!('value' in grant.when)) {
          diagnostic(diagnostics, 'RULE_TRAIT_MODIFIER_CONDITION_VALUE_REQUIRED', `${path}.when.value`, 'Modifier condition requires a comparison value.');
        }
      }
    }
    validateRepeatedMountSelectors(grant, grant.field, path, diagnostics, 'MODIFIER');
  }
  if (dataType === 'suppression' || dataType === 'replacement') {
    if (typeof grant.target !== 'string' || !grant.target.trim()) {
      diagnostic(diagnostics, 'RULE_TRAIT_STRUCTURAL_TARGET_REQUIRED', `${path}.target`, 'Structural directives require an exact target path.');
    } else {
      const segments = grant.target.split('.').map((segment) => segment.trim()).filter(Boolean);
      if (!['self', 'this'].includes(segments[0] ?? '')) {
        diagnostic(diagnostics, 'RULE_TRAIT_STRUCTURAL_ROOT_INVALID', `${path}.target`, "Structural targets must use an explicit 'self' or 'this' root.");
      }
      if (segments.length < 2) {
        diagnostic(diagnostics, 'RULE_TRAIT_STRUCTURAL_ROOT_TARGET_INVALID', `${path}.target`, 'Structural directives cannot target the composition root.');
      }
    }
    validateRepeatedMountSelectors(grant, grant.target, path, diagnostics, 'STRUCTURAL');
    if (!Number.isInteger(grant.priority) || Number(grant.priority) < -1_000 || Number(grant.priority) > 1_000) {
      diagnostic(diagnostics, 'RULE_TRAIT_STRUCTURAL_PRIORITY_INVALID', `${path}.priority`, 'Structural directive priority must be a whole number from -1000 through 1000.');
    }
    if (dataType === 'replacement' && (typeof grant.ref !== 'string' || !grant.ref.trim())) {
      diagnostic(diagnostics, 'RULE_TRAIT_REPLACEMENT_REFERENCE_REQUIRED', `${path}.ref`, 'Replacement directives require a replacement trait.');
    }
    if (dataType === 'suppression' && grant.ref !== undefined) {
      diagnostic(diagnostics, 'RULE_TRAIT_SUPPRESSION_REFERENCE_INVALID', `${path}.ref`, 'Suppression directives cannot declare a replacement trait.');
    }
  }
}

function validateDefinitionShape(
  definition: TraitCompositionSourceDefinition,
  index: number,
  diagnostics: TraitCompositionDiagnostic[],
): void {
  const path = definitionPath(definition, index);
  if (typeof definition.externalId !== 'string' || !definition.externalId.trim()) {
    diagnostic(diagnostics, 'RULE_TRAIT_ID_REQUIRED', `${path}.externalId`, 'A stable trait ID is required.');
  }
  if (typeof definition.name !== 'string' || !definition.name.trim()) {
    diagnostic(diagnostics, 'RULE_TRAIT_NAME_REQUIRED', `${path}.name`, 'A trait name is required.');
  }
  if (!record(definition.body)) {
    diagnostic(diagnostics, 'RULE_TRAIT_BODY_INVALID', `${path}.body`, 'Trait body must be an object.');
    return;
  }
  if (definition.body.metamodelVersion !== TRAIT_COMPOSITION_METAMODEL_VERSION
    && definition.body.metamodelVersion !== LEGACY_TRAIT_COMPOSITION_METAMODEL_VERSION) {
    diagnostic(
      diagnostics,
      'RULE_TRAIT_VERSION_INVALID',
      `${path}.body.metamodelVersion`,
      `Composed traits require metamodelVersion '${LEGACY_TRAIT_COMPOSITION_METAMODEL_VERSION}' or '${TRAIT_COMPOSITION_METAMODEL_VERSION}'.`,
    );
  }
  if (definition.body.metamodelVersion === TRAIT_COMPOSITION_METAMODEL_VERSION
    && Array.isArray(definition.body.prerequisites)) {
    diagnostic(
      diagnostics,
      'RULE_TRAIT_V2_PREREQUISITES_EXPLICIT',
      `${path}.body.prerequisites`,
      "trait/2 prerequisites must use the explicit { mode, ids } form.",
    );
  }
  if (!Array.isArray(definition.body.grants)) {
    diagnostic(diagnostics, 'RULE_TRAIT_GRANTS_REQUIRED', `${path}.body.grants`, 'A composed trait requires a grants array.');
  } else {
    definition.body.grants.forEach((grant, grantIndex) => {
      validateGrant(grant, `${path}.body.grants[${grantIndex}]`, diagnostics);
      if (definition.body.metamodelVersion === TRAIT_COMPOSITION_METAMODEL_VERSION
        && record(grant)
        && grant.dataType === 'trait'
        && grant.into === undefined
        && grant.at === undefined) {
        diagnostic(
          diagnostics,
          'RULE_TRAIT_V2_PLACEMENT_REQUIRED',
          `${path}.body.grants[${grantIndex}].at`,
          "trait/2 additions require an explicit 'at' destination.",
        );
      }
    });
  }
  validatePrerequisites(definition.body, `${path}.body.prerequisites`, diagnostics);
}

function normalizedModifierPath(field: string): string[] {
  const segments = field.split('.').map((segment) => segment.trim()).filter(Boolean);
  if (segments[0] === 'self' || segments[0] === 'this' || segments[0] === 'owner' || segments[0] === 'target') {
    return segments.slice(1);
  }
  return segments;
}

function modifierAnchor(field: string): 'self' | 'this' {
  const root = field.split('.').map((segment) => segment.trim()).filter(Boolean)[0];
  return root === 'this' ? 'this' : 'self';
}

function resolveModifierTerminal(
  shape: TraitShape,
  path: string[],
  inputs: TraitCompositionSourceDefinition[],
): ReturnType<typeof resolveTraitShapeTerminal> {
  if (!path.some((segment) => segment.endsWith('[]'))) {
    return resolveTraitShapeTerminal(shape, path);
  }
  return traitShapeTerminalPaths(shape, inputs)
    .find((candidate) => candidate.path.join('.') === path.join('.'))
    ?.terminal;
}

function compileActivationEdges(inputs: TraitCompositionSourceDefinition[]): CompiledTraitActivationEdge[] {
  const edges: CompiledTraitActivationEdge[] = [];
  for (const definition of inputs) {
    const prerequisites = Array.isArray(definition.body.prerequisites)
      ? definition.body.prerequisites.filter((traitId): traitId is string => typeof traitId === 'string')
      : record(definition.body.prerequisites) && Array.isArray(definition.body.prerequisites.ids)
        ? definition.body.prerequisites.ids.filter((traitId): traitId is string => typeof traitId === 'string')
        : [];
    const prerequisiteMode = record(definition.body.prerequisites) && definition.body.prerequisites.mode === 'all'
      ? 'all'
      : 'any';
    if (prerequisiteMode === 'all' || prerequisites.length === 1) {
      for (const traitId of prerequisites) {
        edges.push({ fromTraitId: definition.externalId, toTraitId: traitId, kind: 'requires' });
      }
    }
    if (!Array.isArray(definition.body.grants)) continue;
    for (const value of definition.body.grants) {
      if (!record(value) || value.dataType !== 'trait' || typeof value.ref !== 'string') continue;
      const path = typeof value.into === 'string'
        ? `${value.into}[]`
        : typeof value.at === 'string'
          ? value.at
          : typeof value.key === 'string'
            ? `this.${value.key}`
            : undefined;
      edges.push({
        fromTraitId: definition.externalId,
        toTraitId: value.ref,
        kind: 'adds',
        ...(path ? { path } : {}),
        ...(typeof value.into === 'string' && Number.isInteger(value.count) && Number(value.count) > 1
          ? { count: Number(value.count) }
          : {}),
      });
    }
  }
  const unique = new Map<string, CompiledTraitActivationEdge>();
  for (const edge of edges) {
    const key = `${edge.fromTraitId}\0${edge.toTraitId}\0${edge.kind}\0${edge.path ?? ''}`;
    const existing = unique.get(key);
    if (existing && edge.kind === 'adds') {
      const count = (existing.count ?? 1) + (edge.count ?? 1);
      unique.set(key, { ...existing, count });
    } else if (!existing) {
      unique.set(key, edge);
    }
  }
  return [...unique.values()].sort((left, right) =>
    left.fromTraitId.localeCompare(right.fromTraitId)
    || left.toTraitId.localeCompare(right.toTraitId)
    || left.kind.localeCompare(right.kind)
    || (left.path ?? '').localeCompare(right.path ?? '')
    || (left.count ?? 1) - (right.count ?? 1));
}

function compileActivationChoices(inputs: TraitCompositionSourceDefinition[]): CompiledTraitActivationChoice[] {
  return inputs.flatMap((definition) => {
    const prerequisites = Array.isArray(definition.body.prerequisites)
      ? definition.body.prerequisites.filter((traitId): traitId is string => typeof traitId === 'string')
      : record(definition.body.prerequisites) && Array.isArray(definition.body.prerequisites.ids)
        ? definition.body.prerequisites.ids.filter((traitId): traitId is string => typeof traitId === 'string')
        : [];
    const prerequisiteMode = record(definition.body.prerequisites) && definition.body.prerequisites.mode === 'all'
      ? 'all'
      : 'any';
    return prerequisiteMode === 'any' && prerequisites.length > 1
      ? [{ traitId: definition.externalId, optionTraitIds: [...new Set(prerequisites)].sort() }]
      : [];
  }).sort((left, right) => left.traitId.localeCompare(right.traitId));
}

function compileStructuralDirectives(
  inputs: TraitCompositionSourceDefinition[],
  diagnostics: TraitCompositionDiagnostic[],
): CompiledTraitStructuralDirective[] {
  const knownTraitIds = new Set(inputs.map((definition) => definition.externalId));
  const directives: CompiledTraitStructuralDirective[] = [];
  inputs.forEach((definition, definitionIndex) => {
    if (!Array.isArray(definition.body.grants)) return;
    const shape = buildTraitShape({
      definitions: inputs,
      prerequisiteIds: [definition.externalId],
      prerequisiteMode: 'all',
    });
    definition.body.grants.forEach((value, grantIndex) => {
      if (!record(value)
        || (value.dataType !== 'suppression' && value.dataType !== 'replacement')
        || typeof value.target !== 'string'
        || !Number.isInteger(value.priority)) return;
      const path = normalizedModifierPath(value.target);
      const repeatedIndex = path.findIndex((segment) => segment.endsWith('[]'));
      const targetPath = repeatedIndex < 0
        ? path
        : path.map((segment) => segment.replace(/\[\]$/, ''));
      const target = shape.nodes.find((node) => node.path.join('.') === targetPath.join('.'));
      const diagnosticPath = `${definitionPath(definition, definitionIndex)}.body.grants[${grantIndex}]`;
      const validTarget = repeatedIndex < 0
        ? target?.kind === 'branch'
        : repeatedIndex === path.length - 1 && target?.kind === 'collection';
      if (!validTarget) {
        diagnostic(
          diagnostics,
          'RULE_TRAIT_STRUCTURAL_TARGET_INVALID',
          `${diagnosticPath}.target`,
          `Structural target '${value.target}' must resolve to a guaranteed trait branch or selected collection entry.`,
        );
        return;
      }
      if (value.dataType === 'replacement'
        && (typeof value.ref !== 'string' || !knownTraitIds.has(value.ref))) {
        diagnostic(
          diagnostics,
          'RULE_TRAIT_REPLACEMENT_REFERENCE_MISSING',
          `${diagnosticPath}.ref`,
          `Replacement trait '${String(value.ref)}' is not in the compilation set.`,
        );
        return;
      }
      if (value.dataType === 'replacement'
        && target?.kind === 'collection'
        && typeof value.ref === 'string'
        && !traitSatisfiesCollection(
          value.ref,
          target.acceptedTraitIds,
          target.acceptsMode,
          inputs,
        )) {
        diagnostic(
          diagnostics,
          'RULE_TRAIT_REPLACEMENT_COLLECTION_TYPE_MISMATCH',
          `${diagnosticPath}.ref`,
          `Replacement trait '${value.ref}' does not satisfy the collection contract at '${value.target}'.`,
        );
        return;
      }
      directives.push({
        sourceTraitId: definition.externalId,
        kind: value.dataType,
        anchor: modifierAnchor(value.target),
        path,
        priority: Number(value.priority),
        ...(value.dataType === 'replacement' ? { replacementTraitId: value.ref as string } : {}),
        ...compiledMountSelectors(value),
      });
    });
  });
  return directives.sort((left, right) =>
    left.sourceTraitId.localeCompare(right.sourceTraitId)
    || left.path.join('.').localeCompare(right.path.join('.'))
    || left.priority - right.priority
    || left.kind.localeCompare(right.kind)
    || [
      mountSelectorKey(left.mountSelector),
      ...(left.mountSelectors ?? []).map(mountSelectorKey),
    ].join('|').localeCompare([
      mountSelectorKey(right.mountSelector),
      ...(right.mountSelectors ?? []).map(mountSelectorKey),
    ].join('|'))
    || (left.replacementTraitId ?? '').localeCompare(right.replacementTraitId ?? ''));
}

function cloneTraitNode(node: TraitShapeNode): TraitShapeNode {
  return node.kind === 'collection'
    ? {
      ...node,
      path: [...node.path],
      acceptedTraitIds: [...node.acceptedTraitIds],
      entries: node.entries.map((entry) => ({ ...entry })),
    }
    : {
      ...node,
      path: [...node.path],
      ...(node.sourceTraitIds ? { sourceTraitIds: [...node.sourceTraitIds] } : {}),
      ...(node.kind === 'terminal' && node.allowedValues
        ? { allowedValues: [...node.allowedValues] }
        : {}),
    };
}

function rewriteGuaranteedContracts(
  contracts: CompiledTraitContract[],
  directives: CompiledTraitStructuralDirective[],
  activationEdges: CompiledTraitActivationEdge[],
  activationChoices: CompiledTraitActivationChoice[],
  diagnostics: TraitCompositionDiagnostic[],
): CompiledTraitContract[] {
  const contractsById = new Map(contracts.map((contract) => [contract.traitId, contract]));
  const edgesBySource = new Map<string, CompiledTraitActivationEdge[]>();
  for (const edge of activationEdges) {
    const grouped = edgesBySource.get(edge.fromTraitId) ?? [];
    grouped.push(edge);
    edgesBySource.set(edge.fromTraitId, grouped);
  }
  const choiceTraits = new Set(activationChoices.map((choice) => choice.traitId));
  const cache = new Map<string, TraitShapeNode[]>();
  const effectiveNodes = (rootTraitId: string, ancestors: string[] = []): TraitShapeNode[] => {
    const cached = cache.get(rootTraitId);
    if (cached) return cached.map(cloneTraitNode);
    if (ancestors.includes(rootTraitId)) {
      diagnostic(
        diagnostics,
        'RULE_TRAIT_STRUCTURAL_REPLACEMENT_CYCLE',
        `traits[${JSON.stringify(rootTraitId)}].structuralDirectives`,
        `Structural replacement cycle detected: ${[...ancestors, rootTraitId].join(' → ')}.`,
      );
      return [];
    }
    const contract = contractsById.get(rootTraitId);
    if (!contract) return [];
    let nodes = contract.nodes.map(cloneTraitNode);
    const sourceMounts: Array<{ traitId: string; mountPath: string[]; chain: string[] }> = [{
      traitId: rootTraitId,
      mountPath: [],
      chain: [rootTraitId],
    }];
    for (let index = 0; index < sourceMounts.length; index += 1) {
      const current = sourceMounts[index];
      if (choiceTraits.has(current.traitId)) continue;
      for (const edge of edgesBySource.get(current.traitId) ?? []) {
        if (current.chain.includes(edge.toTraitId)) continue;
        const segments = (edge.path ?? '').split('.').map((segment) => segment.trim()).filter(Boolean);
        const anchor = segments[0];
        const relative = (anchor === 'self' || anchor === 'this' ? segments.slice(1) : segments)
          .map((segment) => segment.replace(/\[\]$/, ''));
        const mountPath = edge.kind === 'requires'
          ? current.mountPath
          : anchor === 'self'
            ? relative
            : [...current.mountPath, ...relative];
        sourceMounts.push({
          traitId: edge.toTraitId,
          mountPath,
          chain: [...current.chain, edge.toTraitId],
        });
      }
    }
    const applications = sourceMounts.flatMap((source) =>
      directives
        .filter((directive) => directive.sourceTraitId === source.traitId)
        .map((directive) => ({
          directive,
          targetPath: [
            ...(directive.anchor === 'this' ? source.mountPath : []),
            ...directive.path.map((segment) => segment.replace(/\[\]$/, '')),
          ],
        })))
      .sort((left, right) =>
        left.targetPath.length - right.targetPath.length
        || left.targetPath.join('.').localeCompare(right.targetPath.join('.'))
        || right.directive.priority - left.directive.priority);
    const grouped = new Map<string, typeof applications>();
    for (const application of applications) {
      const key = application.targetPath.join('\0');
      const candidates = grouped.get(key) ?? [];
      candidates.push(application);
      grouped.set(key, candidates);
    }
    for (const candidates of grouped.values()) {
      const targetPath = candidates[0].targetPath;
      const priority = Math.max(...candidates.map(({ directive }) => directive.priority));
      const winners = candidates.filter(({ directive }) => directive.priority === priority);
      const kinds = new Set(winners.map(({ directive }) => directive.kind));
      const replacements = new Set(winners.map(({ directive }) => directive.replacementTraitId ?? ''));
      if (kinds.size !== 1
        || (winners[0].directive.kind === 'replacement' && replacements.size !== 1)) {
        diagnostic(
          diagnostics,
          'RULE_TRAIT_STRUCTURAL_DIRECTIVE_CONFLICT',
          `traits[${JSON.stringify(rootTraitId)}].${targetPath.join('.')}`,
          `Equal-priority structural directives conflict at '${targetPath.join('.')}'.`,
        );
        continue;
      }
      const winner = winners[0].directive;
      const targetIndex = nodes.findIndex((node) => node.path.join('\0') === targetPath.join('\0'));
      if (targetIndex < 0) continue;
      const target = nodes[targetIndex];
      const collectionSelector = winner.mountSelectors?.at(-1) ?? winner.mountSelector;
      if (collectionSelector && target.kind === 'collection') {
        const expandedEntries = target.entries.flatMap((entry) =>
          Array.from({ length: entry.count }, () => ({ ...entry, count: 1 })));
        const selected = collectionSelector.mode === 'all'
          ? expandedEntries.map((_, index) => index)
          : collectionSelector.mode === 'ordinal'
            ? [collectionSelector.ordinal - 1].filter((index) => index < expandedEntries.length)
            : collectionSelector.mode === 'trait'
              ? expandedEntries.flatMap((entry, index) =>
                entry.traitId === collectionSelector.traitId ? [index] : [])
              : expandedEntries.flatMap((entry, index) =>
                contractsById.get(entry.traitId)?.tags.includes(collectionSelector.tag) ? [index] : []);
        for (const index of selected) {
          if (winner.kind === 'suppression') {
            expandedEntries[index] = { ...expandedEntries[index], count: 0 };
          } else {
            expandedEntries[index] = {
              traitId: winner.replacementTraitId!,
              count: 1,
              sourceTraitId: winner.replacementTraitId!,
            };
          }
        }
        const rebuilt = new Map<string, (typeof target.entries)[number]>();
        for (const entry of expandedEntries.filter((entry) => entry.count > 0)) {
          const key = `${entry.traitId}\0${entry.sourceTraitId ?? ''}`;
          const existing = rebuilt.get(key);
          if (existing) existing.count += 1;
          else rebuilt.set(key, { ...entry });
        }
        nodes[targetIndex] = { ...target, entries: [...rebuilt.values()] };
        continue;
      }
      if (target.kind !== 'branch') continue;
      nodes = nodes.filter((node) =>
        !targetPath.every((segment, index) => node.path[index] === segment));
      if (winner.kind === 'replacement') {
        const replacementTraitId = winner.replacementTraitId!;
        const replacement = contractsById.get(replacementTraitId);
        if (!replacement) continue;
        nodes.push({
          kind: 'branch',
          path: targetPath,
          label: replacement.name,
          traitId: replacementTraitId,
          sourceTraitId: replacementTraitId,
        });
        nodes.push(...effectiveNodes(replacementTraitId, [...ancestors, rootTraitId]).map((node) => ({
          ...cloneTraitNode(node),
          path: [...targetPath, ...node.path],
        })));
      }
    }
    nodes.sort((left, right) => left.path.join('.').localeCompare(right.path.join('.')));
    cache.set(rootTraitId, nodes.map(cloneTraitNode));
    return nodes;
  };
  return contracts.map((contract) => ({
    ...contract,
    nodes: effectiveNodes(contract.traitId),
  }));
}

function compileModifiers(
  definition: TraitCompositionSourceDefinition,
  definitionIndex: number,
  shape: TraitShape,
  inputs: TraitCompositionSourceDefinition[],
  diagnostics: TraitCompositionDiagnostic[],
): CompiledTraitModifier[] {
  if (!Array.isArray(definition.body.grants)) return [];
  return definition.body.grants.flatMap((value, grantIndex) => {
    if (!record(value) || value.dataType !== 'modifier'
      || typeof value.field !== 'string'
      || !MODIFIER_OPERATIONS.includes(value.operation as typeof MODIFIER_OPERATIONS[number])
      || !('amount' in value)) return [];
    const path = normalizedModifierPath(value.field);
    const terminal = resolveModifierTerminal(shape, path, inputs);
    const diagnosticPath = `${definitionPath(definition, definitionIndex)}.body.grants[${grantIndex}]`;
    if (!terminal) {
      diagnostic(
        diagnostics,
        'RULE_TRAIT_MODIFIER_TARGET_INVALID',
        `${diagnosticPath}.field`,
        `Modifier target '${value.field}' is not a terminal field in '${definition.name}'.`,
      );
      return [];
    }
    const operation = value.operation as typeof MODIFIER_OPERATIONS[number];
    if (operation !== 'sets' && terminal.dataType !== 'number') {
      diagnostic(
        diagnostics,
        'RULE_TRAIT_MODIFIER_TYPE_INVALID',
        `${diagnosticPath}.operation`,
        `${operation} requires a numeric target; '${value.field}' is ${terminal.dataType}.`,
      );
      return [];
    }
    const authoredAmount = value.amount;
    const numericAmount = record(authoredAmount)
      && typeof authoredAmount.value === 'number'
      && Number.isFinite(authoredAmount.value)
      && isCanonicalUnitId(authoredAmount.unit)
      ? { value: authoredAmount.value, unit: authoredAmount.unit }
      : null;
    const amountIsValid = terminal.dataType === 'number'
      ? (typeof authoredAmount === 'number' && Number.isFinite(authoredAmount)) || numericAmount !== null
      : terminal.dataType === 'boolean'
        ? typeof authoredAmount === 'boolean'
        : typeof authoredAmount === 'string';
    if (!amountIsValid) {
      diagnostic(
        diagnostics,
        'RULE_TRAIT_MODIFIER_AMOUNT_INVALID',
        `${diagnosticPath}.amount`,
        `Modifier amount must match the ${terminal.dataType} target '${value.field}'.`,
      );
      return [];
    }
    const targetUnit: CanonicalUnitId = terminal.unit ?? '1';
    const expectsScalar = operation === 'multiplies' || operation === 'divides';
    const sourceUnit = numericAmount?.unit ?? (expectsScalar ? '1' : targetUnit);
    if (terminal.dataType === 'number' && (
      expectsScalar
        ? sourceUnit !== '1'
        : !unitsAreCompatible(sourceUnit, targetUnit)
    )) {
      diagnostic(
        diagnostics,
        'RULE_TRAIT_MODIFIER_UNIT_INCOMPATIBLE',
        `${diagnosticPath}.amount`,
        expectsScalar
          ? `${operation} requires a dimensionless amount.`
          : `Unit '${sourceUnit}' is incompatible with target unit '${targetUnit}'.`,
      );
      return [];
    }
    const amount = terminal.dataType === 'number'
      ? expectsScalar
        ? numericAmount?.value ?? authoredAmount as number
        : convertUnitValue(numericAmount?.value ?? authoredAmount as number, sourceUnit, targetUnit)!
      : authoredAmount;
    let compiledCondition: CompiledTraitModifier['condition'];
    if (record(value.when)
      && ['equals', 'gte', 'lte'].includes(String(value.when.operator))
      && 'value' in value.when) {
      const authoredCondition = value.when.value;
      const numericCondition = record(authoredCondition)
        && typeof authoredCondition.value === 'number'
        && Number.isFinite(authoredCondition.value)
        && isCanonicalUnitId(authoredCondition.unit)
        ? { value: authoredCondition.value, unit: authoredCondition.unit }
        : null;
      const conditionValueValid = terminal.dataType === 'number'
        ? (typeof authoredCondition === 'number' && Number.isFinite(authoredCondition)) || numericCondition !== null
        : terminal.dataType === 'boolean'
          ? typeof authoredCondition === 'boolean'
          : typeof authoredCondition === 'string';
      const conditionSourceUnit = numericCondition?.unit ?? targetUnit;
      if (!conditionValueValid
        || (terminal.dataType === 'number' && !unitsAreCompatible(conditionSourceUnit, targetUnit))
        || (terminal.dataType !== 'number' && value.when.operator !== 'equals')
        || (terminal.dataType === 'enum' && terminal.allowedValues?.length
          && !terminal.allowedValues.includes(String(authoredCondition)))) {
        diagnostic(
          diagnostics,
          'RULE_TRAIT_MODIFIER_CONDITION_VALUE_INVALID',
          `${diagnosticPath}.when.value`,
          `Condition value must be compatible with the ${terminal.dataType} target '${value.field}'.`,
        );
        return [];
      }
      const conditionValue = terminal.dataType === 'number'
        ? convertUnitValue(
          numericCondition?.value ?? authoredCondition as number,
          conditionSourceUnit,
          targetUnit,
        )!
        : authoredCondition as string | boolean;
      compiledCondition = {
        operator: value.when.operator as 'equals' | 'gte' | 'lte',
        value: conditionValue,
        ...(terminal.dataType === 'number'
          ? {
            authoredValue: {
              value: numericCondition?.value ?? authoredCondition as number,
              unit: conditionSourceUnit,
            },
            normalizedValue: { value: conditionValue as number, unit: targetUnit },
          }
          : {}),
      };
    }
    if (operation === 'divides' && amount === 0) {
      diagnostic(
        diagnostics,
        'RULE_TRAIT_MODIFIER_AMOUNT_INVALID',
        `${diagnosticPath}.amount`,
        `Division modifier target '${value.field}' cannot use zero.`,
      );
      return [];
    }
    if (terminal.dataType === 'enum' && terminal.allowedValues?.length
      && !terminal.allowedValues.includes(String(amount))) {
      diagnostic(
        diagnostics,
        'RULE_TRAIT_MODIFIER_AMOUNT_INVALID',
        `${diagnosticPath}.amount`,
        `Modifier amount must be one of: ${terminal.allowedValues.join(', ')}.`,
      );
      return [];
    }
    return [{
      sourceTraitId: definition.externalId,
      anchor: modifierAnchor(value.field),
      operation,
      path,
      amount: amount as string | number | boolean,
      ...(typeof value.priority === 'number' && value.priority !== 0 ? { priority: value.priority } : {}),
      ...(compiledCondition ? { condition: compiledCondition } : {}),
      ...(terminal.dataType === 'number'
        ? {
          authoredAmount: {
            value: numericAmount?.value ?? authoredAmount as number,
            unit: sourceUnit,
          },
          normalizedAmount: {
            value: amount as number,
            unit: expectsScalar ? '1' as const : targetUnit,
          },
          targetUnit,
        }
        : {}),
      ...compiledMountSelectors(value),
    }];
  });
}

export function compileTraitCompositions(inputs: TraitCompositionSourceDefinition[]): TraitCompositionCompilationResult {
  const diagnostics: TraitCompositionDiagnostic[] = [];
  if (inputs.length > MAXIMUM_DEFINITIONS) {
    diagnostic(
      diagnostics,
      'RULE_TRAIT_DEFINITION_LIMIT',
      'definitions',
      `Trait compilation accepts at most ${MAXIMUM_DEFINITIONS} definitions.`,
    );
    return { valid: false, diagnostics };
  }
  inputs.forEach((definition, index) => validateDefinitionShape(definition, index, diagnostics));
  const definitionIndexById = new Map<string, number>();
  inputs.forEach((definition, index) => {
    const existingIndex = definitionIndexById.get(definition.externalId);
    if (existingIndex !== undefined) {
      diagnostic(
        diagnostics,
        'RULE_TRAIT_ID_DUPLICATE',
        `${definitionPath(definition, index)}.externalId`,
        `Trait ID '${definition.externalId}' duplicates ${definitionPath(inputs[existingIndex], existingIndex)}.`,
      );
    } else {
      definitionIndexById.set(definition.externalId, index);
    }
  });
  if (diagnostics.some((item) => item.severity === 'error')) {
    contextualizeDiagnostics(diagnostics, inputs);
    return { valid: false, diagnostics };
  }

  const contracts = inputs.map((definition, index) => {
    const shape = buildTraitShape({
      definitions: inputs,
      prerequisiteIds: [definition.externalId],
      prerequisiteMode: 'all',
    });
    for (const item of shape.diagnostics) {
      diagnostic(
        diagnostics,
        `RULE_TRAIT_${item.code.replace(/-/g, '_').toUpperCase()}`,
        `${definitionPath(definition, index)}.effectiveShape.${item.path.length ? `self.${item.path.join('.')}` : 'self'}`,
        item.message,
      );
    }
    return {
      traitId: definition.externalId,
      name: definition.name,
      nodes: shape.nodes,
      modifiers: compileModifiers(definition, index, shape, inputs, diagnostics),
      tags: [...new Set(definition.tags ?? [])].sort(),
    };
  });

  const knownIds = new Set(inputs.map((definition) => definition.externalId));
  inputs.forEach((definition, definitionIndex) => {
    if (!Array.isArray(definition.body.grants)) return;
    definition.body.grants.forEach((grant, grantIndex) => {
      if (!record(grant)
        || (grant.dataType !== 'trait-collection' && grant.dataType !== 'slot')
        || !Array.isArray(grant.acceptedTraits)) return;
      grant.acceptedTraits.forEach((traitId, acceptedIndex) => {
        if (typeof traitId === 'string' && !knownIds.has(traitId)) {
          diagnostic(
            diagnostics,
            'RULE_TRAIT_REFERENCE_MISSING',
            `${definitionPath(definition, definitionIndex)}.body.grants[${grantIndex}].acceptedTraits[${acceptedIndex}]`,
            `Accepted base trait '${traitId}' is not in the compilation set.`,
          );
        }
      });
    });
  });

  const structuralDirectives = compileStructuralDirectives(inputs, diagnostics);
  const activationEdges = compileActivationEdges(inputs);
  const activationChoices = compileActivationChoices(inputs);
  const rewrittenContracts = rewriteGuaranteedContracts(
    contracts,
    structuralDirectives,
    activationEdges,
    activationChoices,
    diagnostics,
  );
  contextualizeDiagnostics(diagnostics, inputs);
  const valid = !diagnostics.some((item) => item.severity === 'error');
  if (!valid) return { valid, diagnostics };
  const normalizedContracts = [...rewrittenContracts].sort((left, right) => left.traitId.localeCompare(right.traitId));
  return {
    valid: true,
    diagnostics,
    artifact: {
      artifactVersion: TRAIT_COMPOSITION_ARTIFACT_VERSION,
      metamodelVersion: TRAIT_COMPOSITION_METAMODEL_VERSION,
      sourceHash: createHash('sha256').update(canonical(
        [...inputs].sort((left, right) => left.externalId.localeCompare(right.externalId)),
      )).digest('hex'),
      traits: normalizedContracts,
      activationEdges,
      activationChoices,
      structuralDirectives,
    },
  };
}
