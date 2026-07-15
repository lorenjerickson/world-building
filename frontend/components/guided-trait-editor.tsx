'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AuthoringDiagnostic,
  getRuleAuthoringMetamodel,
  getRuleDefinitionDescriptor,
} from '@/lib/rule-authoring';

export type GuidedTraitDraft =
  | {
    kind: 'vision';
    stableId: string;
    distance: number;
    lighting: string;
    requiresLineOfSight: boolean;
    opaqueBarriersBlock: boolean;
  }
  | {
    kind: 'running';
    stableId: string;
    multiplier: number;
  };

export function defaultGuidedTraitDraft(kind: GuidedTraitDraft['kind']): GuidedTraitDraft {
  return kind === 'vision'
    ? { kind, stableId: 'trait:vision', distance: 60, lighting: 'normal-daytime', requiresLineOfSight: true, opaqueBarriersBlock: true }
    : { kind, stableId: 'trait:running', multiplier: 2 };
}

export function buildGuidedTraitBody(
  name: string,
  description: string,
  draft: GuidedTraitDraft,
): Record<string, unknown> {
  const common = {
    formatVersion: '1',
    metamodelVersion: 'creature-capabilities/1',
    definitionId: draft.stableId,
    definitionType: 'trait',
    name: name.trim(),
    ...(description.trim() ? { description: description.trim() } : {}),
  };
  if (draft.kind === 'vision') {
    return {
      ...common,
      parameters: [{
        parameterId: 'vision-distance',
        name: 'Vision Distance',
        value: { type: 'distance', unit: 'meter', minimum: 0 },
        defaultValue: draft.distance,
      }],
      contributes: [{
        capability: 'perception.visual',
        values: {
          maximumRange: { op: 'parameter', parameterId: 'vision-distance' },
          lighting: { op: 'literal', value: draft.lighting, valueType: 'text' },
          requiresLineOfSight: { op: 'literal', value: draft.requiresLineOfSight, valueType: 'boolean' },
          opaqueBarriersBlock: { op: 'literal', value: draft.opaqueBarriersBlock, valueType: 'boolean' },
        },
      }],
    };
  }
  return {
    ...common,
    contributes: [{
      capability: 'movement.run',
      values: {
        rate: {
          op: 'multiply',
          left: { op: 'capability', capability: 'movement.walk', property: 'rate' },
          right: { op: 'literal', value: draft.multiplier, valueType: Number.isInteger(draft.multiplier) ? 'integer' : 'decimal' },
        },
      },
    }],
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function guidedTraitDraftFromBody(body: Record<string, unknown>): GuidedTraitDraft | undefined {
  if (body.metamodelVersion !== 'creature-capabilities/1' || body.definitionType !== 'trait' || typeof body.definitionId !== 'string') return undefined;
  const contributions = Array.isArray(body.contributes) ? body.contributes : [];
  const contribution = contributions.find(record);
  if (!contribution || !record(contribution.values)) return undefined;
  if (contribution.capability === 'perception.visual') {
    const parameters = Array.isArray(body.parameters) ? body.parameters : [];
    const distanceParameter = parameters.find((item) => record(item) && item.parameterId === 'vision-distance');
    const lighting = record(contribution.values.lighting) ? contribution.values.lighting.value : undefined;
    const lineOfSight = record(contribution.values.requiresLineOfSight) ? contribution.values.requiresLineOfSight.value : undefined;
    const opaque = record(contribution.values.opaqueBarriersBlock) ? contribution.values.opaqueBarriersBlock.value : undefined;
    return {
      kind: 'vision',
      stableId: body.definitionId,
      distance: record(distanceParameter) && typeof distanceParameter.defaultValue === 'number' ? distanceParameter.defaultValue : 60,
      lighting: typeof lighting === 'string' ? lighting : 'normal-daytime',
      requiresLineOfSight: typeof lineOfSight === 'boolean' ? lineOfSight : true,
      opaqueBarriersBlock: typeof opaque === 'boolean' ? opaque : true,
    };
  }
  if (contribution.capability === 'movement.run') {
    const rate = contribution.values.rate;
    const multiplier = record(rate) && record(rate.right) && typeof rate.right.value === 'number' ? rate.right.value : 2;
    return { kind: 'running', stableId: body.definitionId, multiplier };
  }
  return undefined;
}

type GuidedTraitEditorProps = {
  description: string;
  diagnostics?: AuthoringDiagnostic[];
  draft: GuidedTraitDraft;
  name: string;
  onChange: (draft: GuidedTraitDraft) => void;
};

export function GuidedTraitEditor({ description, diagnostics = [], draft, name, onChange }: GuidedTraitEditorProps) {
  const [view, setView] = useState<'sentence' | 'form'>('sentence');
  const [descriptorVersion, setDescriptorVersion] = useState<string>();
  const [descriptorError, setDescriptorError] = useState<string>();
  const canonical = useMemo(() => buildGuidedTraitBody(name, description, draft), [description, draft, name]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      getRuleAuthoringMetamodel(controller.signal),
      getRuleDefinitionDescriptor('trait', controller.signal),
    ]).then(([metamodel, descriptor]) => {
      if (!descriptor.semanticFrames?.length) throw new Error('The trait descriptor has no semantic frames.');
      setDescriptorVersion(metamodel.metamodelVersion);
    }).catch((cause) => {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setDescriptorError(cause instanceof Error ? cause.message : 'Authoring descriptors could not be loaded.');
    });
    return () => controller.abort();
  }, []);

  return (
    <section className="guided-rule-editor rule-set-field-wide" aria-labelledby="guided-rule-editor-title">
      <div className="guided-rule-editor-heading">
        <div><span className="eyebrow">Guided trait authoring</span><h5 id="guided-rule-editor-title">{draft.kind === 'vision' ? 'Visual perception' : 'Running movement'}</h5></div>
        <span className="badge">{descriptorVersion ?? 'loading metamodel…'}</span>
      </div>
      <div className="guided-rule-tabs" role="tablist" aria-label="Rule authoring view">
        <button type="button" role="tab" aria-selected={view === 'sentence'} onClick={() => setView('sentence')}>Readable rule</button>
        <button type="button" role="tab" aria-selected={view === 'form'} onClick={() => setView('form')}>Full form</button>
      </div>

      {view === 'sentence' && draft.kind === 'vision' && (
        <div className="semantic-rule-sentence" role="tabpanel">
          <strong>{name.trim() || 'This trait'}</strong> allows its holder to see visible entities up to
          <label><span className="sr-only">Vision distance in meters</span><input aria-label="Vision distance in meters" type="number" min={0} step="any" value={draft.distance} onChange={(event) => onChange({ ...draft, distance: Number(event.target.value) })} /></label>
          meters in
          <label><span className="sr-only">Supported lighting</span><select aria-label="Supported lighting" value={draft.lighting} onChange={(event) => onChange({ ...draft, lighting: event.target.value })}><option value="normal-daytime">normal daytime</option><option value="dim-light">dim light</option><option value="darkness">darkness</option></select></label>
          lighting.
        </div>
      )}
      {view === 'sentence' && draft.kind === 'running' && (
        <div className="semantic-rule-sentence" role="tabpanel">
          <strong>{name.trim() || 'This trait'}</strong> allows its holder to move by running at
          <label><span className="sr-only">Walking-speed multiplier</span><input aria-label="Walking-speed multiplier" type="number" min={0.1} step={0.1} value={draft.multiplier} onChange={(event) => onChange({ ...draft, multiplier: Number(event.target.value) })} /></label>
          times its effective Walking Speed.
        </div>
      )}

      {view === 'form' && (
        <div className="rule-set-form-grid guided-rule-full-form" role="tabpanel">
          <label className="rule-set-field rule-set-field-wide"><span>Stable rule ID</span><input required pattern="trait:[a-z0-9]+(?:-[a-z0-9]+)*" value={draft.stableId} onChange={(event) => onChange({ ...draft, stableId: event.target.value.toLowerCase() })} /><small>Names can change; this ID keeps references stable.</small></label>
          {draft.kind === 'vision' ? <>
            <label className="rule-set-field"><span>Vision distance</span><input required type="number" min={0} step="any" value={draft.distance} onChange={(event) => onChange({ ...draft, distance: Number(event.target.value) })} /><small>meters</small></label>
            <label className="rule-set-field"><span>Lighting</span><select value={draft.lighting} onChange={(event) => onChange({ ...draft, lighting: event.target.value })}><option value="normal-daytime">Normal daytime</option><option value="dim-light">Dim light</option><option value="darkness">Darkness</option></select></label>
            <label className="guided-rule-checkbox"><input type="checkbox" checked={draft.requiresLineOfSight} onChange={(event) => onChange({ ...draft, requiresLineOfSight: event.target.checked })} /><span>Requires line of sight</span></label>
            <label className="guided-rule-checkbox"><input type="checkbox" checked={draft.opaqueBarriersBlock} onChange={(event) => onChange({ ...draft, opaqueBarriersBlock: event.target.checked })} /><span>Opaque barriers block vision</span></label>
          </> : <>
            <label className="rule-set-field"><span>Walking-speed multiplier</span><input required type="number" min={0.1} step={0.1} value={draft.multiplier} onChange={(event) => onChange({ ...draft, multiplier: Number(event.target.value) })} /></label>
            <label className="rule-set-field"><span>Rate source</span><input value="Effective Walking Speed" disabled /></label>
          </>}
        </div>
      )}

      {view === 'sentence' && <label className="rule-set-field guided-rule-identity"><span>Stable rule ID</span><input required pattern="trait:[a-z0-9]+(?:-[a-z0-9]+)*" value={draft.stableId} onChange={(event) => onChange({ ...draft, stableId: event.target.value.toLowerCase() })} /><small>Names may change without breaking this identity.</small></label>}
      {descriptorError && <p className="rule-set-notice error" role="alert">{descriptorError}</p>}
      {!!diagnostics.length && <div className="guided-rule-diagnostics" aria-live="polite"><strong>{diagnostics.some((item) => item.severity === 'error') ? 'This draft needs attention' : 'Validation notes'}</strong><ul>{diagnostics.map((item) => <li key={`${item.code}-${item.path}`}><span>{item.path}</span>{item.message}</li>)}</ul></div>}
      <details className="guided-rule-advanced"><summary>Advanced canonical source</summary><p>This read-only source is generated from the readable rule and full form.</p><pre>{JSON.stringify(canonical, null, 2)}</pre></details>
    </section>
  );
}
