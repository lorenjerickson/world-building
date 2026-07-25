import { createHash } from 'crypto';
import {
  buildTraitShape,
  resolveTraitShapeTerminal,
  type TraitGrantDataType,
  type TraitShape,
} from '@world-building/common';
import {
  TRAIT_COMPOSITION_ARTIFACT_VERSION,
  TRAIT_COMPOSITION_METAMODEL_VERSION,
  LEGACY_TRAIT_COMPOSITION_METAMODEL_VERSION,
  type CompiledTraitActivationEdge,
  type CompiledTraitActivationChoice,
  type CompiledTraitModifier,
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
  'slot',
  'slot-affinity',
];
const MODIFIER_OPERATIONS = ['increases', 'decreases', 'multiplies', 'divides', 'sets'] as const;
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
  }
  if (dataType === 'modifier') {
    if (!MODIFIER_OPERATIONS.includes(grant.operation as typeof MODIFIER_OPERATIONS[number])) {
      diagnostic(diagnostics, 'RULE_TRAIT_MODIFIER_OPERATION_INVALID', `${path}.operation`, 'Modifier operation is unsupported.');
    }
    if (typeof grant.field !== 'string' || !grant.field.trim()) {
      diagnostic(diagnostics, 'RULE_TRAIT_MODIFIER_PATH_REQUIRED', `${path}.field`, 'A modifier requires an exact target path.');
    }
    if (!('amount' in grant)) {
      diagnostic(diagnostics, 'RULE_TRAIT_MODIFIER_AMOUNT_REQUIRED', `${path}.amount`, 'A modifier amount is required.');
    }
    const repeatedPath = typeof grant.field === 'string' && grant.field.split('.').some((segment) => segment.endsWith('[]'));
    if (repeatedPath && !record(grant.mountSelector)) {
      diagnostic(diagnostics, 'RULE_TRAIT_MODIFIER_SELECTOR_REQUIRED', `${path}.mountSelector`, 'A repeated mount path requires an all or ordinal selector.');
    } else if (!repeatedPath && grant.mountSelector !== undefined) {
      diagnostic(diagnostics, 'RULE_TRAIT_MODIFIER_SELECTOR_UNUSED', `${path}.mountSelector`, 'Mount selectors require a repeated [] path segment.');
    } else if (record(grant.mountSelector)) {
      if (grant.mountSelector.mode !== 'all' && grant.mountSelector.mode !== 'ordinal') {
        diagnostic(diagnostics, 'RULE_TRAIT_MODIFIER_SELECTOR_INVALID', `${path}.mountSelector.mode`, "Mount selector mode must be 'all' or 'ordinal'.");
      }
      if (grant.mountSelector.mode === 'ordinal'
        && (!Number.isInteger(grant.mountSelector.ordinal) || Number(grant.mountSelector.ordinal) < 1)) {
        diagnostic(diagnostics, 'RULE_TRAIT_MODIFIER_SELECTOR_INVALID', `${path}.mountSelector.ordinal`, 'Ordinal mount selectors require a positive whole number.');
      }
    }
  }
}

function validateDefinitionShape(
  definition: TraitCompositionSourceDefinition,
  index: number,
  diagnostics: TraitCompositionDiagnostic[],
): void {
  const path = `definitions[${index}]`;
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
  const repeatedIndex = path.findIndex((segment) => segment.endsWith('[]'));
  if (repeatedIndex < 0) return resolveTraitShapeTerminal(shape, path);
  if (path.filter((segment) => segment.endsWith('[]')).length !== 1) return undefined;
  const collectionPath = [
    ...path.slice(0, repeatedIndex),
    path[repeatedIndex].replace(/\[\]$/, ''),
  ];
  const collection = shape.nodes.find((node) =>
    node.kind === 'collection' && node.path.join('.') === collectionPath.join('.'));
  if (!collection || collection.kind !== 'collection' || !collection.acceptedTraitIds.length) return undefined;
  if (path.slice(repeatedIndex + 1).length !== 1) return undefined;
  const elementShape = buildTraitShape({
    definitions: inputs,
    prerequisiteIds: collection.acceptedTraitIds,
    prerequisiteMode: collection.acceptsMode,
  });
  return resolveTraitShapeTerminal(elementShape, path.slice(repeatedIndex + 1));
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
    const diagnosticPath = `definitions[${definitionIndex}].body.grants[${grantIndex}]`;
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
    const amount = value.amount;
    const amountIsValid = terminal.dataType === 'number'
      ? typeof amount === 'number' && Number.isFinite(amount)
      : terminal.dataType === 'boolean'
        ? typeof amount === 'boolean'
        : typeof amount === 'string';
    if (!amountIsValid) {
      diagnostic(
        diagnostics,
        'RULE_TRAIT_MODIFIER_AMOUNT_INVALID',
        `${diagnosticPath}.amount`,
        `Modifier amount must match the ${terminal.dataType} target '${value.field}'.`,
      );
      return [];
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
      ...(record(value.mountSelector) && value.mountSelector.mode === 'all'
        ? { mountSelector: { mode: 'all' as const } }
        : record(value.mountSelector) && value.mountSelector.mode === 'ordinal'
          ? { mountSelector: { mode: 'ordinal' as const, ordinal: Number(value.mountSelector.ordinal) } }
          : {}),
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
        `definitions[${index}].externalId`,
        `Trait ID '${definition.externalId}' duplicates definitions[${existingIndex}].`,
      );
    } else {
      definitionIndexById.set(definition.externalId, index);
    }
  });
  if (diagnostics.some((item) => item.severity === 'error')) return { valid: false, diagnostics };

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
        `definitions[${index}].effectiveShape.${item.path.length ? `self.${item.path.join('.')}` : 'self'}`,
        item.message,
      );
    }
    return {
      traitId: definition.externalId,
      name: definition.name,
      nodes: shape.nodes,
      modifiers: compileModifiers(definition, index, shape, inputs, diagnostics),
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
            `definitions[${definitionIndex}].body.grants[${grantIndex}].acceptedTraits[${acceptedIndex}]`,
            `Accepted base trait '${traitId}' is not in the compilation set.`,
          );
        }
      });
    });
  });

  const valid = !diagnostics.some((item) => item.severity === 'error');
  if (!valid) return { valid, diagnostics };
  const normalizedContracts = [...contracts].sort((left, right) => left.traitId.localeCompare(right.traitId));
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
      activationEdges: compileActivationEdges(inputs),
      activationChoices: compileActivationChoices(inputs),
    },
  };
}
