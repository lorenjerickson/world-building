'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import { DeleteArtifactButton } from './delete-artifact-button';
import {
  buildGuidedTraitBody,
  defaultGuidedTraitDraft,
  GuidedTraitDraft,
  GuidedTraitEditor,
  guidedTraitDraftFromBody,
} from './guided-trait-editor';
import { AuthoringDiagnostic, validateRuleAuthoringDefinitions } from '@/lib/rule-authoring';
import { buildResolutionBody, defaultResolutionDraft, GuidedResolutionEditor, ResolutionAuthoringDraft, resolutionDraftFromBody } from './guided-resolution-editor';
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
};

export function RuleDefinitionCreateForm({ definitions, modules, onCancel, onCreated, ruleSetId }: DefinitionFormProps) {
  const [moduleId, setModuleId] = useState(String(modules[0]?.id ?? ''));
  const [definitionType, setDefinitionType] = useState<RuleDefinitionType>('trait');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'exported' | 'private'>('exported');
  const [tags, setTags] = useState('');
  const [body, setBody] = useState('{}');
  const [authoringExperience, setAuthoringExperience] = useState<'vision' | 'running' | 'advanced'>('vision');
  const [guidedDraft, setGuidedDraft] = useState<GuidedTraitDraft>(() => defaultGuidedTraitDraft('vision'));
  const [diagnostics, setDiagnostics] = useState<AuthoringDiagnostic[]>([]);
  const [resolutionDraft, setResolutionDraft] = useState<ResolutionAuthoringDraft>();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    let parsedBody: unknown;
    const guided = definitionType === 'trait' && authoringExperience !== 'advanced';
    if (guided || resolutionDraft) {
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
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
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
        <label className="rule-set-field"><span>Name</span><input required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} placeholder="Clawed" autoFocus /></label>
        <label className="rule-set-field"><span>Module</span><select required value={moduleId} onChange={(event) => setModuleId(event.target.value)}>{modules.map((module) => <option key={module.id} value={module.id}>{module.name} ({module.namespace})</option>)}</select></label>
        <label className="rule-set-field"><span>Definition type</span><select value={definitionType} onChange={(event) => { const type = event.target.value as RuleDefinitionType; setDefinitionType(type); setDiagnostics([]); setResolutionDraft(type === 'check' || type === 'operation' ? defaultResolutionDraft(type) : undefined); }}>{ruleDefinitionTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
        <label className="rule-set-field"><span>Visibility</span><select value={visibility} onChange={(event) => setVisibility(event.target.value as 'exported' | 'private')}><option value="exported">Exported</option><option value="private">Private</option></select></label>
        {definitionType === 'trait' && <label className="rule-set-field rule-set-field-wide"><span>Authoring experience</span><select value={authoringExperience} onChange={(event) => {
          const experience = event.target.value as 'vision' | 'running' | 'advanced';
          setAuthoringExperience(experience);
          setDiagnostics([]);
          if (experience !== 'advanced') {
            setGuidedDraft(defaultGuidedTraitDraft(experience));
            if (!name.trim() || name === 'Vision' || name === 'Running') setName(experience === 'vision' ? 'Vision' : 'Running');
          }
        }}><option value="vision">Guided visual-perception trait</option><option value="running">Guided running trait</option><option value="advanced">Advanced JSON draft</option></select><small>Guided templates produce typed canonical rule data and validate it before saving.</small></label>}
        <label className="rule-set-field rule-set-field-wide"><span>Description</span><textarea maxLength={20000} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Explain what this rule means and when it applies." /></label>
        <label className="rule-set-field rule-set-field-wide"><span>Tags</span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="creature, anatomy" /></label>
        {definitionType === 'trait' && authoringExperience !== 'advanced'
          ? <GuidedTraitEditor description={description} diagnostics={diagnostics} draft={guidedDraft} name={name} onChange={setGuidedDraft} />
          : resolutionDraft
            ? <GuidedResolutionEditor description={description} diagnostics={diagnostics} draft={resolutionDraft} name={name} onChange={setResolutionDraft} relatedBodies={definitions.map((item) => item.body)} />
            : <label className="rule-set-field rule-set-field-wide"><span>Rule data (JSON)</span><textarea className="rule-set-json-field" rows={7} value={body} onChange={(event) => setBody(event.target.value)} spellCheck={false} /><small>Advanced structured data interpreted by this definition type. An empty object is valid for an initial draft.</small></label>}
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
  moduleName: string;
};

export function RuleDefinitionEditForm({ artifact, definitions, moduleName, onCancel, onDelete, onSaved, ruleSetId }: DefinitionEditFormProps) {
  const [name, setName] = useState(artifact.name);
  const [description, setDescription] = useState(artifact.description ?? '');
  const [visibility, setVisibility] = useState(artifact.visibility);
  const [schemaVersion, setSchemaVersion] = useState(String(artifact.schemaVersion));
  const [tags, setTags] = useState(artifact.tags.join(', '));
  const [body, setBody] = useState(JSON.stringify(artifact.body, null, 2));
  const [guidedDraft, setGuidedDraft] = useState<GuidedTraitDraft | undefined>(() => artifact.definitionType === 'trait' ? guidedTraitDraftFromBody(artifact.body) : undefined);
  const [diagnostics, setDiagnostics] = useState<AuthoringDiagnostic[]>([]);
  const [resolutionDraft, setResolutionDraft] = useState<ResolutionAuthoringDraft | undefined>(() => resolutionDraftFromBody(artifact.body));
  const [presentation, setPresentation] = useState(JSON.stringify(artifact.presentation ?? {}, null, 2));
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    let parsedBody: unknown;
    let parsedPresentation: unknown;
    try {
      parsedBody = guidedDraft ? buildGuidedTraitBody(name, description, guidedDraft) : resolutionDraft ? buildResolutionBody(name, description, resolutionDraft) : JSON.parse(body);
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
    try {
      const definition = await updateRuleDefinition(ruleSetId, artifact.id, {
        body: parsedBody as Record<string, unknown>,
        description: description.trim(),
        expectedUpdatedAt: artifact.updatedAt,
        name: name.trim(),
        presentation: parsedPresentation as Record<string, unknown>,
        schemaVersion: Number(schemaVersion),
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        visibility,
      });
      onSaved(definition);
    } catch (cause) {
      setError(cause instanceof RuleSetApiError ? cause.message : 'The definition could not be saved.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="rule-set-child-form rule-set-artifact-editor" onSubmit={submit}>
      <div className="rule-set-editor-heading"><div><span className="eyebrow">Edit or rename {artifact.definitionType}</span><h4>{artifact.name}</h4></div><span className="badge">{artifact.status}</span></div>
      <div className="rule-set-form-grid">
        <label className="rule-set-field"><span>Name</span><input required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} autoFocus /></label>
        <label className="rule-set-field"><span>Module</span><input value={moduleName} disabled title="Clone the definition to move it to another module." /></label>
        <label className="rule-set-field"><span>Definition type</span><input value={artifact.definitionType} disabled /></label>
        <label className="rule-set-field"><span>Visibility</span><select value={visibility} onChange={(event) => setVisibility(event.target.value as 'exported' | 'private')}><option value="exported">Exported</option><option value="private">Private</option></select></label>
        <label className="rule-set-field"><span>Schema version</span><input required type="number" min={1} value={schemaVersion} onChange={(event) => setSchemaVersion(event.target.value)} /></label>
        <label className="rule-set-field"><span>Tags</span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="creature, anatomy" /></label>
        <label className="rule-set-field rule-set-field-wide"><span>Description</span><textarea maxLength={20000} rows={4} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        {artifact.definitionType === 'trait' && !guidedDraft && <div className="guided-rule-conversion rule-set-field-wide"><div><strong>Use guided authoring</strong><p>Convert this draft to a supported creature-capability template. The existing rule data is retained until you save.</p></div><div><button className="secondary-action" type="button" onClick={() => { setGuidedDraft(defaultGuidedTraitDraft('vision')); setDiagnostics([]); }}>Visual perception</button><button className="secondary-action" type="button" onClick={() => { setGuidedDraft(defaultGuidedTraitDraft('running')); setDiagnostics([]); }}>Running movement</button></div></div>}
        {guidedDraft
          ? <><GuidedTraitEditor description={description} diagnostics={diagnostics} draft={guidedDraft} name={name} onChange={setGuidedDraft} /><div className="guided-rule-exit rule-set-field-wide"><button type="button" onClick={() => { setGuidedDraft(undefined); setDiagnostics([]); }}>Return to the advanced draft without saving this guided version</button></div></>
          : resolutionDraft
            ? <><GuidedResolutionEditor description={description} diagnostics={diagnostics} draft={resolutionDraft} name={name} onChange={setResolutionDraft} relatedBodies={definitions.map((item) => item.body)} /><div className="guided-rule-exit rule-set-field-wide"><button type="button" onClick={() => { setResolutionDraft(undefined); setDiagnostics([]); }}>Return to the advanced draft without saving this guided version</button></div></>
          : <label className="rule-set-field rule-set-field-wide"><span>Rule data (JSON)</span><textarea className="rule-set-json-field" rows={10} value={body} onChange={(event) => setBody(event.target.value)} spellCheck={false} /></label>}
        {(guidedDraft || resolutionDraft)
          ? <details className="guided-rule-advanced rule-set-field-wide"><summary>Advanced presentation data</summary><label className="rule-set-field"><span>Presentation (JSON)</span><textarea className="rule-set-json-field" rows={7} value={presentation} onChange={(event) => setPresentation(event.target.value)} spellCheck={false} /></label></details>
          : <label className="rule-set-field rule-set-field-wide"><span>Presentation (JSON)</span><textarea className="rule-set-json-field" rows={7} value={presentation} onChange={(event) => setPresentation(event.target.value)} spellCheck={false} /></label>}
      </div>
      {error && <p className="rule-set-notice error" role="alert">{error}</p>}
      <div className="rule-set-form-actions"><DeleteArtifactButton artifactName={artifact.name} artifactType="definition" onDelete={onDelete} /><div className="rule-set-editor-save-actions"><button className="secondary-action" type="button" onClick={onCancel}>Cancel</button><button className="primary-action" type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save definition'}</button></div></div>
    </form>
  );
}
