export type GuidedExpressionSource =
  | 'literal'
  | 'actor-field'
  | 'target-field'
  | 'trait-path-field'
  | 'trait-instance-field'
  | 'input'
  | 'result';

export type GuidedScalarExpressionDraft = {
  source: GuidedExpressionSource;
  literalValue: number;
  key: string;
  instanceId: string;
  traitPath: string;
  mountOrdinal: number;
  resultProperty: string;
};

export function defaultGuidedScalarExpression(
  source: GuidedExpressionSource = 'literal',
  values: Partial<GuidedScalarExpressionDraft> = {},
): GuidedScalarExpressionDraft {
  return {
    source,
    literalValue: 0,
    key: '',
    instanceId: '',
    traitPath: '',
    mountOrdinal: 1,
    resultProperty: 'total',
    ...values,
  };
}

export function buildGuidedScalarExpression(expression: GuidedScalarExpressionDraft): Record<string, unknown> {
  switch (expression.source) {
    case 'literal':
      return { op: 'literal', value: expression.literalValue };
    case 'actor-field':
    case 'target-field':
    case 'input':
      return { op: expression.source, key: expression.key };
    case 'trait-instance-field':
      return { op: expression.source, instanceId: expression.instanceId, key: expression.key };
    case 'trait-path-field':
      return {
        op: expression.source,
        path: expression.traitPath,
        ...(expression.traitPath.includes('[]')
          ? { mountSelector: { mode: 'ordinal', ordinal: expression.mountOrdinal } }
          : {}),
      };
    case 'result':
      return { op: expression.source, key: expression.key, property: expression.resultProperty };
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseGuidedScalarExpression(
  value: unknown,
  fallback: GuidedScalarExpressionDraft = defaultGuidedScalarExpression(),
): GuidedScalarExpressionDraft {
  if (!record(value)) return fallback;
  const source = value.op;
  if (![
    'literal',
    'actor-field',
    'target-field',
    'trait-path-field',
    'trait-instance-field',
    'input',
    'result',
  ].includes(String(source))) return fallback;
  const selector = record(value.mountSelector) ? value.mountSelector : {};
  return defaultGuidedScalarExpression(source as GuidedExpressionSource, {
    literalValue: typeof value.value === 'number' && Number.isFinite(value.value)
      ? value.value
      : fallback.literalValue,
    key: typeof value.key === 'string' ? value.key : fallback.key,
    instanceId: typeof value.instanceId === 'string' ? value.instanceId : fallback.instanceId,
    traitPath: typeof value.path === 'string' ? value.path : fallback.traitPath,
    mountOrdinal: selector.mode === 'ordinal' && Number.isInteger(selector.ordinal)
      ? Number(selector.ordinal)
      : fallback.mountOrdinal,
    resultProperty: typeof value.property === 'string' ? value.property : fallback.resultProperty,
  });
}
