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
import {
  deleteRuleSet,
  deleteRuleDefinition,
  deleteRuleModule,
  getRuleSet,
  getRuleSetChildren,
  RuleDefinitionResource,
  RuleModuleResource,
  RuleSetApiError,
  RuleSetResource,
  ruleDefinitionTypes,
} from '@/lib/rule-sets';

type RuleRelease = { id: number; version: string; lifecycle: string; publishedAt: string };
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
  const [releases, setReleases] = useState<RuleRelease[]>([]);
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

  useEffect(() => {
    if (invalidId) return;
    const controller = new AbortController();
    Promise.all([
      getRuleSet(numericId, controller.signal),
      getRuleSetChildren<RuleModuleResource>(numericId, 'modules', controller.signal),
      getRuleSetChildren<RuleDefinitionResource>(numericId, 'definitions', controller.signal),
      getRuleSetChildren<RuleRelease>(numericId, 'releases', controller.signal),
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
      return matchesSearch
        && (definitionModule === 'all' || definition.moduleId === Number(definitionModule))
        && (definitionType === 'all' || definition.definitionType === definitionType)
        && (definitionVisibility === 'all' || definition.visibility === definitionVisibility)
        && (definitionStatus === 'all' || definition.status === definitionStatus);
    });
  }, [definitionModule, definitionSearch, definitionStatus, definitionType, definitionVisibility, definitions]);

  if (invalidId) return <main className="dashboard-container"><header className="dashboard-header"><div className="header-left"><span className="eyebrow">Rule set</span><h2>Unable to open rule set</h2></div><Link href="/rule-sets" className="secondary-action">Back to rule sets</Link></header><p className="rule-set-notice error">This rule-set address is invalid.</p></main>;
  if (error) return <main className="dashboard-container"><header className="dashboard-header"><div className="header-left"><span className="eyebrow">Rule set</span><h2>Unable to open rule set</h2></div><Link href="/rule-sets" className="secondary-action">Back to rule sets</Link></header><p className="rule-set-notice error">{error}</p></main>;
  if (!ruleSet) return <main className="dashboard-container"><div className="card-surface recent-empty"><p>Loading rule set…</p></div></main>;

  return (
    <main className="dashboard-container rule-set-detail-container">
      <header className="dashboard-header rule-set-detail-header" style={{ borderBottomColor: ruleSet.dashboard.accentColor || '#e5b64c' }}>
        <div className="header-left"><span className="eyebrow">{ruleSet.status} · {ruleSet.lifecycle}</span><h2>{ruleSet.name}</h2><p>{ruleSet.summary}</p></div>
        <div className="section-actions"><Link href="/rule-sets" className="secondary-action">Back to rule sets</Link><DeleteArtifactButton artifactName={ruleSet.name} artifactType="rule set" disabled={releases.length > 0} onDelete={async () => { await deleteRuleSet(ruleSet); router.replace('/rule-sets'); router.refresh(); }} /></div>
      </header>
      {releases.length > 0 && <p className="rule-set-notice">Published rule sets are immutable and must be retired instead of deleted.</p>}
      <section className="rule-set-detail-summary">
        <article className="card-surface"><span className="eyebrow">Modules</span><strong>{modules.length}</strong><p>Namespaces organizing this rule set.</p></article>
        <article className="card-surface"><span className="eyebrow">Definitions</span><strong>{definitions.length}</strong><p>Traits, operations, effects, and other authored rules.</p></article>
        <article className="card-surface"><span className="eyebrow">Releases</span><strong>{releases.length}</strong><p>Immutable versions available for future compositions.</p></article>
      </section>
      <div className="rule-set-detail-grid">
        <section className="card-surface rule-set-child-section">
          <div className="section-title-bar"><div className="rule-set-panel-title"><h3>Modules</h3><span>{filteredModules.length} of {modules.length}</span></div><button className="secondary-action compact-action" type="button" onClick={() => { setEditing(undefined); setAuthoring(authoring === 'module' ? undefined : 'module'); }}>{authoring === 'module' ? 'Close' : 'New module'}</button></div>
          {authoring === 'module' && <RuleModuleCreateForm ruleSetId={numericId} onCancel={() => setAuthoring(undefined)} onCreated={(module) => { setModules((current) => [...current, module].sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))); setAuthoring(undefined); }} />}
          {editing?.kind === 'module' && <RuleModuleEditForm key={editing.artifact.id} artifact={editing.artifact} ruleSetId={numericId} onCancel={() => setEditing(undefined)} onDelete={async () => { await deleteRuleModule(numericId, editing.artifact); setModules((current) => current.filter((module) => module.id !== editing.artifact.id)); setEditing(undefined); }} onSaved={(saved) => { setModules((current) => current.map((module) => module.id === saved.id ? saved : module).sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))); setEditing(undefined); }} />}
          {!!modules.length && <div className="rule-set-list-tools"><label className="rule-set-filter-search"><span>Search modules</span><input type="search" value={moduleSearch} onChange={(event) => setModuleSearch(event.target.value)} placeholder="Name, namespace, or description" /></label><label><span>Status</span><select value={moduleStatus} onChange={(event) => setModuleStatus(event.target.value)}><option value="all">All statuses</option><option value="draft">Draft</option><option value="published">Published</option></select></label></div>}
          <div className="list-stack">{filteredModules.map((module) => <div className="list-item" key={module.id}><div className="rule-set-artifact-row"><button className="rule-set-artifact-link" type="button" onClick={() => { setAuthoring(undefined); setEditing({ kind: 'module', artifact: module }); }}>{module.name}</button><span className="subtext">{module.namespace} · {module.status}</span></div></div>)}{!modules.length && <p className="subtext">No modules have been authored yet. Create one before defining rules.</p>}{!!modules.length && !filteredModules.length && <p className="subtext rule-set-no-results">No modules match the current search and filters.</p>}</div>
        </section>
        <section className="card-surface rule-set-child-section">
          <div className="section-title-bar"><div className="rule-set-panel-title"><h3>Definitions</h3><span>{filteredDefinitions.length} of {definitions.length}</span></div><button className="secondary-action compact-action" type="button" disabled={!modules.length} title={!modules.length ? 'Create a module first' : undefined} onClick={() => { setEditing(undefined); setAuthoring(authoring === 'definition' ? undefined : 'definition'); }}>{authoring === 'definition' ? 'Close' : 'New definition'}</button></div>
          {authoring === 'definition' && <RuleDefinitionCreateForm definitions={definitions} modules={modules} ruleSetId={numericId} onCancel={() => setAuthoring(undefined)} onCreated={(definition) => { setDefinitions((current) => [...current, definition].sort((left, right) => left.name.localeCompare(right.name))); setAuthoring(undefined); }} />}
          {editing?.kind === 'definition' && <RuleDefinitionEditForm key={editing.artifact.id} artifact={editing.artifact} definitions={definitions} moduleName={modules.find((module) => module.id === editing.artifact.moduleId)?.name ?? 'Unknown module'} ruleSetId={numericId} onCancel={() => setEditing(undefined)} onDelete={async () => { await deleteRuleDefinition(numericId, editing.artifact); setDefinitions((current) => current.filter((definition) => definition.id !== editing.artifact.id)); setEditing(undefined); }} onSaved={(saved) => { setDefinitions((current) => current.map((definition) => definition.id === saved.id ? saved : definition).sort((left, right) => left.name.localeCompare(right.name))); setEditing(undefined); }} />}
          {!!definitions.length && <div className="rule-set-list-tools rule-set-definition-filters"><label className="rule-set-filter-search"><span>Search definitions</span><input type="search" value={definitionSearch} onChange={(event) => setDefinitionSearch(event.target.value)} placeholder="Name, description, type, or tag" /></label><label><span>Module</span><select value={definitionModule} onChange={(event) => setDefinitionModule(event.target.value)}><option value="all">All modules</option>{modules.map((module) => <option key={module.id} value={module.id}>{module.name}</option>)}</select></label><label><span>Type</span><select value={definitionType} onChange={(event) => setDefinitionType(event.target.value)}><option value="all">All types</option>{ruleDefinitionTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label><label><span>Visibility</span><select value={definitionVisibility} onChange={(event) => setDefinitionVisibility(event.target.value)}><option value="all">All visibility</option><option value="exported">Exported</option><option value="private">Private</option></select></label><label><span>Status</span><select value={definitionStatus} onChange={(event) => setDefinitionStatus(event.target.value)}><option value="all">All statuses</option><option value="draft">Draft</option><option value="published">Published</option></select></label></div>}
          <div className="list-stack">{filteredDefinitions.map((definition) => <div className="list-item" key={definition.id}><div className="rule-set-artifact-row"><button className="rule-set-artifact-link" type="button" onClick={() => { setAuthoring(undefined); setEditing({ kind: 'definition', artifact: definition }); }}>{definition.name}</button><span className="subtext">{definition.definitionType} · {definition.status}</span></div></div>)}{!definitions.length && <p className="subtext">{modules.length ? 'No rules have been defined yet.' : 'Definitions become available after the first module is created.'}</p>}{!!definitions.length && !filteredDefinitions.length && <p className="subtext rule-set-no-results">No definitions match the current search and filters.</p>}</div>
        </section>
      </div>
    </main>
  );
}
