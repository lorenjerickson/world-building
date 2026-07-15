'use client';

import { useEffect, useMemo, useState } from 'react';
import { AuthoringDiagnostic, getRuleDefinitionDescriptor, previewRuleOperation } from '@/lib/rule-authoring';

export type ResolutionAuthoringDraft =
  | { kind: 'check'; stableId: string; diceCount: number; dieSides: number; actorBonusField: string; targetField: string }
  | { kind: 'operation'; stableId: string; checkId: string; resourceId: string; resourceCost: number; effectId: string; hitEventId: string; missEventId: string; maximumSteps: number };

export function defaultResolutionDraft(kind: ResolutionAuthoringDraft['kind']): ResolutionAuthoringDraft {
  return kind === 'check'
    ? { kind, stableId: 'check:new-check', diceCount: 1, dieSides: 20, actorBonusField: 'strength-modifier', targetField: 'defense' }
    : { kind, stableId: 'operation:new-operation', checkId: 'check:melee-attack', resourceId: 'resource:action-points', resourceCost: 1, effectId: 'effect:wounded', hitEventId: 'event:melee-attack-hit', missEventId: 'event:melee-attack-missed', maximumSteps: 8 };
}

export function buildResolutionBody(name: string, description: string, draft: ResolutionAuthoringDraft): Record<string, unknown> {
  const common = { formatVersion: '1', metamodelVersion: 'resolution/1', definitionId: draft.stableId, definitionType: draft.kind, name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}) };
  if (draft.kind === 'check') return { ...common, checkKind: 'target-number', roll: { count: draft.diceCount, sides: draft.dieSides }, bonus: { op: 'actor-field', key: draft.actorBonusField }, target: { op: 'target-field', key: draft.targetField }, comparison: 'gte' };
  return {
    ...common, startStepId: 'consume-resource', budget: { maximumSteps: draft.maximumSteps },
    steps: [
      { stepId: 'consume-resource', kind: 'consume-resource', resourceId: draft.resourceId, amount: { op: 'literal', value: draft.resourceCost }, next: 'perform-check' },
      { stepId: 'perform-check', kind: 'perform-check', checkId: draft.checkId, resultKey: 'check', onSuccess: 'apply-effect', onFailure: 'emit-miss' },
      { stepId: 'apply-effect', kind: 'apply-effect', effectId: draft.effectId, target: 'target', next: 'emit-hit' },
      { stepId: 'emit-hit', kind: 'emit-event', eventId: draft.hitEventId, payload: { attackerId: { op: 'actor-field', key: 'id' }, targetId: { op: 'target-field', key: 'id' }, total: { op: 'result', key: 'check', property: 'total' } }, next: 'success' },
      { stepId: 'emit-miss', kind: 'emit-event', eventId: draft.missEventId, payload: { attackerId: { op: 'actor-field', key: 'id' }, targetId: { op: 'target-field', key: 'id' }, total: { op: 'result', key: 'check', property: 'total' } }, next: 'failure' },
      { stepId: 'success', kind: 'return', outcome: 'success', data: { checkTotal: { op: 'result', key: 'check', property: 'total' } } },
      { stepId: 'failure', kind: 'return', outcome: 'failure', data: { checkTotal: { op: 'result', key: 'check', property: 'total' } } },
    ],
  };
}

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

export function resolutionDraftFromBody(body: Record<string, unknown>): ResolutionAuthoringDraft | undefined {
  if (body.metamodelVersion !== 'resolution/1' || typeof body.definitionId !== 'string') return undefined;
  if (body.definitionType === 'check' && record(body.roll) && record(body.bonus) && record(body.target)) return { kind: 'check', stableId: body.definitionId, diceCount: Number(body.roll.count), dieSides: Number(body.roll.sides), actorBonusField: String(body.bonus.key ?? ''), targetField: String(body.target.key ?? '') };
  if (body.definitionType === 'operation' && Array.isArray(body.steps)) {
    const steps = body.steps;
    const step = (id: string) => steps.find((item) => record(item) && item.stepId === id) as Record<string, unknown> | undefined;
    const consume = step('consume-resource'); const check = step('perform-check'); const effect = step('apply-effect'); const hit = step('emit-hit'); const miss = step('emit-miss');
    if (consume && check && effect && hit && miss) return { kind: 'operation', stableId: body.definitionId, checkId: String(check.checkId), resourceId: String(consume.resourceId), resourceCost: record(consume.amount) ? Number(consume.amount.value) : 1, effectId: String(effect.effectId), hitEventId: String(hit.eventId), missEventId: String(miss.eventId), maximumSteps: record(body.budget) ? Number(body.budget.maximumSteps) : 8 };
  }
  return undefined;
}

export function GuidedResolutionEditor({ name, description, draft, onChange, diagnostics = [], relatedBodies = [] }: { name: string; description: string; draft: ResolutionAuthoringDraft; onChange: (draft: ResolutionAuthoringDraft) => void; diagnostics?: AuthoringDiagnostic[]; relatedBodies?: Record<string, unknown>[] }) {
  const [view, setView] = useState<'builder' | 'preview'>('builder');
  const [descriptorReady, setDescriptorReady] = useState(false);
  const [preview, setPreview] = useState<{ outcome: string; trace: Array<{ stepId: string; kind: string; message: string; values?: Record<string, unknown> }> }>();
  const [previewError, setPreviewError] = useState<string>();
  const body = useMemo(() => buildResolutionBody(name, description, draft), [description, draft, name]);
  useEffect(() => { const controller = new AbortController(); getRuleDefinitionDescriptor(draft.kind, controller.signal).then(() => setDescriptorReady(true)).catch(() => setDescriptorReady(false)); return () => controller.abort(); }, [draft.kind]);

  async function runPreview() {
    if (draft.kind !== 'operation') return;
    setPreviewError(undefined);
    try {
      const result = await previewRuleOperation({ definitions: [...relatedBodies.filter((item) => item.metamodelVersion === 'resolution/1' && item.definitionId !== draft.stableId), body], operationId: draft.stableId, context: { actor: { id: 'preview:actor', fields: { id: 'preview:actor', 'strength-modifier': 3 }, resources: { [draft.resourceId]: 2 } }, target: { id: 'preview:target', fields: { id: 'preview:target', defense: 16 } }, entropy: [14] } });
      if (!result.valid || !result.preview) throw new Error(result.diagnostics.map((item) => item.message).join(' '));
      setPreview(result.preview);
      setView('preview');
    } catch (cause) { setPreviewError(cause instanceof Error ? cause.message : 'Preview failed.'); }
  }

  return <section className="guided-rule-editor rule-set-field-wide">
    <div className="guided-rule-editor-heading"><div><span className="eyebrow">Phase 2 guided authoring</span><h5>{draft.kind === 'check' ? 'Target-number check' : 'Bounded operation pipeline'}</h5></div><span className="badge">{descriptorReady ? 'resolution/1' : 'loading descriptor…'}</span></div>
    <div className="guided-rule-tabs" role="tablist"><button type="button" aria-selected={view === 'builder'} onClick={() => setView('builder')}>Builder</button><button type="button" aria-selected={view === 'preview'} onClick={() => setView('preview')}>{draft.kind === 'check' ? 'Example table' : 'Preview trace'}</button></div>
    {view === 'builder' && <div className="rule-set-form-grid guided-rule-full-form">
      <label className="rule-set-field rule-set-field-wide"><span>Stable definition ID</span><input required pattern={`${draft.kind}:[a-z0-9]+(?:-[a-z0-9]+)*`} value={draft.stableId} onChange={(event) => onChange({ ...draft, stableId: event.target.value.toLowerCase() })} /></label>
      {draft.kind === 'check' ? <>
        <label className="rule-set-field"><span>Number of dice</span><input type="number" min={1} max={20} value={draft.diceCount} onChange={(event) => onChange({ ...draft, diceCount: Number(event.target.value) })} /></label><label className="rule-set-field"><span>Die sides</span><input type="number" min={2} max={1000} value={draft.dieSides} onChange={(event) => onChange({ ...draft, dieSides: Number(event.target.value) })} /></label>
        <label className="rule-set-field"><span>Actor bonus field</span><input value={draft.actorBonusField} onChange={(event) => onChange({ ...draft, actorBonusField: event.target.value })} /></label><label className="rule-set-field"><span>Target number field</span><input value={draft.targetField} onChange={(event) => onChange({ ...draft, targetField: event.target.value })} /></label>
      </> : <>
        <label className="rule-set-field"><span>Check reference</span><input value={draft.checkId} onChange={(event) => onChange({ ...draft, checkId: event.target.value })} /></label><label className="rule-set-field"><span>Resource reference</span><input value={draft.resourceId} onChange={(event) => onChange({ ...draft, resourceId: event.target.value })} /></label>
        <label className="rule-set-field"><span>Resource cost</span><input type="number" min={0} value={draft.resourceCost} onChange={(event) => onChange({ ...draft, resourceCost: Number(event.target.value) })} /></label><label className="rule-set-field"><span>Success effect</span><input value={draft.effectId} onChange={(event) => onChange({ ...draft, effectId: event.target.value })} /></label>
        <label className="rule-set-field"><span>Hit event</span><input value={draft.hitEventId} onChange={(event) => onChange({ ...draft, hitEventId: event.target.value })} /></label><label className="rule-set-field"><span>Miss event</span><input value={draft.missEventId} onChange={(event) => onChange({ ...draft, missEventId: event.target.value })} /></label>
        <label className="rule-set-field"><span>Maximum steps</span><input type="number" min={1} max={256} value={draft.maximumSteps} onChange={(event) => onChange({ ...draft, maximumSteps: Number(event.target.value) })} /></label>
        <ol className="resolution-pipeline rule-set-field-wide">{(body.steps as Array<Record<string, unknown>>).map((step, index) => <li key={String(step.stepId)}><span>{index + 1}</span><strong>{String(step.kind)}</strong><small>{String(step.stepId)}</small></li>)}</ol>
      </>}
    </div>}
    {view === 'preview' && draft.kind === 'check' && <table className="resolution-example-table"><thead><tr><th>Recorded roll</th><th>Bonus</th><th>Total</th><th>vs 16</th></tr></thead><tbody>{[1, Math.ceil(draft.dieSides / 2), draft.dieSides].map((roll) => <tr key={roll}><td>{roll}</td><td>+3</td><td>{roll + 3}</td><td>{roll + 3 >= 16 ? 'success' : 'failure'}</td></tr>)}</tbody></table>}
    {view === 'preview' && draft.kind === 'operation' && <div className="resolution-preview"><button className="secondary-action" type="button" onClick={runPreview}>Run sample preview</button>{preview && <><strong>Outcome: {preview.outcome}</strong><ol>{preview.trace.map((item) => <li key={item.stepId}><span>{item.stepId}</span>{item.message}{item.values && <small>{JSON.stringify(item.values)}</small>}</li>)}</ol></>}</div>}
    {draft.kind === 'operation' && view === 'builder' && <button className="secondary-action resolution-preview-button" type="button" onClick={runPreview}>Run sample preview</button>}
    {previewError && <p className="rule-set-notice error">{previewError}</p>}
    {!!diagnostics.length && <div className="guided-rule-diagnostics"><strong>Validation</strong><ul>{diagnostics.map((item) => <li key={`${item.code}-${item.path}`}><span>{item.path}</span>{item.message}</li>)}</ul></div>}
    <details className="guided-rule-advanced"><summary>Advanced canonical source</summary><pre>{JSON.stringify(body, null, 2)}</pre></details>
  </section>;
}
