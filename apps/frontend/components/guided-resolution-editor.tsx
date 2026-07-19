'use client';

import { useEffect, useMemo, useState } from 'react';
import { AuthoringDiagnostic, getRuleDefinitionDescriptor, previewRuleOperation, runRuleFixtures } from '@/lib/rule-authoring';

// ── Step draft types ──────────────────────────────────────────────────────────

export type OperationStepKind =
  | 'validate'
  | 'consume-resource'
  | 'perform-check'
  | 'apply-effect'
  | 'emit-event'
  | 'return';

export type OperationStepDraft = {
  stepId: string;
  kind: OperationStepKind;
  // validate
  conditionField?: 'actor-field' | 'target-field';
  conditionKey?: string;
  conditionOp?: 'gte' | 'lte' | 'equals';
  conditionValue?: number;
  failureMessage?: string;
  // consume-resource
  resourceId?: string;
  resourceCost?: number;
  // perform-check
  checkId?: string;
  resultKey?: string;
  onSuccess?: string;
  onFailure?: string;
  // apply-effect
  effectId?: string;
  effectTarget?: 'actor' | 'target';
  // emit-event
  eventId?: string;
  payloadFromResult?: string;
  // return
  outcome?: 'success' | 'failure';
  dataResultKey?: string;
  // routing (non-branching steps)
  next?: string;
};

// ── Draft union ───────────────────────────────────────────────────────────────

export type ResolutionAuthoringDraft =
  | { kind: 'modifier'; stableId: string; targetCheckId: string; operation: 'add' | 'multiply'; value: number }
  | { kind: 'resource'; stableId: string; capacity: number; minimum: number; refresh: 'manual' | 'encounter' | 'turn' }
  | { kind: 'effect'; stableId: string; durationKind: 'instant' | 'turns' | 'persistent'; durationTurns: number; modifierIds: string }
  | { kind: 'event'; stableId: string; visibility: 'public' | 'gm'; payloadFields: string }
  | { kind: 'check'; stableId: string; diceCount: number; dieSides: number; actorBonusField: string; targetField: string }
  | { kind: 'operation'; stableId: string; steps: OperationStepDraft[]; maximumSteps: number };

// ── Defaults ──────────────────────────────────────────────────────────────────

function defaultMeleeSteps(): OperationStepDraft[] {
  return [
    { stepId: 'consume-resource', kind: 'consume-resource', resourceId: 'resource:action-points', resourceCost: 1, next: 'perform-check' },
    { stepId: 'perform-check', kind: 'perform-check', checkId: 'check:melee-attack', resultKey: 'check', onSuccess: 'apply-effect', onFailure: 'emit-miss' },
    { stepId: 'apply-effect', kind: 'apply-effect', effectId: 'effect:wounded', effectTarget: 'target', next: 'emit-hit' },
    { stepId: 'emit-hit', kind: 'emit-event', eventId: 'event:melee-attack-hit', payloadFromResult: 'check', next: 'success' },
    { stepId: 'emit-miss', kind: 'emit-event', eventId: 'event:melee-attack-missed', payloadFromResult: 'check', next: 'failure' },
    { stepId: 'success', kind: 'return', outcome: 'success', dataResultKey: 'check' },
    { stepId: 'failure', kind: 'return', outcome: 'failure', dataResultKey: 'check' },
  ];
}

function defaultStep(kind: OperationStepKind, stepIndex: number): OperationStepDraft {
  const stepId = `step-${stepIndex + 1}`;
  switch (kind) {
    case 'validate': return { stepId, kind, conditionField: 'actor-field', conditionKey: 'id', conditionOp: 'gte', conditionValue: 0, failureMessage: 'Not available.', next: '' };
    case 'consume-resource': return { stepId, kind, resourceId: '', resourceCost: 1, next: '' };
    case 'perform-check': return { stepId, kind, checkId: '', resultKey: 'check', onSuccess: '', onFailure: '' };
    case 'apply-effect': return { stepId, kind, effectId: '', effectTarget: 'target', next: '' };
    case 'emit-event': return { stepId, kind, eventId: '', payloadFromResult: '', next: '' };
    case 'return': return { stepId, kind, outcome: 'success', dataResultKey: '' };
  }
}

export function defaultResolutionDraft(kind: ResolutionAuthoringDraft['kind']): ResolutionAuthoringDraft {
  switch (kind) {
    case 'modifier': return { kind, stableId: 'modifier:new-modifier', targetCheckId: 'check:melee-attack', operation: 'add', value: 1 };
    case 'resource': return { kind, stableId: 'resource:new-resource', capacity: 3, minimum: 0, refresh: 'turn' };
    case 'effect': return { kind, stableId: 'effect:new-effect', durationKind: 'persistent', durationTurns: 2, modifierIds: '' };
    case 'event': return { kind, stableId: 'event:new-event', visibility: 'public', payloadFields: 'attackerId:string, targetId:string' };
    case 'check': return { kind, stableId: 'check:new-check', diceCount: 1, dieSides: 20, actorBonusField: 'strength-modifier', targetField: 'defense' };
    case 'operation': return { kind, stableId: 'operation:new-operation', steps: defaultMeleeSteps(), maximumSteps: 8 };
  }
}

// ── Body builders ─────────────────────────────────────────────────────────────

function buildStep(step: OperationStepDraft): Record<string, unknown> {
  const base = { stepId: step.stepId, kind: step.kind };
  switch (step.kind) {
    case 'validate':
      return { ...base, condition: { op: step.conditionOp ?? 'gte', left: { op: step.conditionField ?? 'actor-field', key: step.conditionKey ?? 'id' }, right: { op: 'literal', value: step.conditionValue ?? 0 } }, failureMessage: step.failureMessage ?? 'Not available.', next: step.next ?? '' };
    case 'consume-resource':
      return { ...base, resourceId: step.resourceId ?? '', amount: { op: 'literal', value: step.resourceCost ?? 1 }, next: step.next ?? '' };
    case 'perform-check':
      return { ...base, checkId: step.checkId ?? '', resultKey: step.resultKey ?? 'check', onSuccess: step.onSuccess ?? '', onFailure: step.onFailure ?? '' };
    case 'apply-effect':
      return { ...base, effectId: step.effectId ?? '', target: step.effectTarget ?? 'target', next: step.next ?? '' };
    case 'emit-event': {
      const payload: Record<string, unknown> = { attackerId: { op: 'actor-field', key: 'id' }, targetId: { op: 'target-field', key: 'id' } };
      if (step.payloadFromResult) payload.total = { op: 'result', key: step.payloadFromResult, property: 'total' };
      return { ...base, eventId: step.eventId ?? '', payload, next: step.next ?? '' };
    }
    case 'return': {
      const data: Record<string, unknown> = {};
      if (step.dataResultKey) data.checkTotal = { op: 'result', key: step.dataResultKey, property: 'total' };
      return { ...base, outcome: step.outcome ?? 'success', ...(Object.keys(data).length ? { data } : {}) };
    }
  }
}

export function buildResolutionBody(name: string, description: string, draft: ResolutionAuthoringDraft): Record<string, unknown> {
  const common = { formatVersion: '1', metamodelVersion: 'resolution/1', definitionId: draft.stableId, definitionType: draft.kind, name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}) };
  switch (draft.kind) {
    case 'modifier':
      return { ...common, targetCheckId: draft.targetCheckId, operation: draft.operation, value: { op: 'literal', value: draft.value } };
    case 'resource':
      return { ...common, capacity: draft.capacity, minimum: draft.minimum, refresh: draft.refresh };
    case 'effect': {
      const duration = draft.durationKind === 'turns' ? { kind: 'turns', turns: draft.durationTurns } : { kind: draft.durationKind };
      const ids = draft.modifierIds.split(',').map((s) => s.trim()).filter(Boolean);
      return { ...common, duration, ...(ids.length ? { modifierIds: ids } : {}) };
    }
    case 'event': {
      const payload: Record<string, string> = {};
      draft.payloadFields.split(',').map((s) => s.trim()).filter(Boolean).forEach((field) => {
        const [key, type] = field.split(':').map((s) => s.trim());
        if (key && type) payload[key] = type;
      });
      return { ...common, visibility: draft.visibility, payload };
    }
    case 'check':
      return { ...common, checkKind: 'target-number', roll: { count: draft.diceCount, sides: draft.dieSides }, bonus: { op: 'actor-field', key: draft.actorBonusField }, target: { op: 'target-field', key: draft.targetField }, comparison: 'gte' };
    case 'operation': {
      const startStepId = draft.steps[0]?.stepId ?? 'step-1';
      return { ...common, startStepId, steps: draft.steps.map(buildStep), budget: { maximumSteps: draft.maximumSteps } };
    }
  }
}

// ── Body parsers ──────────────────────────────────────────────────────────────

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseStepDraft(step: Record<string, unknown>): OperationStepDraft {
  const kind = String(step.kind) as OperationStepKind;
  const base = { stepId: String(step.stepId), kind };
  switch (kind) {
    case 'validate': {
      const cond = record(step.condition) ? step.condition : {};
      const left = record(cond.left) ? cond.left : {};
      const right = record(cond.right) ? cond.right : {};
      return { ...base, conditionField: (left.op === 'target-field' ? 'target-field' : 'actor-field'), conditionKey: String(left.key ?? 'id'), conditionOp: (['gte', 'lte', 'equals'].includes(String(cond.op)) ? String(cond.op) : 'gte') as 'gte' | 'lte' | 'equals', conditionValue: Number(right.value ?? 0), failureMessage: String(step.failureMessage ?? ''), next: String(step.next ?? '') };
    }
    case 'consume-resource': {
      const amount = record(step.amount) ? step.amount : {};
      return { ...base, resourceId: String(step.resourceId ?? ''), resourceCost: Number(amount.value ?? 1), next: String(step.next ?? '') };
    }
    case 'perform-check':
      return { ...base, checkId: String(step.checkId ?? ''), resultKey: String(step.resultKey ?? 'check'), onSuccess: String(step.onSuccess ?? ''), onFailure: String(step.onFailure ?? '') };
    case 'apply-effect':
      return { ...base, effectId: String(step.effectId ?? ''), effectTarget: step.target === 'actor' ? 'actor' : 'target', next: String(step.next ?? '') };
    case 'emit-event': {
      const payload = record(step.payload) ? step.payload : {};
      const resultEntry = Object.values(payload).find((v): v is Record<string, unknown> => record(v) && v.op === 'result');
      return { ...base, eventId: String(step.eventId ?? ''), payloadFromResult: resultEntry ? String(resultEntry.key ?? '') : '', next: String(step.next ?? '') };
    }
    case 'return': {
      const data = record(step.data) ? step.data : {};
      const resultEntry = Object.values(data).find((v): v is Record<string, unknown> => record(v) && v.op === 'result');
      return { ...base, outcome: step.outcome === 'failure' ? 'failure' : 'success', dataResultKey: resultEntry ? String(resultEntry.key ?? '') : '' };
    }
    default:
      return base;
  }
}

export function resolutionDraftFromBody(body: Record<string, unknown>): ResolutionAuthoringDraft | undefined {
  if (body.metamodelVersion !== 'resolution/1' || typeof body.definitionId !== 'string') return undefined;
  switch (body.definitionType) {
    case 'modifier': {
      const val = record(body.value) ? body.value : {};
      return { kind: 'modifier', stableId: body.definitionId, targetCheckId: String(body.targetCheckId ?? ''), operation: body.operation === 'multiply' ? 'multiply' : 'add', value: typeof val.value === 'number' ? val.value : 0 };
    }
    case 'resource':
      return { kind: 'resource', stableId: body.definitionId, capacity: Number(body.capacity ?? 3), minimum: Number(body.minimum ?? 0), refresh: (['manual', 'encounter', 'turn'].includes(String(body.refresh)) ? String(body.refresh) : 'turn') as 'manual' | 'encounter' | 'turn' };
    case 'effect': {
      const dur = record(body.duration) ? body.duration : { kind: 'persistent' };
      const ids = Array.isArray(body.modifierIds) ? body.modifierIds.join(', ') : '';
      return { kind: 'effect', stableId: body.definitionId, durationKind: (['instant', 'turns', 'persistent'].includes(String(dur.kind)) ? String(dur.kind) : 'persistent') as 'instant' | 'turns' | 'persistent', durationTurns: Number(dur.turns ?? 2), modifierIds: ids };
    }
    case 'event': {
      const payload = record(body.payload) ? body.payload : {};
      const payloadFields = Object.entries(payload).map(([k, t]) => `${k}:${t}`).join(', ');
      return { kind: 'event', stableId: body.definitionId, visibility: body.visibility === 'gm' ? 'gm' : 'public', payloadFields };
    }
    case 'check':
      if (record(body.roll) && record(body.bonus) && record(body.target)) {
        return { kind: 'check', stableId: body.definitionId, diceCount: Number(body.roll.count), dieSides: Number(body.roll.sides), actorBonusField: String(body.bonus.key ?? ''), targetField: String(body.target.key ?? '') };
      }
      return undefined;
    case 'operation':
      if (Array.isArray(body.steps)) {
        const steps: OperationStepDraft[] = body.steps.filter(record).map(parseStepDraft);
        return { kind: 'operation', stableId: body.definitionId, steps, maximumSteps: record(body.budget) ? Number(body.budget.maximumSteps) : 8 };
      }
      return undefined;
  }
  return undefined;
}

// ── Step editor ───────────────────────────────────────────────────────────────

const STEP_KINDS: OperationStepKind[] = ['validate', 'consume-resource', 'perform-check', 'apply-effect', 'emit-event', 'return'];

function StepEditor({ index, step, onChange, onRemove }: { index: number; step: OperationStepDraft; onChange: (step: OperationStepDraft) => void; onRemove: () => void }) {
  const set = <K extends keyof OperationStepDraft>(key: K, value: OperationStepDraft[K]) => onChange({ ...step, [key]: value });
  return (
    <li className="pipeline-step-editor">
      <div className="pipeline-step-header">
        <span className="pipeline-step-index">{index + 1}</span>
        <label className="pipeline-step-id-field"><span className="sr-only">Step ID</span><input aria-label="Step ID" value={step.stepId} onChange={(e) => set('stepId', e.target.value)} placeholder="step-id" /></label>
        <select aria-label="Step kind" value={step.kind} onChange={(e) => onChange(defaultStep(e.target.value as OperationStepKind, index))}>{STEP_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
        <button type="button" aria-label="Remove step" className="pipeline-step-remove" onClick={onRemove}>✕</button>
      </div>
      <div className="pipeline-step-fields">
        {step.kind === 'validate' && <>
          <label><span>Condition field source</span><select value={step.conditionField ?? 'actor-field'} onChange={(e) => set('conditionField', e.target.value as 'actor-field' | 'target-field')}><option value="actor-field">Actor field</option><option value="target-field">Target field</option></select></label>
          <label><span>Field key</span><input value={step.conditionKey ?? ''} onChange={(e) => set('conditionKey', e.target.value)} placeholder="id" /></label>
          <label><span>Comparison</span><select value={step.conditionOp ?? 'gte'} onChange={(e) => set('conditionOp', e.target.value as 'gte' | 'lte' | 'equals')}><option value="gte">≥</option><option value="lte">≤</option><option value="equals">=</option></select></label>
          <label><span>Value</span><input type="number" value={step.conditionValue ?? 0} onChange={(e) => set('conditionValue', Number(e.target.value))} /></label>
          <label className="pipeline-step-wide"><span>Failure message</span><input value={step.failureMessage ?? ''} onChange={(e) => set('failureMessage', e.target.value)} placeholder="Not available." /></label>
          <label className="pipeline-step-wide"><span>Next step</span><input value={step.next ?? ''} onChange={(e) => set('next', e.target.value)} placeholder="step-id" /></label>
        </>}
        {step.kind === 'consume-resource' && <>
          <label className="pipeline-step-wide"><span>Resource ID</span><input value={step.resourceId ?? ''} onChange={(e) => set('resourceId', e.target.value)} placeholder="resource:action-points" /></label>
          <label><span>Amount</span><input type="number" min={0} value={step.resourceCost ?? 1} onChange={(e) => set('resourceCost', Number(e.target.value))} /></label>
          <label><span>Next step</span><input value={step.next ?? ''} onChange={(e) => set('next', e.target.value)} placeholder="step-id" /></label>
        </>}
        {step.kind === 'perform-check' && <>
          <label className="pipeline-step-wide"><span>Check ID</span><input value={step.checkId ?? ''} onChange={(e) => set('checkId', e.target.value)} placeholder="check:melee-attack" /></label>
          <label><span>Result key</span><input value={step.resultKey ?? 'check'} onChange={(e) => set('resultKey', e.target.value)} placeholder="check" /></label>
          <label><span>On success</span><input value={step.onSuccess ?? ''} onChange={(e) => set('onSuccess', e.target.value)} placeholder="next-step-id" /></label>
          <label><span>On failure</span><input value={step.onFailure ?? ''} onChange={(e) => set('onFailure', e.target.value)} placeholder="next-step-id" /></label>
        </>}
        {step.kind === 'apply-effect' && <>
          <label className="pipeline-step-wide"><span>Effect ID</span><input value={step.effectId ?? ''} onChange={(e) => set('effectId', e.target.value)} placeholder="effect:wounded" /></label>
          <label><span>Apply to</span><select value={step.effectTarget ?? 'target'} onChange={(e) => set('effectTarget', e.target.value as 'actor' | 'target')}><option value="target">Target</option><option value="actor">Actor</option></select></label>
          <label><span>Next step</span><input value={step.next ?? ''} onChange={(e) => set('next', e.target.value)} placeholder="step-id" /></label>
        </>}
        {step.kind === 'emit-event' && <>
          <label className="pipeline-step-wide"><span>Event ID</span><input value={step.eventId ?? ''} onChange={(e) => set('eventId', e.target.value)} placeholder="event:attack-hit" /></label>
          <label><span>Include result total from key</span><input value={step.payloadFromResult ?? ''} onChange={(e) => set('payloadFromResult', e.target.value)} placeholder="check (optional)" /></label>
          <label><span>Next step</span><input value={step.next ?? ''} onChange={(e) => set('next', e.target.value)} placeholder="step-id" /></label>
        </>}
        {step.kind === 'return' && <>
          <label><span>Outcome</span><select value={step.outcome ?? 'success'} onChange={(e) => set('outcome', e.target.value as 'success' | 'failure')}><option value="success">Success</option><option value="failure">Failure</option></select></label>
          <label><span>Return result data from key</span><input value={step.dataResultKey ?? ''} onChange={(e) => set('dataResultKey', e.target.value)} placeholder="check (optional)" /></label>
        </>}
      </div>
    </li>
  );
}

// ── Fixture runner ────────────────────────────────────────────────────────────

type KVPair = { key: string; value: string };

type FixtureResult = {
  passed: boolean;
  message?: string;
  preview?: { outcome: string; trace: Array<{ stepId: string; kind: string; message: string; values?: Record<string, unknown> }> };
};

function KVList({ label, pairs, onChange }: { label: string; pairs: KVPair[]; onChange: (pairs: KVPair[]) => void }) {
  return (
    <fieldset className="fixture-kv-group">
      <legend>{label}</legend>
      {pairs.map((pair, i) => (
        <div key={i} className="fixture-kv-row">
          <input aria-label="Key" value={pair.key} onChange={(e) => { const next = [...pairs]; next[i] = { ...pair, key: e.target.value }; onChange(next); }} placeholder="key" />
          <span>:</span>
          <input aria-label="Value" value={pair.value} onChange={(e) => { const next = [...pairs]; next[i] = { ...pair, value: e.target.value }; onChange(next); }} placeholder="value" />
          <button type="button" aria-label="Remove" onClick={() => onChange(pairs.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button type="button" className="fixture-add-field" onClick={() => onChange([...pairs, { key: '', value: '' }])}>+ Add field</button>
    </fieldset>
  );
}

function FixtureRunner({ operationId, relatedBodies, body }: { operationId: string; relatedBodies: Record<string, unknown>[]; body: Record<string, unknown> }) {
  const [actorFields, setActorFields] = useState<KVPair[]>([{ key: 'id', value: 'preview:actor' }, { key: 'strength-modifier', value: '3' }]);
  const [targetFields, setTargetFields] = useState<KVPair[]>([{ key: 'id', value: 'preview:target' }, { key: 'defense', value: '16' }]);
  const [resources, setResources] = useState<KVPair[]>([{ key: 'resource:action-points', value: '2' }]);
  const [entropy, setEntropy] = useState('14');
  const [expected, setExpected] = useState<'success' | 'failure' | ''>('success');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<FixtureResult>();
  const [error, setError] = useState<string>();

  async function run() {
    setRunning(true);
    setError(undefined);
    setResult(undefined);
    try {
      const kv = (pairs: KVPair[]) => Object.fromEntries(pairs.filter((p) => p.key).map((p) => [p.key, isNaN(Number(p.value)) ? p.value : Number(p.value)]));
      const entropyValues = entropy.split(',').map((s) => s.trim()).filter(Boolean).map(Number).filter(Number.isFinite);
      const allDefinitions = [...relatedBodies.filter((item) => item.metamodelVersion === 'resolution/1' && item.definitionId !== operationId), body];
      const fixture = { name: 'Builder fixture', operationId, context: { actor: { id: actorFields.find((p) => p.key === 'id')?.value ?? 'preview:actor', fields: kv(actorFields), resources: kv(resources) as Record<string, number> }, target: { id: targetFields.find((p) => p.key === 'id')?.value ?? 'preview:target', fields: kv(targetFields) }, entropy: entropyValues }, expected: expected ? { outcome: expected as 'success' | 'failure' } : {} };
      const response = await runRuleFixtures({ definitions: allDefinitions, fixtures: [fixture] });
      if (!response.valid || !response.results?.[0]) throw new Error(response.diagnostics?.map((d: { message: string }) => d.message).join(' ') || 'Fixture failed to compile.');
      setResult(response.results[0]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Fixture could not run.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="fixture-runner">
      <div className="fixture-runner-inputs">
        <KVList label="Actor fields" pairs={actorFields} onChange={setActorFields} />
        <KVList label="Actor resources" pairs={resources} onChange={setResources} />
        <KVList label="Target fields" pairs={targetFields} onChange={setTargetFields} />
        <label className="fixture-entropy"><span>Entropy (comma-separated rolls)</span><input value={entropy} onChange={(e) => setEntropy(e.target.value)} placeholder="14, 7" /></label>
        <label className="fixture-expected"><span>Expected outcome</span><select value={expected} onChange={(e) => setExpected(e.target.value as 'success' | 'failure' | '')}><option value="">Any</option><option value="success">Success</option><option value="failure">Failure</option></select></label>
      </div>
      <button type="button" className="secondary-action" onClick={run} disabled={running}>{running ? 'Running…' : 'Run fixture'}</button>
      {error && <p className="rule-set-notice error">{error}</p>}
      {result && (
        <div className="fixture-result">
          <strong className={result.passed ? 'fixture-pass' : 'fixture-fail'}>{result.passed ? '✓ Pass' : '✗ Fail'}{result.message ? ` — ${result.message}` : ''}</strong>
          {result.preview && <>
            <p className="fixture-outcome">Outcome: {result.preview.outcome}</p>
            <ol className="fixture-trace">{result.preview.trace.map((entry) => (
              <li key={entry.stepId}><span>{entry.stepId}</span>{entry.message}{entry.values && <small>{JSON.stringify(entry.values)}</small>}</li>
            ))}</ol>
          </>}
        </div>
      )}
    </div>
  );
}

// ── Main editor ───────────────────────────────────────────────────────────────

type ViewKind = 'builder' | 'preview' | 'fixture';

export function GuidedResolutionEditor({ name, description, draft, onChange, diagnostics = [], relatedBodies = [] }: { name: string; description: string; draft: ResolutionAuthoringDraft; onChange: (draft: ResolutionAuthoringDraft) => void; diagnostics?: AuthoringDiagnostic[]; relatedBodies?: Record<string, unknown>[] }) {
  const [view, setView] = useState<ViewKind>('builder');
  const [descriptorReady, setDescriptorReady] = useState(false);
  const [preview, setPreview] = useState<{ outcome: string; trace: Array<{ stepId: string; kind: string; message: string; values?: Record<string, unknown> }> }>();
  const [previewError, setPreviewError] = useState<string>();
  const [newStepKind, setNewStepKind] = useState<OperationStepKind>('return');

  const body = useMemo(() => buildResolutionBody(name, description, draft), [description, draft, name]);

  useEffect(() => {
    const controller = new AbortController();
    getRuleDefinitionDescriptor(draft.kind, controller.signal).then(() => setDescriptorReady(true)).catch(() => setDescriptorReady(false));
    return () => controller.abort();
  }, [draft.kind]);

  async function runPreview() {
    if (draft.kind !== 'operation') return;
    setPreviewError(undefined);
    try {
      const allDefinitions = [...relatedBodies.filter((item) => item.metamodelVersion === 'resolution/1' && item.definitionId !== draft.stableId), body];
      const result = await previewRuleOperation({ definitions: allDefinitions, operationId: draft.stableId, context: { actor: { id: 'preview:actor', fields: { id: 'preview:actor', 'strength-modifier': 3 }, resources: { [((draft as { steps: OperationStepDraft[] }).steps.find((s) => s.kind === 'consume-resource')?.resourceId ?? 'resource:action-points')]: 2 } }, target: { id: 'preview:target', fields: { id: 'preview:target', defense: 16 } }, entropy: [14] } });
      if (!result.valid || !result.preview) throw new Error(result.diagnostics.map((d) => d.message).join(' '));
      setPreview(result.preview);
      setView('preview');
    } catch (cause) { setPreviewError(cause instanceof Error ? cause.message : 'Preview failed.'); }
  }

  function updateStep(index: number, step: OperationStepDraft) {
    if (draft.kind !== 'operation') return;
    const steps = [...draft.steps];
    steps[index] = step;
    onChange({ ...draft, steps });
  }

  function removeStep(index: number) {
    if (draft.kind !== 'operation') return;
    onChange({ ...draft, steps: draft.steps.filter((_, i) => i !== index) });
  }

  function addStep() {
    if (draft.kind !== 'operation') return;
    onChange({ ...draft, steps: [...draft.steps, defaultStep(newStepKind, draft.steps.length)] });
  }

  const typeLabel: Record<ResolutionAuthoringDraft['kind'], string> = { modifier: 'Modifier', resource: 'Resource', effect: 'Effect', event: 'Event', check: 'Target-number check', operation: 'Bounded operation pipeline' };

  return (
    <section className="guided-rule-editor rule-set-field-wide">
      <div className="guided-rule-editor-heading">
        <div><span className="eyebrow">Phase 2 guided authoring</span><h5>{typeLabel[draft.kind]}</h5></div>
        <span className="badge">{descriptorReady ? 'resolution/1' : 'loading descriptor…'}</span>
      </div>

      {/* Stable ID */}
      <label className="rule-set-field rule-set-field-wide guided-rule-identity">
        <span>Stable definition ID</span>
        <input required pattern={`${draft.kind}:[a-z0-9]+(?:-[a-z0-9]+)*`} value={draft.stableId} onChange={(e) => onChange({ ...draft, stableId: e.target.value.toLowerCase() })} />
        <small>Names can change; this ID keeps references stable.</small>
      </label>

      {/* Tab bar — only check and operation have meaningful extra views */}
      {(draft.kind === 'check' || draft.kind === 'operation') && (
        <div className="guided-rule-tabs" role="tablist">
          <button type="button" aria-selected={view === 'builder'} onClick={() => setView('builder')}>Builder</button>
          {draft.kind === 'check' && <button type="button" aria-selected={view === 'preview'} onClick={() => setView('preview')}>Example table</button>}
          {draft.kind === 'operation' && <button type="button" aria-selected={view === 'preview'} onClick={() => setView('preview')}>Preview trace</button>}
          {draft.kind === 'operation' && <button type="button" aria-selected={view === 'fixture'} onClick={() => setView('fixture')}>Run fixture</button>}
        </div>
      )}

      {/* Modifier form */}
      {draft.kind === 'modifier' && (
        <div className="rule-set-form-grid guided-rule-full-form">
          <label className="rule-set-field rule-set-field-wide"><span>Target check ID</span><input value={draft.targetCheckId} onChange={(e) => onChange({ ...draft, targetCheckId: e.target.value })} placeholder="check:melee-attack" /><small>The check this modifier adjusts.</small></label>
          <label className="rule-set-field"><span>Adjustment</span><select value={draft.operation} onChange={(e) => onChange({ ...draft, operation: e.target.value as 'add' | 'multiply' })}><option value="add">Add (+)</option><option value="multiply">Multiply (×)</option></select></label>
          <label className="rule-set-field"><span>Value</span><input type="number" step="any" value={draft.value} onChange={(e) => onChange({ ...draft, value: Number(e.target.value) })} /></label>
        </div>
      )}

      {/* Resource form */}
      {draft.kind === 'resource' && (
        <div className="rule-set-form-grid guided-rule-full-form">
          <label className="rule-set-field"><span>Capacity</span><input type="number" min={0} value={draft.capacity} onChange={(e) => onChange({ ...draft, capacity: Number(e.target.value) })} /></label>
          <label className="rule-set-field"><span>Minimum</span><input type="number" min={0} value={draft.minimum} onChange={(e) => onChange({ ...draft, minimum: Number(e.target.value) })} /></label>
          <label className="rule-set-field"><span>Refreshes on</span><select value={draft.refresh} onChange={(e) => onChange({ ...draft, refresh: e.target.value as 'manual' | 'encounter' | 'turn' })}><option value="turn">Turn</option><option value="encounter">Encounter</option><option value="manual">Manual</option></select></label>
        </div>
      )}

      {/* Effect form */}
      {draft.kind === 'effect' && (
        <div className="rule-set-form-grid guided-rule-full-form">
          <label className="rule-set-field"><span>Duration</span><select value={draft.durationKind} onChange={(e) => onChange({ ...draft, durationKind: e.target.value as 'instant' | 'turns' | 'persistent' })}><option value="instant">Instant</option><option value="turns">Fixed turns</option><option value="persistent">Persistent</option></select></label>
          {draft.durationKind === 'turns' && <label className="rule-set-field"><span>Number of turns</span><input type="number" min={1} value={draft.durationTurns} onChange={(e) => onChange({ ...draft, durationTurns: Number(e.target.value) })} /></label>}
          <label className="rule-set-field rule-set-field-wide"><span>Modifier IDs (comma-separated)</span><input value={draft.modifierIds} onChange={(e) => onChange({ ...draft, modifierIds: e.target.value })} placeholder="modifier:accurate, modifier:weakened" /><small>Modifiers contributed while this effect is active.</small></label>
        </div>
      )}

      {/* Event form */}
      {draft.kind === 'event' && (
        <div className="rule-set-form-grid guided-rule-full-form">
          <label className="rule-set-field"><span>Visibility</span><select value={draft.visibility} onChange={(e) => onChange({ ...draft, visibility: e.target.value as 'public' | 'gm' })}><option value="public">Public</option><option value="gm">GM only</option></select></label>
          <label className="rule-set-field rule-set-field-wide"><span>Payload fields (key:type, …)</span><input value={draft.payloadFields} onChange={(e) => onChange({ ...draft, payloadFields: e.target.value })} placeholder="attackerId:string, targetId:string, total:number" /><small>Comma-separated pairs of field name and type (string | number | boolean).</small></label>
        </div>
      )}

      {/* Check builder */}
      {draft.kind === 'check' && view === 'builder' && (
        <div className="rule-set-form-grid guided-rule-full-form" role="tabpanel">
          <label className="rule-set-field"><span>Number of dice</span><input type="number" min={1} max={20} value={draft.diceCount} onChange={(e) => onChange({ ...draft, diceCount: Number(e.target.value) })} /></label>
          <label className="rule-set-field"><span>Die sides</span><input type="number" min={2} max={1000} value={draft.dieSides} onChange={(e) => onChange({ ...draft, dieSides: Number(e.target.value) })} /></label>
          <label className="rule-set-field"><span>Actor bonus field</span><input value={draft.actorBonusField} onChange={(e) => onChange({ ...draft, actorBonusField: e.target.value })} /></label>
          <label className="rule-set-field"><span>Target number field</span><input value={draft.targetField} onChange={(e) => onChange({ ...draft, targetField: e.target.value })} /></label>
        </div>
      )}
      {draft.kind === 'check' && view === 'preview' && (
        <table className="resolution-example-table" role="tabpanel"><thead><tr><th>Recorded roll</th><th>Bonus</th><th>Total</th><th>vs 16</th></tr></thead>
          <tbody>{[1, Math.ceil(draft.dieSides / 2), draft.dieSides].map((roll) => <tr key={roll}><td>{roll}</td><td>+3</td><td>{roll + 3}</td><td>{roll + 3 >= 16 ? 'success' : 'failure'}</td></tr>)}</tbody>
        </table>
      )}

      {/* Operation pipeline builder */}
      {draft.kind === 'operation' && view === 'builder' && (
        <div className="guided-rule-full-form" role="tabpanel">
          <ul className="pipeline-step-list">{draft.steps.map((step, i) => (
            <StepEditor key={`${i}-${step.stepId}`} index={i} step={step} onChange={(s) => updateStep(i, s)} onRemove={() => removeStep(i)} />
          ))}</ul>
          <div className="pipeline-add-step">
            <select aria-label="New step kind" value={newStepKind} onChange={(e) => setNewStepKind(e.target.value as OperationStepKind)}>{STEP_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
            <button type="button" className="secondary-action" onClick={addStep}>Add step</button>
          </div>
          <label className="rule-set-field"><span>Maximum steps (budget)</span><input type="number" min={1} max={256} value={draft.maximumSteps} onChange={(e) => onChange({ ...draft, maximumSteps: Number(e.target.value) })} /></label>
          <button className="secondary-action resolution-preview-button" type="button" onClick={runPreview}>Run sample preview</button>
        </div>
      )}
      {draft.kind === 'operation' && view === 'preview' && (
        <div className="resolution-preview" role="tabpanel">
          <button className="secondary-action" type="button" onClick={runPreview}>Run sample preview</button>
          {preview && <><strong>Outcome: {preview.outcome}</strong><ol>{preview.trace.map((entry) => <li key={entry.stepId}><span>{entry.stepId}</span>{entry.message}{entry.values && <small>{JSON.stringify(entry.values)}</small>}</li>)}</ol></>}
        </div>
      )}
      {draft.kind === 'operation' && view === 'fixture' && (
        <div role="tabpanel"><FixtureRunner operationId={draft.stableId} relatedBodies={relatedBodies} body={body} /></div>
      )}

      {previewError && <p className="rule-set-notice error">{previewError}</p>}
      {!!diagnostics.length && (
        <div className="guided-rule-diagnostics" aria-live="polite">
          <strong>{diagnostics.some((d) => d.severity === 'error') ? 'Validation errors' : 'Validation notes'}</strong>
          <ul>{diagnostics.map((d) => <li key={`${d.code}-${d.path}`}><span>{d.path}</span>{d.message}</li>)}</ul>
        </div>
      )}
      <details className="guided-rule-advanced"><summary>Advanced canonical source</summary><pre>{JSON.stringify(body, null, 2)}</pre></details>
    </section>
  );
}
