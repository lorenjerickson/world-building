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

// ── Templates ─────────────────────────────────────────────────────────────────

export type TemplateInstantiationResult = {
  valid: boolean;
  templateId: string;
  parameterValues: Record<string, string | number | boolean>;
  definitions: Array<{
    definitionId: string;
    definitionType: string;
    name: string;
    body: Record<string, unknown>;
  }>;
  diagnostics: AuthoringDiagnostic[];
};

export async function instantiateRuleTemplate(input: {
  template: Record<string, unknown>;
  values: Record<string, string | number | boolean>;
}): Promise<TemplateInstantiationResult> {
  const response = await fetch('/api/rule-authoring/templates/instantiate', {
    body: JSON.stringify(input),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  return readAuthoringResponse<TemplateInstantiationResult>(response);
}

// ── Assistant ─────────────────────────────────────────────────────────────────

export type AssistantProposedDefinition = {
  body: Record<string, unknown>;
  valid: boolean;
  diagnostics: AuthoringDiagnostic[];
};

export type AssistantResponse = {
  questions: string[];
  explanation: string;
  assumptions: string[];
  definitions: AssistantProposedDefinition[];
  llmAvailable: boolean;
};

export type AssistantMessage = { role: 'user' | 'assistant'; content: string };

export async function sendAssistantMessage(input: {
  message: string;
  history: AssistantMessage[];
  context?: { definitions: Record<string, unknown>[] };
}): Promise<AssistantResponse> {
  const response = await fetch('/api/rule-authoring/assistant', {
    body: JSON.stringify(input),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  return readAuthoringResponse<AssistantResponse>(response);
}

export type FixtureRunResult = {
  valid: boolean;
  diagnostics: AuthoringDiagnostic[];
  results: Array<{
    name: string;
    passed: boolean;
    message?: string;
    preview?: { outcome: string; trace: Array<{ stepId: string; kind: string; message: string; values?: Record<string, unknown> }> };
  }>;
};

export async function runRuleFixtures(input: {
  definitions: Record<string, unknown>[];
  fixtures: Array<{
    name: string;
    operationId: string;
    context: Record<string, unknown>;
    expected: Record<string, unknown>;
  }>;
}): Promise<FixtureRunResult> {
  const response = await fetch('/api/rule-authoring/fixtures/run', {
    body: JSON.stringify(input),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  return readAuthoringResponse<FixtureRunResult>(response);
}
