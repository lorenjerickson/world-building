'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AppBreadcrumbs } from './app-breadcrumbs';
import {
  getRuleSet,
  getRuleSetChildren,
  RuleDefinitionResource,
  RuleModuleResource,
  RuleReleaseResource,
  RuleSetApiError,
  RuleSetResource,
  ruleDefinitionTypes,
} from '@/lib/rule-sets';

export function RuleSetOverviewRoute({ ruleSetId }: { ruleSetId: string }) {
  const numericId = Number(ruleSetId);
  const [ruleSet, setRuleSet] = useState<RuleSetResource>();
  const [modules, setModules] = useState<RuleModuleResource[]>([]);
  const [definitions, setDefinitions] = useState<RuleDefinitionResource[]>([]);
  const [releases, setReleases] = useState<RuleReleaseResource[]>([]);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!Number.isInteger(numericId) || numericId < 1) {
      setError('This rule-set address is invalid.');
      return;
    }
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
  }, [numericId]);

  const filteredDefinitions = useMemo(() => {
    const search = query.trim().toLowerCase();
    return definitions.filter((definition) =>
      (type === 'all' || definition.definitionType === type)
      && (!search || [
        definition.name,
        definition.description ?? '',
        definition.definitionType,
        ...definition.tags,
      ].some((value) => value.toLowerCase().includes(search))));
  }, [definitions, query, type]);

  if (error) return <main className="dashboard-container"><AppBreadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Rule sets', href: '/rule-sets' }, { label: 'Unavailable' }]} /><p className="rule-set-notice error">{error}</p></main>;
  if (!ruleSet) return <main className="dashboard-container"><div className="card-surface recent-empty"><p>Loading rule set…</p></div></main>;

  return (
    <main className="dashboard-container rule-set-detail-container">
      <AppBreadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Rule sets', href: '/rule-sets' }, { label: ruleSet.name }]} />
      <header className="dashboard-header rule-set-detail-header">
        <div className="header-left"><span className="eyebrow">{ruleSet.status} · {ruleSet.lifecycle}</span><h2>{ruleSet.name}</h2><p>{ruleSet.summary}</p></div>
      </header>
      <section className="rule-set-detail-summary">
        <article className="card-surface"><span className="eyebrow">Modules</span><strong>{modules.length}</strong><p>Namespaces organizing this rule set.</p></article>
        <article className="card-surface"><span className="eyebrow">Definitions</span><strong>{definitions.length}</strong><p>Traits, operations, effects, and authored rules.</p></article>
        <article className="card-surface"><span className="eyebrow">Releases</span><strong>{releases.length}</strong><p>{releases[0] ? `Latest: ${releases[0].version}` : 'No immutable release yet.'}</p></article>
      </section>
      <div className="rule-set-overview-columns">
        <section className="card-surface rule-set-child-section">
          <div className="section-title-bar"><div className="rule-set-panel-title"><h3>Modules</h3><span>{modules.length}</span></div><Link className="secondary-action compact-action" href={`/rule-sets/${numericId}/modules/new`}>New module</Link></div>
          <div className="list-stack">{modules.map((module) => (
            <article className="list-item" id={`module-${module.id}`} key={module.id}>
              <Link className="rule-set-artifact-row rule-set-record-link" href={`/rule-sets/${numericId}/modules/${module.id}`}>
                <strong>{module.name}</strong><span className="subtext">{module.namespace} · {module.status}</span>
              </Link>
            </article>
          ))}{!modules.length ? <p className="subtext">No modules have been authored yet.</p> : null}</div>
        </section>
        <section className="card-surface rule-set-child-section">
          <div className="section-title-bar"><div className="rule-set-panel-title"><h3>Definitions</h3><span>{filteredDefinitions.length} of {definitions.length}</span></div><Link className="secondary-action compact-action" href={`/rule-sets/${numericId}/definitions/new`}>New definition</Link></div>
          {definitions.length ? <div className="rule-set-list-tools rule-set-definition-filters">
            <label className="rule-set-filter-search"><span>Filter this list</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, description, type, or tag" /></label>
            <label><span>Type</span><select value={type} onChange={(event) => setType(event.target.value)}><option value="all">All types</option>{ruleDefinitionTypes.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
          </div> : null}
          <div className="list-stack">{filteredDefinitions.map((definition) => (
            <article className="list-item" id={`definition-${definition.id}`} key={definition.id}>
              <Link className="rule-set-artifact-row rule-set-record-link" href={`/rule-sets/${numericId}/definitions/${definition.id}`}>
                <strong>{definition.name}</strong><span className="subtext">{definition.definitionType} · {definition.status}</span>
              </Link>
            </article>
          ))}{!definitions.length ? <p className="subtext">{modules.length ? 'No rules have been defined yet.' : 'Create a module before defining rules.'}</p> : null}</div>
        </section>
      </div>
    </main>
  );
}
