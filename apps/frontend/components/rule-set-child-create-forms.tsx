'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import { DeleteArtifactButton } from './delete-artifact-button';
import { TagEditor } from './tag-editor';
import {
  buildGuidedTraitBody,
  defaultGuidedTraitDraft,
  GuidedTraitDraft,
  GuidedTraitEditor,
  guidedTraitDraftFromBody,
} from './guided-trait-editor';
import { AuthoringDiagnostic, validateRuleAuthoringDefinitions } from '@/lib/rule-authoring';
import { buildResolutionBody, defaultResolutionDraft, GuidedResolutionEditor, type ResolutionAuthoringDraft, resolutionDraftFromBody } from './guided-resolution-editor';
import {
  buildTemplateBody,
  defaultTemplateDraft,
  GuidedTemplateEditor,
  GuidedTemplateDraft,
  TemplateInstantiationPanel,
  templateDraftFromBody,
} from './guided-template-editor';
import {
  createRuleDefinition,
  createRuleModule,
  ruleDefinitionTypes,
  RuleDefinitionResource,
  RuleDefinitionType,
  RuleModuleResource,
  RuleSetApiError,
  updateRuleDefinition,
  updateRuleModule,
} from '@/lib/rule-sets';
import type { TemplateInstantiationResult } from '@/lib/rule-authoring';
import { RuleDefinitionSnapshotPanel } from './rule-definition-snapshot-panel';
import { getRuleDefinition, isStaleError } from '@/lib/rule-sets';
import {
  buildGrantsBody,
  grantsDraftFromBody,
  prerequisitesDraftFromBody,
  GuidedTraitGrantsEditor,
  newGrant,
  type GrantDraft,
  type PrerequisiteSpec,
} from './guided-trait-grants-editor';

// ── Forms ──────────────────────────────────────────────────────────────────────

type ChildFormProps<T> = {
  onCancel: () => void;
  onCreated: (resource: T) => void;
  ruleSetId: number;
};

function namespaceFromName(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function RuleModuleCreateForm({ onCancel, onCreated, ruleSetId }: ChildFormProps<RuleModuleResource>) {
  const [name, setName] = useState('');
  const [namespace, setNamespace] = useState('');
  const [namespaceEdited, setNamespaceEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setSubmitting(true);
    try {
      const module = await createRuleModule(ruleSetId, {
        description: description.trim() || undefined,
        name: name.trim(),
        namespace,
      });
      onCreated(module);
    } catch (cause) {
      setError(cause instanceof RuleSetApiError ? cause.message : 'The module could not be created.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="rule-set-child-form" onSubmit={submit}>
      <div className="rule-set-form-grid">
        <label className="rule-set-field"><span>Name</span><input required maxLength={120} value={name} onChange={(event) => {
          const nextName = event.target.value;
          setName(nextName);
          if (!namespaceEdited) setNamespace(namespaceFromName(nextName));
        }} placeholder="Creature traits" autoFocus /></label>
        <label className="rule-set-field"><span>Namespace</span><input required maxLength={120} pattern="[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*" value={namespace} onChange={(event) => { setNamespaceEdited(true); setNamespace(event.target.value.toLowerCase()); }} placeholder="creature-traits" /></label>
        <label className="rule-set-field rule-set-field-wide"><span>Description</span><textarea maxLength={20000} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What belongs in this module?" /></label>
      </div>
      {error && <p className="rule-set-notice error" role="alert">{error}</p>}
      <div className="rule-set-form-actions"><button className="secondary-action" type="button" onClick={onCancel}>Cancel</button><button className="primary-action" type="submit" disabled={submitting || !namespace}>{submitting ? 'Creating…' : 'Create module'}</button></div>
    </form>
  );
}

type DefinitionFormProps = ChildFormProps<RuleDefinitionResource> & {
  definitions: RuleDefinitionResource[];
  modules: RuleModuleResource[];
  selectedModuleId?: number | null;
  externalVisibility?: 'exported' | 'private';
  onVisibilityChange?: (v: 'exported' | 'private') => void;
};

export function RuleDefinitionCreateForm({ definitions, modules, onCancel, onCreated, ruleSetId, selectedModuleId, externalVisibility, onVisibilityChange }: DefinitionFormProps) {
  const [moduleId, setModuleId] = useState(String(selectedModuleId ?? modules[0]?.id ?? ''));
  const [definitionType, setDefinitionType] = useState<RuleDefinitionType>('trait');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [localVisibility, setLocalVisibility] = useState<'exported' | 'private'>('exported');
  const visibility = externalVisibility ?? localVisibility;
  function setVisibility(v: 'exported' | 'private') {
    if (onVisibilityChange) onVisibilityChange(v); else setLocalVisibility(v);
  }
  const [tags, setTags] = useState<string[]>([]);
  const [body, setBody] = useState('{}');
  const [bodyLabelSynced, setBodyLabelSynced] = useState(false);
  const [authoringExperience, setAuthoringExperience] = useState<'grants' | 'vision' | 'running' | 'advanced'>('grants');
  const [grantsDraft, setGrantsDraft] = useState<GrantDraft[]>(() => []);
  const [prerequisitesDraft, setPrerequisitesDraft] = useState<PrerequisiteSpec>(() => ({ mode: 'any', ids: [] }));
  const [guidedDraft, setGuidedDraft] = useState<GuidedTraitDraft>(() => defaultGuidedTraitDraft('vision'));
  const [diagnostics, setDiagnostics] = useState<AuthoringDiagnostic[]>([]);
  const [resolutionDraft, setResolutionDraft] = useState<ResolutionAuthoringDraft>();
  const [templateDraft, setTemplateDraft] = useState<GuidedTemplateDraft>();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    let parsedBody: unknown;
    const guided = definitionType === 'trait' && (authoringExperience === 'vision' || authoringExperience === 'running');
    if (authoringExperience === 'grants' && definitionType === 'trait') {
      parsedBody = buildGrantsBody(grantsDraft, prerequisitesDraft, definitions.filter((d) => d.definitionType === 'trait'));
    } else if (templateDraft) {
      parsedBody = buildTemplateBody(name, description, templateDraft);
    } else if (guided || resolutionDraft) {
      parsedBody = guided ? buildGuidedTraitBody(name, description, guidedDraft) : buildResolutionBody(name, description, resolutionDraft!);
      try {
        const related = resolutionDraft ? definitions.map((item) => item.body).filter((item) => item.metamodelVersion === 'resolution/1') : [];
        const validation = await validateRuleAuthoringDefinitions([...related, parsedBody as Record<string, unknown>]);
        setDiagnostics(validation.diagnostics);
        if (!validation.valid) {
          setError('Resolve the highlighted rule-data issues before creating this definition.');
          return;
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'The rule could not be validated.');
        return;
      }
    } else {
      try {
        parsedBody = JSON.parse(body);
      } catch {
        setError('Rule data must be valid JSON.');
        return;
      }
      if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
        setError('Rule data must be a JSON object.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const definition = await createRuleDefinition(ruleSetId, {
        body: parsedBody as Record<string, unknown>,
        definitionType,
        description: description.trim() || undefined,
        moduleId: Number(moduleId),
        name: name.trim(),
        tags,
        visibility,
      });
      onCreated(definition);
    } catch (cause) {
      setError(cause instanceof RuleSetApiError ? cause.message : 'The definition could not be created.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="rule-set-child-form" onSubmit={submit}>
      <div className="rule-set-form-grid">
        <label className="rule-set-field"><span>Name</span><input required maxLength={160} value={name} onChange={(event) => { const n = event.target.value; setName(n); if (definitionType === 'field' && bodyLabelSynced) setBody(JSON.stringify({ label: n }, null, 2)); }} placeholder="Clawed" autoFocus /></label>
        <label className="rule-set-field"><span>Module</span><select required value={moduleId} onChange={(event) => setModuleId(event.target.value)}>{modules.map((module) => <option key={module.id} value={module.id}>{module.name} ({module.namespace})</option>)}</select></label>
        <label className="rule-set-field"><span>Definition type</span><select value={definitionType} onChange={(event) => { const type = event.target.value as RuleDefinitionType; setDefinitionType(type); setDiagnostics([]); const resolutionTypes: RuleDefinitionType[] = ['modifier', 'check', 'resource', 'effect', 'event', 'operation']; setResolutionDraft(resolutionTypes.includes(type) ? defaultResolutionDraft(type as ResolutionAuthoringDraft['kind']) : undefined); setTemplateDraft(type === 'template' ? defaultTemplateDraft() : undefined); if (type === 'field') { setBody(JSON.stringify({ label: name.trim() }, null, 2)); setBodyLabelSynced(true); } else { setBodyLabelSynced(false); } }}>{ruleDefinitionTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
        {!onVisibilityChange && <label className="guided-rule-checkbox rule-set-field"><input type="checkbox" checked={visibility === 'exported'} onChange={(e) => setVisibility(e.target.checked ? 'exported' : 'private')} /><span>Visible</span></label>}
        {definitionType === 'trait' && <label className="rule-set-field"><span>Authoring experience</span><select value={authoringExperience} onChange={(event) => {
          const experience = event.target.value as 'grants' | 'vision' | 'running' | 'advanced';
          setAuthoringExperience(experience);
          setDiagnostics([]);
          if (experience === 'grants') {
            setGrantsDraft([]);
          } else if (experience === 'vision' || experience === 'running') {
            setGuidedDraft(defaultGuidedTraitDraft(experience));
            if (!name.trim() || name === 'Vision' || name === 'Running') setName(experience === 'vision' ? 'Vision' : 'Running');
          }
        }}><option value="grants">Grants editor</option><option value="vision">Guided visual-perception trait</option><option value="running">Guided running trait</option><option value="advanced">Advanced JSON draft</option></select></label>}
        <label className="rule-set-field rule-set-field-wide"><span>Description</span><textarea maxLength={20000} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Explain what this rule means and when it applies." /></label>
        <div className="rule-set-field rule-set-field-wide"><span>Tags</span><TagEditor tags={tags} onChange={setTags} knownTags={[...new Set(definitions.flatMap((d) => d.tags))].sort()} /></div>
        {definitionType === 'trait' && authoringExperience === 'grants'
          ? <GuidedTraitGrantsEditor
              traitName={name}
              grants={grantsDraft}
              prerequisites={prerequisitesDraft}
              traitDefinitions={definitions.filter((d) => d.definitionType === 'trait')}
              onChange={setGrantsDraft}
              onPrerequisitesChange={setPrerequisitesDraft}
            />
          : definitionType === 'trait' && authoringExperience !== 'advanced'
          ? <GuidedTraitEditor description={description} diagnostics={diagnostics} draft={guidedDraft} name={name} onChange={setGuidedDraft} />
          : templateDraft
            ? <GuidedTemplateEditor description={description} diagnostics={diagnostics} draft={templateDraft} name={name} onChange={setTemplateDraft} />
            : resolutionDraft
              ? <GuidedResolutionEditor description={description} diagnostics={diagnostics} draft={resolutionDraft} name={name} onChange={setResolutionDraft} relatedBodies={definitions.map((item) => item.body)} />
              : <label className="rule-set-field rule-set-field-wide"><span>Rule data (JSON)</span><textarea className="rule-set-json-field" rows={7} value={body} onChange={(event) => { setBody(event.target.value); setBodyLabelSynced(false); }} spellCheck={false} /><small>Advanced structured data interpreted by this definition type. An empty object is valid for an initial draft.</small></label>}
      </div>
      {error && <p className="rule-set-notice error" role="alert">{error}</p>}
      <div className="rule-set-form-actions"><button className="secondary-action" type="button" onClick={onCancel}>Cancel</button><button className="primary-action" type="submit" disabled={submitting || !moduleId}>{submitting ? 'Creating…' : 'Create definition'}</button></div>
    </form>
  );
}

type EditFormProps<T> = {
  artifact: T;
  onCancel: () => void;
  onDelete: () => Promise<void>;
  onSaved: (resource: T) => void;
  ruleSetId: number;
};

export function RuleModuleEditForm({ artifact, onCancel, onDelete, onSaved, ruleSetId }: EditFormProps<RuleModuleResource>) {
  const [name, setName] = useState(artifact.name);
  const [namespace, setNamespace] = useState(artifact.namespace);
  const [description, setDescription] = useState(artifact.description ?? '');
  const [sortOrder, setSortOrder] = useState(String(artifact.sortOrder));
  const [requiredEngineFeatureLevel, setRequiredEngineFeatureLevel] = useState(artifact.requiredEngineFeatureLevel);
  const [dependencies, setDependencies] = useState(JSON.stringify(artifact.dependencies, null, 2));
  const [exportsValue, setExportsValue] = useState(JSON.stringify(artifact.exports, null, 2));
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    let parsedDependencies: unknown;
    let parsedExports: unknown;
    try {
      parsedDependencies = JSON.parse(dependencies);
      parsedExports = JSON.parse(exportsValue);
    } catch {
      setError('Dependencies and exports must be valid JSON arrays.');
      return;
    }
    if (!Array.isArray(parsedDependencies) || !Array.isArray(parsedExports)) {
      setError('Dependencies and exports must be JSON arrays.');
      return;
    }
    setSubmitting(true);
    try {
      const module = await updateRuleModule(ruleSetId, artifact.id, {
        description: description.trim(),
        dependencies: parsedDependencies,
        expectedUpdatedAt: artifact.updatedAt,
        exports: parsedExports,
        name: name.trim(),
        namespace,
        requiredEngineFeatureLevel: requiredEngineFeatureLevel.trim(),
        sortOrder: Number(sortOrder),
      });
      onSaved(module);
    } catch (cause) {
      setError(cause instanceof RuleSetApiError ? cause.message : 'The module could not be saved.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="rule-set-child-form rule-set-artifact-editor" onSubmit={submit}>
      <div className="rule-set-editor-heading"><div><span className="eyebrow">Edit or rename module</span><h4>{artifact.name}</h4></div><span className="badge">{artifact.status}</span></div>
      <div className="rule-set-form-grid">
        <label className="rule-set-field"><span>Name</span><input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} autoFocus /></label>
        <label className="rule-set-field"><span>Namespace</span><input required maxLength={120} pattern="[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*" value={namespace} onChange={(event) => setNamespace(event.target.value.toLowerCase())} /></label>
        <label className="rule-set-field"><span>Sort order</span><input required type="number" min={0} max={100000} value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} /></label>
        <label className="rule-set-field"><span>Engine feature level</span><input required maxLength={64} value={requiredEngineFeatureLevel} onChange={(event) => setRequiredEngineFeatureLevel(event.target.value)} /></label>
        <label className="rule-set-field rule-set-field-wide"><span>Description</span><textarea maxLength={20000} rows={4} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <label className="rule-set-field"><span>Dependencies (JSON)</span><textarea className="rule-set-json-field" rows={6} value={dependencies} onChange={(event) => setDependencies(event.target.value)} spellCheck={false} /></label>
        <label className="rule-set-field"><span>Exports (JSON)</span><textarea className="rule-set-json-field" rows={6} value={exportsValue} onChange={(event) => setExportsValue(event.target.value)} spellCheck={false} /></label>
      </div>
      {error && <p className="rule-set-notice error" role="alert">{error}</p>}
      <div className="rule-set-form-actions"><DeleteArtifactButton artifactName={artifact.name} artifactType="module" onDelete={onDelete} /><div className="rule-set-editor-save-actions"><button className="secondary-action" type="button" onClick={onCancel}>Cancel</button><button className="primary-action" type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save module'}</button></div></div>
    </form>
  );
}

type DefinitionEditFormProps = EditFormProps<RuleDefinitionResource> & {
  definitions: RuleDefinitionResource[];
  modules: RuleModuleResource[];
  externalVisibility?: 'exported' | 'private';
  onVisibilityChange?: (v: 'exported' | 'private') => void;
};

export function RuleDefinitionEditForm({ artifact, definitions, modules, onCancel, onDelete, onSaved, ruleSetId, externalVisibility, onVisibilityChange }: DefinitionEditFormProps) {
  const [name, setName] = useState(artifact.name);
  const [description, setDescription] = useState(artifact.description ?? '');
  const [moduleId, setModuleId] = useState(artifact.moduleId);
  const [localVisibility, setLocalVisibility] = useState(artifact.visibility);
  const visibility = externalVisibility ?? localVisibility;
  function setVisibility(v: 'exported' | 'private') {
    if (onVisibilityChange) onVisibilityChange(v); else setLocalVisibility(v);
  }
  const [schemaVersion] = useState(String(artifact.schemaVersion));
  const [tags, setTags] = useState<string[]>(artifact.tags);
  const [body, setBody] = useState(JSON.stringify(artifact.body, null, 2));
  const [guidedDraft, setGuidedDraft] = useState<GuidedTraitDraft | undefined>(() => artifact.definitionType === 'trait' ? guidedTraitDraftFromBody(artifact.body) : undefined);
  const [diagnostics, setDiagnostics] = useState<AuthoringDiagnostic[]>([]);
  const [resolutionDraft, setResolutionDraft] = useState<ResolutionAuthoringDraft | undefined>(() => resolutionDraftFromBody(artifact.body));
  const [templateDraft, setTemplateDraft] = useState<GuidedTemplateDraft | undefined>(() => artifact.definitionType === 'template' ? templateDraftFromBody(artifact.body) : undefined);
  const [instantiationResult, setInstantiationResult] = useState<TemplateInstantiationResult>();
  const [instantiationError, setInstantiationError] = useState<string>();
  const [bulkCreating, setBulkCreating] = useState(false);
  const presentation = JSON.stringify(artifact.presentation ?? {});
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [grantsDraft, setGrantsDraft] = useState<GrantDraft[] | null>(() =>
    artifact.definitionType === 'trait' ? grantsDraftFromBody(artifact.body) : null,
  );
  const [prerequisitesDraft, setPrerequisitesDraft] = useState<PrerequisiteSpec>(() =>
    artifact.definitionType === 'trait' ? prerequisitesDraftFromBody(artifact.body) : { mode: 'any', ids: [] },
  );
  const [conflict, setConflict] = useState<{ serverUpdatedAt: string; serverName: string } | undefined>();
  const [showHistory, setShowHistory] = useState(false);

  async function bulkCreateFromTemplate(result: TemplateInstantiationResult) {
    setBulkCreating(true);
    setInstantiationError(undefined);
    setInstantiationResult(result);
    const failed: string[] = [];
    for (const def of result.definitions) {
      try {
        await createRuleDefinition(ruleSetId, {
          body: def.body,
          definitionType: def.definitionType as RuleDefinitionType,
          description: undefined,
          moduleId: artifact.moduleId,
          name: def.name,
          tags: [],
          visibility: 'exported',
        });
      } catch {
        failed.push(def.name);
      }
    }
    setBulkCreating(false);
    if (failed.length) setInstantiationError(`Failed to create: ${failed.join(', ')}.`);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    let parsedBody: unknown;
    let parsedPresentation: unknown;
    try {
      parsedBody = grantsDraft ? buildGrantsBody(grantsDraft, prerequisitesDraft, definitions.filter((d) => d.definitionType === 'trait' && d.id !== artifact.id)) : guidedDraft ? buildGuidedTraitBody(name, description, guidedDraft) : templateDraft ? buildTemplateBody(name, description, templateDraft) : resolutionDraft ? buildResolutionBody(name, description, resolutionDraft) : JSON.parse(body);
      parsedPresentation = JSON.parse(presentation);
    } catch {
      setError('Rule data and presentation must be valid JSON.');
      return;
    }
    if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody) || !parsedPresentation || typeof parsedPresentation !== 'object' || Array.isArray(parsedPresentation)) {
      setError('Rule data and presentation must be JSON objects.');
      return;
    }

    if (guidedDraft || resolutionDraft) {
      try {
        const related = resolutionDraft ? definitions.filter((item) => item.id !== artifact.id).map((item) => item.body).filter((item) => item.metamodelVersion === 'resolution/1') : [];
        const validation = await validateRuleAuthoringDefinitions([...related, parsedBody as Record<string, unknown>]);
        setDiagnostics(validation.diagnostics);
        if (!validation.valid) {
          setError('Resolve the highlighted rule-data issues before saving this definition.');
          return;
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'The rule could not be validated.');
        return;
      }
    }

    setSubmitting(true);
    setConflict(undefined);
    try {
      const definition = await updateRuleDefinition(ruleSetId, artifact.id, {
        body: parsedBody as Record<string, unknown>,
        description: description.trim(),
        expectedUpdatedAt: conflict?.serverUpdatedAt ?? artifact.updatedAt,
        ...(moduleId !== artifact.moduleId ? { moduleId } : {}),
        name: name.trim(),
        presentation: parsedPresentation as Record<string, unknown>,
        schemaVersion: Number(schemaVersion),
        tags,
        visibility,
      });
      onSaved(definition);
    } catch (cause) {
      if (isStaleError(cause)) {
        const serverUpdatedAt = cause.context.currentUpdatedAt;
        let serverName = artifact.name;
        try {
          const server = await getRuleDefinition(ruleSetId, artifact.id);
          serverName = server.name;
        } catch { /* use fallback */ }
        setConflict({ serverUpdatedAt, serverName });
        setError('This definition was updated by someone else. Review the conflict below before saving.');
      } else {
        setError(cause instanceof RuleSetApiError ? cause.message : 'The definition could not be saved.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="rule-set-child-form rule-set-artifact-editor" onSubmit={submit}>
      <div className="rule-set-editor-heading">
        <div>
          <span className="eyebrow">Edit or rename {artifact.definitionType}</span>
          <h4>{artifact.name}</h4>
          <span className="definition-schema-label">schema version: "{artifact.definitionType}/{schemaVersion}"</span>
        </div>
        <div className="rule-set-editor-heading-right">
          {!onVisibilityChange && <label className="guided-rule-checkbox"><input type="checkbox" checked={visibility === 'exported'} onChange={(e) => setVisibility(e.target.checked ? 'exported' : 'private')} /><span>Visible</span></label>}
          <span className="badge">{artifact.status}</span>
        </div>
      </div>
      <div className="rule-set-form-grid">
        <label className="rule-set-field"><span>Name</span><input required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} autoFocus /></label>
        <label className="rule-set-field"><span>Module</span><select value={moduleId} onChange={(e) => setModuleId(Number(e.target.value))}>{modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <div className="rule-set-field rule-set-field-wide"><span>Tags</span><TagEditor tags={tags} onChange={setTags} knownTags={[...new Set(definitions.flatMap((d) => d.tags))].sort()} /></div>
        <label className="rule-set-field rule-set-field-wide"><span>Description</span><textarea maxLength={20000} rows={4} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        {artifact.definitionType === 'trait' && grantsDraft !== null
          ? <GuidedTraitGrantsEditor
              traitName={name}
              grants={grantsDraft}
              prerequisites={prerequisitesDraft}
              traitDefinitions={definitions.filter((d) => d.definitionType === 'trait' && d.id !== artifact.id)}
              onChange={setGrantsDraft}
              onPrerequisitesChange={setPrerequisitesDraft}
            />
          : artifact.definitionType === 'trait' && !guidedDraft && (
            <div className="guided-rule-conversion rule-set-field-wide">
              <div><strong>Use guided authoring</strong><p>Choose an editor to replace the raw JSON draft. Your current rule data is retained until you save.</p></div>
              <div>
                <button className="secondary-action" type="button" onClick={() => { setGrantsDraft([]); }}>Grants editor</button>
                <button className="secondary-action" type="button" onClick={() => { setGuidedDraft(defaultGuidedTraitDraft('vision')); setDiagnostics([]); }}>Visual perception</button>
                <button className="secondary-action" type="button" onClick={() => { setGuidedDraft(defaultGuidedTraitDraft('running')); setDiagnostics([]); }}>Running movement</button>
              </div>
            </div>
          )}
        {guidedDraft
          ? <><GuidedTraitEditor description={description} diagnostics={diagnostics} draft={guidedDraft} name={name} onChange={setGuidedDraft} /><div className="guided-rule-exit rule-set-field-wide"><button type="button" onClick={() => { setGuidedDraft(undefined); setDiagnostics([]); }}>Return to the advanced draft without saving this guided version</button></div></>
          : templateDraft
            ? <>
                <GuidedTemplateEditor description={description} diagnostics={diagnostics} draft={templateDraft} name={name} onChange={setTemplateDraft} />
                <div className="rule-set-field rule-set-field-wide">
                  <TemplateInstantiationPanel
                    templateBody={buildTemplateBody(name, description, templateDraft)}
                    draft={templateDraft}
                    onDefinitionsReady={bulkCreateFromTemplate}
                  />
                  {bulkCreating && <p className="rule-set-notice">Creating definitions…</p>}
                  {instantiationError && <p className="rule-set-notice error" role="alert">{instantiationError}</p>}
                  {instantiationResult?.valid && !bulkCreating && !instantiationError && <p className="rule-set-notice">Created {instantiationResult.definitions.length} definition{instantiationResult.definitions.length !== 1 ? 's' : ''}.</p>}
                </div>
              </>
            : resolutionDraft
              ? <><GuidedResolutionEditor description={description} diagnostics={diagnostics} draft={resolutionDraft} name={name} onChange={setResolutionDraft} relatedBodies={definitions.map((item) => item.body)} /><div className="guided-rule-exit rule-set-field-wide"><button type="button" onClick={() => { setResolutionDraft(undefined); setDiagnostics([]); }}>Return to the advanced draft without saving this guided version</button></div></>
              : grantsDraft === null
                ? <label className="rule-set-field rule-set-field-wide"><span>Rule data (JSON)</span><textarea className="rule-set-json-field" rows={10} value={body} onChange={(event) => setBody(event.target.value)} spellCheck={false} /></label>
                : null}
      </div>
      {error && <p className="rule-set-notice error" role="alert">{error}</p>}
      {conflict && (
        <div className="rule-set-conflict-panel" role="alert">
          <p className="rule-set-conflict-heading">Conflict: another save was made</p>
          <p className="subtext">The server version is named <strong>{conflict.serverName}</strong>. Your unsaved changes are still in the form above.</p>
          <div className="rule-set-conflict-actions">
            <button
              className="secondary-action"
              type="button"
              onClick={async () => {
                try {
                  const server = await getRuleDefinition(ruleSetId, artifact.id);
                  onSaved(server);
                } catch {
                  setError('Could not reload the server version.');
                }
              }}
            >
              Discard my changes and reload server version
            </button>
            <button
              className="primary-action"
              type="submit"
              disabled={submitting}
            >
              {submitting ? 'Saving…' : 'Force save my version'}
            </button>
          </div>
        </div>
      )}
      <div className="rule-set-form-actions">
        <DeleteArtifactButton artifactName={artifact.name} artifactType="definition" onDelete={onDelete} />
        <div className="rule-set-editor-save-actions">
          <button className="secondary-action" type="button" onClick={() => setShowHistory((v) => !v)}>{showHistory ? 'Hide History' : 'History'}</button>
          <button className="secondary-action" type="button" onClick={onCancel}>Cancel</button>
          {!conflict && <button className="primary-action" type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save definition'}</button>}
        </div>
      </div>
      {showHistory && (
        <RuleDefinitionSnapshotPanel
          ruleSetId={ruleSetId}
          definitionId={artifact.id}
          onRestored={(definition) => onSaved(definition)}
        />
      )}
    </form>
  );
}
