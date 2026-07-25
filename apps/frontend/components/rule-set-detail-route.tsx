'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { DeleteArtifactButton } from './delete-artifact-button';
import {
  RuleDefinitionCreateForm,
  RuleDefinitionEditForm,
  RuleModuleCreateForm,
  RuleModuleEditForm,
} from './rule-set-child-create-forms';
import { RuleAssistantPanel } from './rule-assistant-panel';
import { RuleSetImportModal } from './rule-set-import-modal';
import {
  deleteRuleSet,
  deleteRuleDefinition,
  deleteRuleModule,
  exportRuleSet,
  getRuleSet,
  getRuleSetChildren,
  publishRuleSet,
  RuleDefinitionResource,
  RuleModuleResource,
  RuleReleaseResource,
  RuleSetApiError,
  RuleSetResource,
  ruleDefinitionTypes,
} from '@/lib/rule-sets';

type EditingArtifact =
  | { kind: 'definition'; artifact: RuleDefinitionResource }
  | { kind: 'module'; artifact: RuleModuleResource };

export function RuleSetDetailRoute({ ruleSetId }: { ruleSetId: string }) {
  const router = useRouter();
  const numericId = Number(ruleSetId);
  const invalidId = !Number.isInteger(numericId) || numericId < 1;
  const [ruleSet, setRuleSet] = useState<RuleSetResource>();
  const [modules, setModules] = useState<RuleModuleResource[]>([]);
  const [definitions, setDefinitions] = useState<RuleDefinitionResource[]>([]);
  const [releases, setReleases] = useState<RuleReleaseResource[]>([]);
  const [error, setError] = useState<string>();
  const [authoring, setAuthoring] = useState<'module' | 'definition'>();
  const [editing, setEditing] = useState<EditingArtifact>();
  const [moduleSearch, setModuleSearch] = useState('');
  const [moduleStatus, setModuleStatus] = useState('all');
  const [definitionSearch, setDefinitionSearch] = useState('');
  const [definitionModule, setDefinitionModule] = useState('all');
  const [definitionType, setDefinitionType] = useState('all');
  const [definitionVisibility, setDefinitionVisibility] = useState('all');
  const [definitionStatus, setDefinitionStatus] = useState('all');
  const [selectedModuleId, setSelectedModuleId] = useState<number | null>(null);
  const [showAssistant, setShowAssistant] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [publishVersion, setPublishVersion] = useState('1.0.0');
  const [releaseNotes, setReleaseNotes] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string>();
  const [exporting, setExporting] = useState(false);
  const [definitionVisibilityDraft, setDefinitionVisibilityDraft] = useState<'exported' | 'private'>('exported');

  useEffect(() => {
    if (invalidId) return;
    const controller = new AbortController();
    Promise.all([
      getRuleSet(numericId, controller.signal),
      getRuleSetChildren<RuleModuleResource>(numericId, 'modules', controller.signal),
      getRuleSetChildren<RuleDefinitionResource>(numericId, 'definitions', controller.signal),
      getRuleSetChildren<RuleReleaseResource>(numericId, 'releases', controller.signal),
    ]).then(([ruleSetResult, moduleResult, definitionResult, releaseResult]) => {
      setRuleSet(ruleSetResult);
      setModules(moduleResult);
      setDefinitions(definitionResult);
      setReleases(releaseResult);
    }).catch((cause) => {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof RuleSetApiError ? cause.message : 'The rule set could not be loaded.');
    });
    return () => controller.abort();
  }, [invalidId, numericId]);

  const filteredModules = useMemo(() => {
    const search = moduleSearch.trim().toLowerCase();
    return modules.filter((module) => {
      const matchesSearch = !search || [module.name, module.namespace, module.description ?? ''].some((value) => value.toLowerCase().includes(search));
      return matchesSearch && (moduleStatus === 'all' || module.status === moduleStatus);
    });
  }, [moduleSearch, moduleStatus, modules]);

  const filteredDefinitions = useMemo(() => {
    const search = definitionSearch.trim().toLowerCase();
    return definitions.filter((definition) => {
      const matchesSearch = !search || [definition.name, definition.description ?? '', definition.definitionType, ...definition.tags].some((value) => value.toLowerCase().includes(search));
      // selectedModuleId (left-panel selection) takes precedence over the module dropdown
      const matchesModule = selectedModuleId != null
        ? definition.moduleId === selectedModuleId
        : definitionModule === 'all' || definition.moduleId === Number(definitionModule);
      return matchesSearch
        && matchesModule
        && (definitionType === 'all' || definition.definitionType === definitionType)
        && (definitionVisibility === 'all' || definition.visibility === definitionVisibility)
        && (definitionStatus === 'all' || definition.status === definitionStatus);
    });
  }, [definitionModule, definitionSearch, definitionStatus, definitionType, definitionVisibility, definitions, selectedModuleId]);

  if (invalidId) return <main className="dashboard-container"><header className="dashboard-header"><div className="header-left"><span className="eyebrow">Rule set</span><h2>Unable to open rule set</h2></div><Link href="/rule-sets" className="secondary-action">Back to rule sets</Link></header><p className="rule-set-notice error">This rule-set address is invalid.</p></main>;
  if (error) return <main className="dashboard-container"><header className="dashboard-header"><div className="header-left"><span className="eyebrow">Rule set</span><h2>Unable to open rule set</h2></div><Link href="/rule-sets" className="secondary-action">Back to rule sets</Link></header><p className="rule-set-notice error">{error}</p></main>;
  if (!ruleSet) return <main className="dashboard-container"><div className="card-surface recent-empty"><p>Loading rule set…</p></div></main>;

  return (
    <main className="dashboard-container rule-set-detail-container">
      <header className="dashboard-header rule-set-detail-header" style={{ borderBottomColor: ruleSet.dashboard.accentColor || '#e5b64c' }}>
        <div className="header-left"><span className="eyebrow">{ruleSet.status} · {ruleSet.lifecycle}</span><h2>{ruleSet.name}</h2><p>{ruleSet.summary}</p></div>
        <div className="section-actions">
          <Link href="/rule-sets" className="secondary-action">Back to rule sets</Link>
          <button type="button" className="secondary-action" disabled={exporting} onClick={async () => { setExporting(true); try { const bundle = await exportRuleSet(numericId); const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${ruleSet.slug || ruleSet.name.toLowerCase().replace(/\s+/g, '-')}-export.json`; a.click(); URL.revokeObjectURL(url); } catch (cause) { /* silently ignore */ } finally { setExporting(false); } }}>{exporting ? 'Exporting…' : 'Export'}</button>
          <button type="button" className="secondary-action" onClick={() => setShowImport((v) => !v)}>{showImport ? 'Cancel import' : 'Import'}</button>
          <button type="button" className="primary-action" disabled={!modules.length || !definitions.length}
            title={!modules.length || !definitions.length ? 'Add at least one module and definition before publishing.' : undefined}
            onClick={() => {
              setShowPublish((visible) => !visible);
              setPublishError(undefined);
              const versions = releases
                .map((release) => release.version.match(/^(\d+)\.(\d+)\.(\d+)$/))
                .filter((match): match is RegExpMatchArray => match !== null)
                .map((match) => [Number(match[1]), Number(match[2]), Number(match[3])] as const)
                .sort((left, right) => right[0] - left[0] || right[1] - left[1] || right[2] - left[2]);
              const latest = versions[0];
              setPublishVersion(latest ? `${latest[0]}.${latest[1]}.${latest[2] + 1}` : '1.0.0');
            }}>
            {showPublish ? 'Cancel publish' : 'Publish'}
          </button>
          <DeleteArtifactButton artifactName={ruleSet.name} artifactType="rule set" disabled={releases.length > 0} onDelete={async () => { await deleteRuleSet(ruleSet); router.replace('/rule-sets'); router.refresh(); }} />
        </div>
      </header>
      {releases.length > 0 && <p className="rule-set-notice">Published rule sets are immutable and must be retired instead of deleted.</p>}
      {showPublish && (
        <form className="card-surface rule-set-child-form" onSubmit={async (event) => {
          event.preventDefault();
          setPublishing(true);
          setPublishError(undefined);
          try {
            const release = await publishRuleSet(ruleSet, {
              version: publishVersion.trim(),
              releaseNotes: releaseNotes.trim() || undefined,
            });
            setReleases((current) => [
              release,
              ...current.filter((candidate) => candidate.id !== release.id),
            ].sort((left, right) => right.publishedAt.localeCompare(left.publishedAt)));
            setShowPublish(false);
            setReleaseNotes('');
          } catch (cause) {
            if (cause instanceof RuleSetApiError) {
              const diagnostics = Array.isArray(cause.context.diagnostics)
                ? cause.context.diagnostics as Array<{ message?: unknown }>
                : [];
              const firstDiagnostic = diagnostics.find((diagnostic) => typeof diagnostic.message === 'string');
              setPublishError(typeof firstDiagnostic?.message === 'string' ? firstDiagnostic.message : cause.message);
            } else {
              setPublishError('The rule set could not be published.');
            }
          } finally {
            setPublishing(false);
          }
        }}>
          <div className="section-title-bar">
            <div className="rule-set-panel-title"><h3>Publish immutable release</h3><span>Compile and snapshot the current draft</span></div>
          </div>
          <div className="rule-set-form-grid">
            <label className="rule-set-field"><span>Semantic version</span><input required maxLength={80}
              pattern="^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
              value={publishVersion} onChange={(event) => setPublishVersion(event.target.value)} placeholder="1.0.0" /></label>
            <label className="rule-set-field rule-set-field-wide"><span>Release notes</span><textarea rows={3} maxLength={20000}
              value={releaseNotes} onChange={(event) => setReleaseNotes(event.target.value)}
              placeholder="What changed in this release?" /></label>
          </div>
          <p className="subtext">Publishing validates every definition, resolves the complete trait graph, and stores a content-addressed source snapshot. The resulting release cannot be edited or deleted.</p>
          {publishError && <p className="rule-set-notice error" role="alert">{publishError}</p>}
          <div className="rule-set-form-actions">
            <button className="secondary-action" type="button" onClick={() => setShowPublish(false)}>Cancel</button>
            <button className="primary-action" type="submit" disabled={publishing}>{publishing ? 'Compiling…' : `Publish ${publishVersion || 'release'}`}</button>
          </div>
        </form>
      )}
      {showImport && <RuleSetImportModal ruleSetId={numericId} onClose={() => setShowImport(false)} onImported={(result) => { if (result.definitionsCreated > 0) { getRuleSetChildren<RuleDefinitionResource>(numericId, 'definitions').then(setDefinitions).catch(() => {}); getRuleSetChildren<RuleModuleResource>(numericId, 'modules').then(setModules).catch(() => {}); } }} />}
      <section className="rule-set-detail-summary">
        <article className="card-surface"><span className="eyebrow">Modules</span><strong>{modules.length}</strong><p>Namespaces organizing this rule set.</p></article>
        <article className="card-surface"><span className="eyebrow">Definitions</span><strong>{definitions.length}</strong><p>Traits, operations, effects, and other authored rules.</p></article>
        <article className="card-surface"><span className="eyebrow">Releases</span><strong>{releases.length}</strong><p>{releases[0] ? `Latest: ${releases[0].version}` : 'Immutable versions available for future compositions.'}</p></article>
      </section>
      <div className="rule-set-detail-grid">
        <section className="card-surface rule-set-child-section">
          <div className="section-title-bar"><div className="rule-set-panel-title"><h3>Modules</h3><span>{filteredModules.length} of {modules.length}</span></div><button className="secondary-action compact-action" type="button" onClick={() => { setEditing(undefined); setAuthoring(authoring === 'module' ? undefined : 'module'); }}>{authoring === 'module' ? 'Close' : 'New module'}</button></div>
          {authoring === 'module' && <RuleModuleCreateForm ruleSetId={numericId} onCancel={() => setAuthoring(undefined)} onCreated={(module) => { setModules((current) => [...current, module].sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))); setAuthoring(undefined); }} />}
          {editing?.kind === 'module' && <RuleModuleEditForm key={editing.artifact.id} artifact={editing.artifact} ruleSetId={numericId} onCancel={() => setEditing(undefined)} onDelete={async () => { await deleteRuleModule(numericId, editing.artifact); setModules((current) => current.filter((module) => module.id !== editing.artifact.id)); setEditing(undefined); }} onSaved={(saved) => { setModules((current) => current.map((module) => module.id === saved.id ? saved : module).sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))); setEditing(undefined); }} />}
          {!!modules.length && <div className="rule-set-list-tools"><label className="rule-set-filter-search"><span>Search modules</span><input type="search" value={moduleSearch} onChange={(event) => setModuleSearch(event.target.value)} placeholder="Name, namespace, or description" /></label><label><span>Status</span><select value={moduleStatus} onChange={(event) => setModuleStatus(event.target.value)}><option value="all">All statuses</option><option value="draft">Draft</option><option value="published">Published</option></select></label></div>}
          <div className="list-stack">{filteredModules.map((module) => {
            const isSelected = selectedModuleId === module.id;
            const isEditing = editing?.kind === 'module' && editing.artifact.id === module.id;
            return (
              <div
                className={`list-item${isEditing ? ' is-module-editing' : isSelected ? ' is-module-selected' : ''}`}
                key={module.id}
                style={{ cursor: 'pointer' }}
                onClick={() => setSelectedModuleId((id) => id === module.id ? null : module.id)}
              >
                <div className="rule-set-artifact-row">
                  <button className="rule-set-artifact-link" type="button" onClick={(e) => { e.stopPropagation(); setSelectedModuleId(module.id); setAuthoring(undefined); setEditing({ kind: 'module', artifact: module }); }}>{module.name}</button>
                  <span className="subtext">{module.namespace} · {module.status}</span>
                </div>
              </div>
            );
          })}{!modules.length && <p className="subtext">No modules have been authored yet. Create one before defining rules.</p>}{!!modules.length && !filteredModules.length && <p className="subtext rule-set-no-results">No modules match the current search and filters.</p>}</div>
        </section>
        <section className="card-surface rule-set-child-section">
          <div className="section-title-bar"><div className="rule-set-panel-title"><h3>Definitions</h3><span>{filteredDefinitions.length} of {definitions.length}</span></div><div className="section-actions-group">{(authoring === 'definition' || editing?.kind === 'definition') && <label className="guided-rule-checkbox"><input type="checkbox" checked={definitionVisibilityDraft === 'exported'} onChange={(e) => setDefinitionVisibilityDraft(e.target.checked ? 'exported' : 'private')} /><span>Visible</span></label>}<button className="secondary-action compact-action" type="button" disabled={!modules.length} title={!modules.length ? 'Create a module first' : undefined} onClick={() => { setEditing(undefined); setShowAssistant(false); setDefinitionVisibilityDraft('exported'); setAuthoring(authoring === 'definition' ? undefined : 'definition'); }}>{authoring === 'definition' ? 'Close' : 'New definition'}</button><button className="secondary-action compact-action" type="button" disabled={!modules.length} title={!modules.length ? 'Create a module first' : undefined} onClick={() => { setEditing(undefined); setAuthoring(undefined); setShowAssistant((v) => !v); }}>{showAssistant ? 'Close assistant' : 'AI assistant'}</button></div></div>
          {authoring === 'definition' && <RuleDefinitionCreateForm definitions={definitions} modules={modules} ruleSetId={numericId} selectedModuleId={selectedModuleId} externalVisibility={definitionVisibilityDraft} onVisibilityChange={setDefinitionVisibilityDraft} onCancel={() => setAuthoring(undefined)} onCreated={(definition) => { setDefinitions((current) => [...current, definition].sort((left, right) => left.name.localeCompare(right.name))); setAuthoring(undefined); }} />}
          {showAssistant && modules.length > 0 && <RuleAssistantPanel ruleSetId={numericId} moduleId={modules[0].id} contextDefinitions={definitions.map((d) => d.body)} onDefinitionCreated={(definition) => setDefinitions((current) => [...current, definition].sort((left, right) => left.name.localeCompare(right.name)))} />}
          {editing?.kind === 'definition' && <RuleDefinitionEditForm key={editing.artifact.id} artifact={editing.artifact} definitions={definitions} modules={modules} ruleSetId={numericId} externalVisibility={definitionVisibilityDraft} onVisibilityChange={setDefinitionVisibilityDraft} onCancel={() => setEditing(undefined)} onDelete={async () => { await deleteRuleDefinition(numericId, editing.artifact); setDefinitions((current) => current.filter((definition) => definition.id !== editing.artifact.id)); setEditing(undefined); }} onSaved={(saved) => { setDefinitions((current) => current.map((definition) => definition.id === saved.id ? saved : definition).sort((left, right) => left.name.localeCompare(right.name))); setEditing(undefined); }} />}
          {selectedModuleId != null && (() => { const m = modules.find((mod) => mod.id === selectedModuleId); return m ? <div className="rule-set-module-scope"><span>Showing <strong>{m.name}</strong></span><button type="button" title="Show all modules" onClick={() => setSelectedModuleId(null)}>×</button></div> : null; })()}
          {!!definitions.length && <div className={`rule-set-list-tools${selectedModuleId != null ? ' rule-set-definition-filters-scoped' : ' rule-set-definition-filters'}`}><label className="rule-set-filter-search"><span>Search definitions</span><input type="search" value={definitionSearch} onChange={(event) => setDefinitionSearch(event.target.value)} placeholder="Name, description, type, or tag" /></label>{selectedModuleId == null && <label><span>Module</span><select value={definitionModule} onChange={(event) => setDefinitionModule(event.target.value)}><option value="all">All modules</option>{modules.map((module) => <option key={module.id} value={module.id}>{module.name}</option>)}</select></label>}<label><span>Type</span><select value={definitionType} onChange={(event) => setDefinitionType(event.target.value)}><option value="all">All types</option>{ruleDefinitionTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label><label><span>Visibility</span><select value={definitionVisibility} onChange={(event) => setDefinitionVisibility(event.target.value)}><option value="all">All visibility</option><option value="exported">Exported</option><option value="private">Private</option></select></label><label><span>Status</span><select value={definitionStatus} onChange={(event) => setDefinitionStatus(event.target.value)}><option value="all">All statuses</option><option value="draft">Draft</option><option value="published">Published</option></select></label></div>}
          <div className="list-stack">{filteredDefinitions.map((definition) => <div className="list-item" key={definition.id}><div className="rule-set-artifact-row"><button className="rule-set-artifact-link" type="button" onClick={() => { setAuthoring(undefined); setDefinitionVisibilityDraft(definition.visibility as 'exported' | 'private'); setEditing({ kind: 'definition', artifact: definition }); }}>{definition.name}</button><span className="subtext">{definition.definitionType} · {definition.status}</span></div></div>)}{!definitions.length && <p className="subtext">{modules.length ? 'No rules have been defined yet.' : 'Definitions become available after the first module is created.'}</p>}{!!definitions.length && !filteredDefinitions.length && <p className="subtext rule-set-no-results">No definitions match the current search and filters.</p>}</div>
        </section>
      </div>
    </main>
  );
}
