export type GuidedExpressionSource =
  | 'literal'
  | 'actor-field'
  | 'target-field'
  | 'trait-path-field'
  | 'trait-instance-field'
  | 'input'
  | 'result';

export type GuidedMountSelectorDraft =
  | { mode: 'ordinal'; ordinal: number }
  | { mode: 'trait'; traitId: string }
  | { mode: 'tag'; tag: string };

export type GuidedScalarExpressionDraft = {
  source: GuidedExpressionSource;
  literalValue: number;
  key: string;
  instanceId: string;
  traitPath: string;
  mountSelectors: GuidedMountSelectorDraft[];
  /** @deprecated retained while one-selector drafts are migrated */
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
    mountSelectors: [],
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
      const repeatedCount = expression.traitPath.split('.')
        .filter((segment) => segment.endsWith('[]')).length;
      const mountSelectors = Array.from({ length: repeatedCount }, (_, index) =>
        expression.mountSelectors[index]
        ?? { mode: 'ordinal' as const, ordinal: index === 0 ? expression.mountOrdinal : 1 });
      return {
        op: expression.source,
        path: expression.traitPath,
        ...(repeatedCount === 1
          ? { mountSelector: mountSelectors[0] }
          : repeatedCount > 1
            ? { mountSelectors }
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
  const authoredSelectors = Array.isArray(value.mountSelectors)
    ? value.mountSelectors
    : selector.mode === 'trait' || selector.mode === 'tag'
      ? [selector]
      : [];
  const mountSelectors = authoredSelectors.flatMap((item): GuidedMountSelectorDraft[] => {
    if (!record(item)) return [];
    if (item.mode === 'ordinal' && Number.isInteger(item.ordinal) && Number(item.ordinal) > 0) {
      return [{ mode: 'ordinal', ordinal: Number(item.ordinal) }];
    }
    if (item.mode === 'trait' && typeof item.traitId === 'string') {
      return [{ mode: 'trait', traitId: item.traitId }];
    }
    if (item.mode === 'tag' && typeof item.tag === 'string') {
      return [{ mode: 'tag', tag: item.tag }];
    }
    return [];
  });
  return defaultGuidedScalarExpression(source as GuidedExpressionSource, {
    literalValue: typeof value.value === 'number' && Number.isFinite(value.value)
      ? value.value
      : fallback.literalValue,
    key: typeof value.key === 'string' ? value.key : fallback.key,
    instanceId: typeof value.instanceId === 'string' ? value.instanceId : fallback.instanceId,
    traitPath: typeof value.path === 'string' ? value.path : fallback.traitPath,
    mountSelectors,
    mountOrdinal: selector.mode === 'ordinal' && Number.isInteger(selector.ordinal)
      ? Number(selector.ordinal)
      : fallback.mountOrdinal,
    resultProperty: typeof value.property === 'string' ? value.property : fallback.resultProperty,
  });
}
