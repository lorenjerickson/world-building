'use client';

import { useState } from 'react';
import { AuthoringDiagnostic, instantiateRuleTemplate, TemplateInstantiationResult } from '@/lib/rule-authoring';

// ── Types ─────────────────────────────────────────────────────────────────────

export type TemplateParameterType = 'string' | 'number' | 'boolean' | 'select';

export type TemplateParameter = {
  parameterId: string;
  label: string;
  type: TemplateParameterType;
  required: boolean;
  default?: string | number | boolean;
  help?: string;
  options?: string;
};

export type TemplateGeneratedDefinition = {
  templateDefinitionId: string;
  definitionType: string;
  nameTemplate: string;
  descriptionTemplate?: string;
  bodyTemplate: string; // JSON text
};

export type GuidedTemplateDraft = {
  stableId: string;
  targetMetamodelVersion: string;
  parameters: TemplateParameter[];
  generates: TemplateGeneratedDefinition[];
};

// ── Defaults ──────────────────────────────────────────────────────────────────

export function defaultTemplateDraft(): GuidedTemplateDraft {
  return {
    stableId: 'template:new-template',
    targetMetamodelVersion: 'resolution/1',
    parameters: [
      { parameterId: 'attackName', label: 'Attack name', type: 'string', required: true },
      { parameterId: 'checkId', label: 'Check ID', type: 'string', required: true, default: 'check:melee-attack' },
      { parameterId: 'effectId', label: 'Effect on success', type: 'string', required: true, default: 'effect:wounded' },
    ],
    generates: [
      {
        templateDefinitionId: 'operation:{{attackName|slug}}',
        definitionType: 'operation',
        nameTemplate: '{{attackName}}',
        bodyTemplate: JSON.stringify({
          startStepId: 'consume-resource',
          budget: { maximumSteps: 8 },
          steps: [
            { stepId: 'consume-resource', kind: 'consume-resource', resourceId: 'resource:action-points', amount: { op: 'literal', value: 1 }, next: 'perform-check' },
            { stepId: 'perform-check', kind: 'perform-check', checkId: '{{checkId}}', resultKey: 'check', onSuccess: 'apply-effect', onFailure: 'failure' },
            { stepId: 'apply-effect', kind: 'apply-effect', effectId: '{{effectId}}', target: 'target', next: 'success' },
            { stepId: 'success', kind: 'return', outcome: 'success', data: { checkTotal: { op: 'result', key: 'check', property: 'total' } } },
            { stepId: 'failure', kind: 'return', outcome: 'failure' },
          ],
        }, null, 2),
      },
    ],
  };
}

// ── Body builder ──────────────────────────────────────────────────────────────

export function buildTemplateBody(name: string, description: string, draft: GuidedTemplateDraft): Record<string, unknown> {
  return {
    formatVersion: '1',
    metamodelVersion: 'template/1',
    definitionId: draft.stableId,
    definitionType: 'template',
    name: name.trim(),
    ...(description.trim() ? { description: description.trim() } : {}),
    targetMetamodelVersion: draft.targetMetamodelVersion,
    parameters: draft.parameters.map((p) => ({
      parameterId: p.parameterId,
      label: p.label,
      type: p.type,
      required: p.required,
      ...(p.default !== undefined && p.default !== '' ? { default: p.type === 'number' ? Number(p.default) : p.default } : {}),
      ...(p.help ? { help: p.help } : {}),
      ...(p.type === 'select' && p.options ? { options: p.options.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
    })),
    generates: draft.generates.map((gen) => {
      let bodyTemplate: Record<string, unknown> = {};
      try { bodyTemplate = JSON.parse(gen.bodyTemplate); } catch { /* leave empty */ }
      return {
        templateDefinitionId: gen.templateDefinitionId,
        definitionType: gen.definitionType,
        nameTemplate: gen.nameTemplate,
        ...(gen.descriptionTemplate?.trim() ? { descriptionTemplate: gen.descriptionTemplate } : {}),
        bodyTemplate,
      };
    }),
  };
}

export function templateDraftFromBody(body: Record<string, unknown>): GuidedTemplateDraft | undefined {
  if (body.metamodelVersion !== 'template/1' || body.definitionType !== 'template' || typeof body.definitionId !== 'string') return undefined;
  return {
    stableId: body.definitionId,
    targetMetamodelVersion: typeof body.targetMetamodelVersion === 'string' ? body.targetMetamodelVersion : 'resolution/1',
    parameters: Array.isArray(body.parameters) ? (body.parameters as Record<string, unknown>[]).map((p) => ({
      parameterId: String(p.parameterId ?? ''),
      label: String(p.label ?? ''),
      type: (['string', 'number', 'boolean', 'select'].includes(String(p.type)) ? String(p.type) : 'string') as TemplateParameterType,
      required: Boolean(p.required),
      default: p.default !== undefined ? String(p.default) : undefined,
      help: typeof p.help === 'string' ? p.help : undefined,
      options: Array.isArray(p.options) ? p.options.join(', ') : undefined,
    })) : [],
    generates: Array.isArray(body.generates) ? (body.generates as Record<string, unknown>[]).map((gen) => ({
      templateDefinitionId: String(gen.templateDefinitionId ?? ''),
      definitionType: String(gen.definitionType ?? ''),
      nameTemplate: String(gen.nameTemplate ?? ''),
      descriptionTemplate: typeof gen.descriptionTemplate === 'string' ? gen.descriptionTemplate : undefined,
      bodyTemplate: typeof gen.bodyTemplate === 'object' ? JSON.stringify(gen.bodyTemplate, null, 2) : '{}',
    })) : [],
  };
}

// ── Instantiation panel ───────────────────────────────────────────────────────

export function TemplateInstantiationPanel({
  templateBody,
  draft,
  onDefinitionsReady,
}: {
  templateBody: Record<string, unknown>;
  draft: GuidedTemplateDraft;
  onDefinitionsReady: (result: TemplateInstantiationResult) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(draft.parameters.map((p) => [p.parameterId, String(p.default ?? '')])),
  );
  const [result, setResult] = useState<TemplateInstantiationResult>();
  const [error, setError] = useState<string>();
  const [working, setWorking] = useState(false);

  async function instantiate() {
    setWorking(true);
    setError(undefined);
    setResult(undefined);
    try {
      const typedValues: Record<string, string | number | boolean> = {};
      for (const p of draft.parameters) {
        const raw = values[p.parameterId] ?? '';
        typedValues[p.parameterId] = p.type === 'number' ? Number(raw) : p.type === 'boolean' ? raw === 'true' : raw;
      }
      const res = await instantiateRuleTemplate({ template: templateBody, values: typedValues });
      setResult(res);
      if (res.valid) onDefinitionsReady(res);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Instantiation failed.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="template-instantiation-panel">
      <strong>Instantiate template</strong>
      <div className="rule-set-form-grid">
        {draft.parameters.map((param) => (
          <label key={param.parameterId} className="rule-set-field">
            <span>{param.label}{param.required && ' *'}</span>
            {param.type === 'boolean'
              ? <select value={values[param.parameterId] ?? 'false'} onChange={(e) => setValues({ ...values, [param.parameterId]: e.target.value })}><option value="false">False</option><option value="true">True</option></select>
              : param.type === 'select' && param.options
                ? <select value={values[param.parameterId] ?? ''} onChange={(e) => setValues({ ...values, [param.parameterId]: e.target.value })}>{param.options.split(',').map((opt) => opt.trim()).filter(Boolean).map((opt) => <option key={opt} value={opt}>{opt}</option>)}</select>
                : <input type={param.type === 'number' ? 'number' : 'text'} value={values[param.parameterId] ?? ''} onChange={(e) => setValues({ ...values, [param.parameterId]: e.target.value })} />}
            {param.help && <small>{param.help}</small>}
          </label>
        ))}
      </div>
      <button type="button" className="secondary-action" onClick={instantiate} disabled={working}>{working ? 'Instantiating…' : 'Generate definitions'}</button>
      {error && <p className="rule-set-notice error">{error}</p>}
      {result && (
        <div className="template-result">
          {result.diagnostics.length > 0 && (
            <ul className="guided-rule-diagnostics">{result.diagnostics.map((d) => <li key={`${d.code}-${d.path}`}><span>{d.path}</span>{d.message}</li>)}</ul>
          )}
          {result.valid && result.definitions.length > 0 && (
            <div>
              <p className="rule-set-notice">Ready to create {result.definitions.length} definition{result.definitions.length !== 1 ? 's' : ''}:</p>
              <ul className="template-generated-list">{result.definitions.map((def) => <li key={def.definitionId}><strong>{def.name}</strong><span>{def.definitionType}</span></li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Parameter editor ──────────────────────────────────────────────────────────

function ParameterEditor({ param, onChange, onRemove }: { param: TemplateParameter; onChange: (p: TemplateParameter) => void; onRemove: () => void }) {
  const set = <K extends keyof TemplateParameter>(key: K, value: TemplateParameter[K]) => onChange({ ...param, [key]: value });
  return (
    <li className="template-parameter-editor">
      <div className="pipeline-step-header">
        <label className="pipeline-step-id-field"><span className="sr-only">Parameter ID</span><input value={param.parameterId} onChange={(e) => set('parameterId', e.target.value)} placeholder="parameterId" /></label>
        <label><span className="sr-only">Label</span><input value={param.label} onChange={(e) => set('label', e.target.value)} placeholder="Display label" /></label>
        <select value={param.type} onChange={(e) => set('type', e.target.value as TemplateParameterType)}><option value="string">String</option><option value="number">Number</option><option value="boolean">Boolean</option><option value="select">Select</option></select>
        <label className="guided-rule-checkbox"><input type="checkbox" checked={param.required} onChange={(e) => set('required', e.target.checked)} /><span>Required</span></label>
        <button type="button" onClick={onRemove} className="pipeline-step-remove" aria-label="Remove">✕</button>
      </div>
      <div className="pipeline-step-fields">
        <label><span>Default</span><input value={String(param.default ?? '')} onChange={(e) => set('default', e.target.value)} placeholder="Optional default" /></label>
        {param.type === 'select' && <label className="pipeline-step-wide"><span>Options (comma-separated)</span><input value={param.options ?? ''} onChange={(e) => set('options', e.target.value)} /></label>}
        <label className="pipeline-step-wide"><span>Help text</span><input value={param.help ?? ''} onChange={(e) => set('help', e.target.value)} /></label>
      </div>
    </li>
  );
}

// ── Generated definition editor ───────────────────────────────────────────────

function GeneratedDefinitionEditor({ gen, onChange, onRemove }: { gen: TemplateGeneratedDefinition; onChange: (g: TemplateGeneratedDefinition) => void; onRemove: () => void }) {
  const set = <K extends keyof TemplateGeneratedDefinition>(key: K, value: TemplateGeneratedDefinition[K]) => onChange({ ...gen, [key]: value });
  return (
    <li className="template-gen-editor">
      <div className="pipeline-step-header">
        <label><span className="sr-only">Definition type</span><input value={gen.definitionType} onChange={(e) => set('definitionType', e.target.value)} placeholder="operation" /></label>
        <label className="pipeline-step-id-field"><span className="sr-only">ID template</span><input value={gen.templateDefinitionId} onChange={(e) => set('templateDefinitionId', e.target.value)} placeholder="operation:{{attackName|slug}}" /></label>
        <button type="button" onClick={onRemove} className="pipeline-step-remove" aria-label="Remove">✕</button>
      </div>
      <div className="pipeline-step-fields">
        <label className="pipeline-step-wide"><span>Name template</span><input value={gen.nameTemplate} onChange={(e) => set('nameTemplate', e.target.value)} placeholder="{{attackName}}" /></label>
        <label className="pipeline-step-wide"><span>Description template (optional)</span><input value={gen.descriptionTemplate ?? ''} onChange={(e) => set('descriptionTemplate', e.target.value)} /></label>
        <label className="pipeline-step-wide template-body-label"><span>Body template (JSON with {'{{slot}}'} substitution)</span><textarea className="rule-set-json-field" rows={8} value={gen.bodyTemplate} onChange={(e) => set('bodyTemplate', e.target.value)} spellCheck={false} /></label>
      </div>
    </li>
  );
}

// ── Main editor ───────────────────────────────────────────────────────────────

export function GuidedTemplateEditor({ name, description, draft, onChange, diagnostics = [] }: { name: string; description: string; draft: GuidedTemplateDraft; onChange: (draft: GuidedTemplateDraft) => void; diagnostics?: AuthoringDiagnostic[] }) {
  const body = buildTemplateBody(name, description, draft);

  function updateParam(index: number, param: TemplateParameter) {
    const parameters = [...draft.parameters];
    parameters[index] = param;
    onChange({ ...draft, parameters });
  }

  function updateGen(index: number, gen: TemplateGeneratedDefinition) {
    const generates = [...draft.generates];
    generates[index] = gen;
    onChange({ ...draft, generates });
  }

  return (
    <section className="guided-rule-editor rule-set-field-wide">
      <div className="guided-rule-editor-heading">
        <div><span className="eyebrow">Template authoring</span><h5>Typed authoring template</h5></div>
        <span className="badge">template/1</span>
      </div>

      <label className="rule-set-field rule-set-field-wide guided-rule-identity">
        <span>Stable template ID</span>
        <input required pattern="template:[a-z0-9]+(?:-[a-z0-9]+)*" value={draft.stableId} onChange={(e) => onChange({ ...draft, stableId: e.target.value.toLowerCase() })} />
      </label>

      <label className="rule-set-field">
        <span>Target metamodel version</span>
        <select value={draft.targetMetamodelVersion} onChange={(e) => onChange({ ...draft, targetMetamodelVersion: e.target.value })}>
          <option value="resolution/1">resolution/1</option>
          <option value="creature-capabilities/1">creature-capabilities/1</option>
        </select>
      </label>

      <div className="template-section">
        <div className="template-section-header"><strong>Parameters</strong><button type="button" className="secondary-action compact-action" onClick={() => onChange({ ...draft, parameters: [...draft.parameters, { parameterId: `param${draft.parameters.length + 1}`, label: 'New parameter', type: 'string', required: false }] })}>Add parameter</button></div>
        {draft.parameters.length === 0 && <p className="subtext">No parameters. Add one to let GMs configure this template.</p>}
        <ul className="pipeline-step-list">{draft.parameters.map((param, i) => <ParameterEditor key={i} param={param} onChange={(p) => updateParam(i, p)} onRemove={() => onChange({ ...draft, parameters: draft.parameters.filter((_, j) => j !== i) })} />)}</ul>
      </div>

      <div className="template-section">
        <div className="template-section-header"><strong>Generated definitions</strong><button type="button" className="secondary-action compact-action" onClick={() => onChange({ ...draft, generates: [...draft.generates, { templateDefinitionId: 'type:{{param1|slug}}', definitionType: 'operation', nameTemplate: '{{param1}}', bodyTemplate: '{}' }] })}>Add definition</button></div>
        {draft.generates.length === 0 && <p className="subtext">No generated definitions. Add one to define what this template produces.</p>}
        <ul className="pipeline-step-list">{draft.generates.map((gen, i) => <GeneratedDefinitionEditor key={i} gen={gen} onChange={(g) => updateGen(i, g)} onRemove={() => onChange({ ...draft, generates: draft.generates.filter((_, j) => j !== i) })} />)}</ul>
      </div>

      {!!diagnostics.length && <div className="guided-rule-diagnostics"><strong>Validation</strong><ul>{diagnostics.map((d) => <li key={`${d.code}-${d.path}`}><span>{d.path}</span>{d.message}</li>)}</ul></div>}
      <details className="guided-rule-advanced"><summary>Advanced canonical source</summary><pre>{JSON.stringify(body, null, 2)}</pre></details>
    </section>
  );
}
