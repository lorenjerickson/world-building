export type AuthoringDiagnostic = {
  code: string;
  message: string;
  path: string;
  severity: 'error' | 'warning';
};

export type RuleAuthoringValidation = {
  valid: boolean;
  diagnostics: AuthoringDiagnostic[];
  compiled?: {
    artifactVersion: string;
    metamodelVersion: string;
    sourceHash: string;
  };
};

export type RuleAuthoringMetamodel = {
  metamodelVersion: string;
  definitionTypes: string[];
  valueTypes: string[];
  units: string[];
  expressionOperators: string[];
  conditionOperators: string[];
};

export type DefinitionDescriptor = {
  definitionType: string;
  label: string;
  help: string;
  fields: Array<{
    fieldId: string;
    path: string;
    label: string;
    control: string;
    required: boolean;
  }>;
  semanticFrames?: Array<{ frameId: string; sentence: string }>;
};

async function readAuthoringResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { message?: string };
  if (!response.ok) throw new Error(body.message || 'The rule-authoring service could not complete the request.');
  return body;
}

export async function getRuleAuthoringMetamodel(signal?: AbortSignal): Promise<RuleAuthoringMetamodel> {
  const response = await fetch('/api/rule-authoring/metamodel', { signal });
  return readAuthoringResponse<RuleAuthoringMetamodel>(response);
}

export async function getRuleDefinitionDescriptor(type: string, signal?: AbortSignal): Promise<DefinitionDescriptor> {
  const response = await fetch(`/api/rule-authoring/definition-types/${encodeURIComponent(type)}/descriptor`, { signal });
  return readAuthoringResponse<DefinitionDescriptor>(response);
}

export async function validateRuleAuthoringDefinitions(definitions: Record<string, unknown>[]): Promise<RuleAuthoringValidation> {
  const response = await fetch('/api/rule-authoring/validate', {
    body: JSON.stringify({ definitions }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  return readAuthoringResponse<RuleAuthoringValidation>(response);
}

export async function previewRuleOperation(input: {
  definitions: Record<string, unknown>[];
  operationId: string;
  context: Record<string, unknown>;
}): Promise<{ valid: boolean; diagnostics: AuthoringDiagnostic[]; preview?: { outcome: string; trace: Array<{ stepId: string; kind: string; message: string; values?: Record<string, unknown> }> } }> {
  const response = await fetch('/api/rule-authoring/preview', {
    body: JSON.stringify(input),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  return readAuthoringResponse(response);
}
