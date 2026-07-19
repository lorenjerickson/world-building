import {
  TEMPLATE_METAMODEL_VERSION,
  TemplateDefinition,
  TemplateDiagnostic,
  TemplateGeneratedDefinition,
  TemplateInstantiationResult,
  TemplateParameter,
  TemplateParameterValues,
} from './template.types';

// ── Slot substitution ─────────────────────────────────────────────────────────

function toSlug(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const SLOT_RE = /\{\{(\w+)(?:\|(\w+))?\}\}/g;

function substituteString(template: string, values: TemplateParameterValues): string {
  return template.replace(SLOT_RE, (match, id, filter) => {
    const value = values[id];
    if (value === undefined) return match; // leave unresolved slots intact
    const str = String(value);
    return filter === 'slug' ? toSlug(str) : str;
  });
}

function substituteDeep(node: unknown, values: TemplateParameterValues): unknown {
  if (typeof node === 'string') return substituteString(node, values);
  if (Array.isArray(node)) return node.map((item) => substituteDeep(item, values));
  if (node !== null && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, substituteDeep(v, values)]),
    );
  }
  return node;
}

// ── Parameter validation ──────────────────────────────────────────────────────

function validateParameters(
  params: TemplateParameter[],
  values: TemplateParameterValues,
): TemplateDiagnostic[] {
  const diagnostics: TemplateDiagnostic[] = [];
  for (const param of params) {
    const value = values[param.parameterId] ?? param.default;
    const path = `parameters.${param.parameterId}`;
    if (param.required && value === undefined) {
      diagnostics.push({ code: 'TEMPLATE_PARAM_REQUIRED', path, message: `'${param.label}' is required.`, severity: 'error' });
      continue;
    }
    if (value === undefined) continue;
    if (param.type === 'number' && typeof value !== 'number' && isNaN(Number(value))) {
      diagnostics.push({ code: 'TEMPLATE_PARAM_TYPE', path, message: `'${param.label}' must be a number.`, severity: 'error' });
    }
    if (param.type === 'select' && param.options && !param.options.includes(String(value))) {
      diagnostics.push({ code: 'TEMPLATE_PARAM_OPTION', path, message: `'${param.label}' must be one of: ${param.options.join(', ')}.`, severity: 'error' });
    }
  }
  return diagnostics;
}

// ── Template validation ───────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateTemplateDefinition(body: unknown): TemplateDiagnostic[] {
  const diagnostics: TemplateDiagnostic[] = [];
  if (!isRecord(body)) return [{ code: 'TEMPLATE_INVALID', path: '', message: 'Template must be an object.', severity: 'error' }];
  if (body.metamodelVersion !== TEMPLATE_METAMODEL_VERSION) diagnostics.push({ code: 'TEMPLATE_VERSION_INVALID', path: 'metamodelVersion', message: `Template requires metamodelVersion '${TEMPLATE_METAMODEL_VERSION}'.`, severity: 'error' });
  if (typeof body.definitionId !== 'string' || !/^template:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(body.definitionId)) diagnostics.push({ code: 'TEMPLATE_ID_INVALID', path: 'definitionId', message: "Template ID must match template:[a-z0-9-]+.", severity: 'error' });
  if (typeof body.name !== 'string' || !body.name.trim()) diagnostics.push({ code: 'TEMPLATE_NAME_REQUIRED', path: 'name', message: 'Template name is required.', severity: 'error' });
  if (typeof body.targetMetamodelVersion !== 'string' || !body.targetMetamodelVersion) diagnostics.push({ code: 'TEMPLATE_TARGET_REQUIRED', path: 'targetMetamodelVersion', message: 'targetMetamodelVersion is required.', severity: 'error' });
  if (!Array.isArray(body.parameters)) diagnostics.push({ code: 'TEMPLATE_PARAMS_REQUIRED', path: 'parameters', message: 'parameters must be an array.', severity: 'error' });
  else {
    (body.parameters as unknown[]).forEach((param, i) => {
      if (!isRecord(param)) return;
      if (typeof param.parameterId !== 'string' || !param.parameterId) diagnostics.push({ code: 'TEMPLATE_PARAM_ID', path: `parameters[${i}].parameterId`, message: 'Each parameter requires a parameterId.', severity: 'error' });
      if (typeof param.label !== 'string' || !param.label) diagnostics.push({ code: 'TEMPLATE_PARAM_LABEL', path: `parameters[${i}].label`, message: 'Each parameter requires a label.', severity: 'error' });
      if (!['string', 'number', 'boolean', 'select'].includes(String(param.type))) diagnostics.push({ code: 'TEMPLATE_PARAM_TYPE_INVALID', path: `parameters[${i}].type`, message: "Parameter type must be string, number, boolean, or select.", severity: 'error' });
    });
  }
  if (!Array.isArray(body.generates) || body.generates.length === 0) diagnostics.push({ code: 'TEMPLATE_GENERATES_REQUIRED', path: 'generates', message: 'Template must specify at least one generated definition.', severity: 'error' });
  return diagnostics;
}

// ── Instantiation ─────────────────────────────────────────────────────────────

function instantiateGenerated(
  gen: TemplateGeneratedDefinition,
  resolved: TemplateParameterValues,
  targetMetamodelVersion: string,
  templateId: string,
): { definitionId: string; definitionType: string; name: string; body: Record<string, unknown> } {
  const definitionId = substituteString(gen.templateDefinitionId, resolved);
  const name = substituteString(gen.nameTemplate, resolved);
  const description = gen.descriptionTemplate ? substituteString(gen.descriptionTemplate, resolved) : undefined;
  const substitutedBody = substituteDeep(gen.bodyTemplate, resolved) as Record<string, unknown>;
  const body: Record<string, unknown> = {
    formatVersion: '1',
    metamodelVersion: targetMetamodelVersion,
    definitionId,
    definitionType: gen.definitionType,
    name,
    ...(description ? { description } : {}),
    ...substitutedBody,
    _templateProvenance: {
      templateId,
      templateMetamodelVersion: TEMPLATE_METAMODEL_VERSION,
      instantiatedAt: new Date().toISOString(),
      parameterValues: resolved,
    },
  };
  return { definitionId, definitionType: gen.definitionType, name, body };
}

export function instantiateTemplate(
  template: TemplateDefinition,
  values: TemplateParameterValues,
): TemplateInstantiationResult {
  // Apply defaults
  const resolved: TemplateParameterValues = {};
  for (const param of template.parameters) {
    if (values[param.parameterId] !== undefined) resolved[param.parameterId] = values[param.parameterId];
    else if (param.default !== undefined) resolved[param.parameterId] = param.default;
  }

  const diagnostics = validateParameters(template.parameters, resolved);
  const hasErrors = diagnostics.some((d) => d.severity === 'error');

  const definitions = hasErrors
    ? []
    : template.generates.map((gen) =>
        instantiateGenerated(gen, resolved, template.targetMetamodelVersion, template.definitionId),
      );

  return {
    valid: !hasErrors,
    templateId: template.definitionId,
    parameterValues: resolved,
    definitions,
    diagnostics,
  };
}
