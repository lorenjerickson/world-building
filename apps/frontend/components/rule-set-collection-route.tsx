'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppBreadcrumbs } from './app-breadcrumbs';
import { RuleSetSectionNavigation } from './rule-set-section-navigation';
import {
  getRuleSet,
  getRuleSetChildren,
  RuleDefinitionResource,
  RuleModuleResource,
  RuleSetApiError,
  RuleSetResource,
  ruleDefinitionTypes,
} from '@/lib/rule-sets';

type CollectionKind = 'definitions' | 'modules';
type DefinitionFilters = {
  module: string;
  query: string;
  status: string;
  type: string;
};

const defaultDefinitionFilters: DefinitionFilters = {
  module: 'all',
  query: '',
  status: 'all',
  type: 'all',
};

function definitionFilterStorageKey(ruleSetId: number): string {
  return `wanderlust-vtt:rule-set:${ruleSetId}:definition-filters`;
}

function loadDefinitionFilters(ruleSetId: number): DefinitionFilters {
  try {
    const stored = JSON.parse(sessionStorage.getItem(definitionFilterStorageKey(ruleSetId)) ?? '{}') as Partial<DefinitionFilters>;
    const storedStatus = typeof stored.status === 'string' ? stored.status : '';
    const storedType = typeof stored.type === 'string' ? stored.type : '';
    return {
      module: typeof stored.module === 'string' ? stored.module : defaultDefinitionFilters.module,
      query: typeof stored.query === 'string' ? stored.query : defaultDefinitionFilters.query,
      status: ['all', 'draft', 'published'].includes(storedStatus) ? storedStatus : defaultDefinitionFilters.status,
      type: storedType === 'all' || ruleDefinitionTypes.includes(storedType as typeof ruleDefinitionTypes[number])
        ? storedType
        : defaultDefinitionFilters.type,
    };
  } catch {
    return defaultDefinitionFilters;
  }
}

export function RuleSetCollectionRoute({
  kind,
  ruleSetId,
}: {
  kind: CollectionKind;
  ruleSetId: string;
}) {
  const searchParams = useSearchParams();
  const numericId = Number(ruleSetId);
  const [ruleSet, setRuleSet] = useState<RuleSetResource>();
  const [modules, setModules] = useState<RuleModuleResource[]>([]);
  const [definitions, setDefinitions] = useState<RuleDefinitionResource[]>([]);
  const [query, setQuery] = useState('');
  const [moduleFilter, setModuleFilter] = useState(searchParams.get('module') ?? 'all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [definitionFiltersReady, setDefinitionFiltersReady] = useState(false);
  const [error, setError] = useState<string>();
  const linkedModuleFilter = searchParams.get('module');

  useEffect(() => {
    if (!Number.isInteger(numericId) || numericId < 1) return;
    const controller = new AbortController();
    Promise.all([
      getRuleSet(numericId, controller.signal),
      getRuleSetChildren<RuleModuleResource>(numericId, 'modules', controller.signal),
      getRuleSetChildren<RuleDefinitionResource>(numericId, 'definitions', controller.signal),
    ]).then(([ruleSetResult, moduleResult, definitionResult]) => {
      setRuleSet(ruleSetResult);
      setModules(moduleResult);
      setDefinitions(definitionResult);
    }).catch((cause) => {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof RuleSetApiError ? cause.message : 'The rule-set collection could not be loaded.');
    });
    return () => controller.abort();
  }, [numericId]);

  useEffect(() => {
    if (kind !== 'definitions' || !Number.isInteger(numericId) || numericId < 1) return;
    const stored = loadDefinitionFilters(numericId);
    queueMicrotask(() => {
      setQuery(stored.query);
      setModuleFilter(linkedModuleFilter ?? stored.module);
      setTypeFilter(stored.type);
      setStatusFilter(stored.status);
      setDefinitionFiltersReady(true);
    });
  }, [kind, linkedModuleFilter, numericId]);

  useEffect(() => {
    if (kind !== 'definitions' || !definitionFiltersReady) return;
    sessionStorage.setItem(definitionFilterStorageKey(numericId), JSON.stringify({
      module: moduleFilter,
      query,
      status: statusFilter,
      type: typeFilter,
    } satisfies DefinitionFilters));
  }, [definitionFiltersReady, kind, moduleFilter, numericId, query, statusFilter, typeFilter]);

  const filteredModules = useMemo(() => {
    const search = query.trim().toLowerCase();
    return modules.filter((module) =>
      (statusFilter === 'all' || module.status === statusFilter)
      && (!search || [module.name, module.namespace, module.description ?? '']
        .some((value) => value.toLowerCase().includes(search))));
  }, [modules, query, statusFilter]);

  const filteredDefinitions = useMemo(() => {
    const search = query.trim().toLowerCase();
    return definitions.filter((definition) =>
      (moduleFilter === 'all' || definition.moduleId === Number(moduleFilter))
      && (typeFilter === 'all' || definition.definitionType === typeFilter)
      && (statusFilter === 'all' || definition.status === statusFilter)
      && (!search || [
        definition.name,
        definition.description ?? '',
        definition.definitionType,
        ...definition.tags,
      ].some((value) => value.toLowerCase().includes(search))));
  }, [definitions, moduleFilter, query, statusFilter, typeFilter]);

  if (!Number.isInteger(numericId) || numericId < 1) {
    return <main className="dashboard-container"><AppBreadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Rule sets', href: '/rule-sets' }, { label: 'Unavailable' }]} /><p className="rule-set-notice error">This rule-set address is invalid.</p></main>;
  }
  if (error) return <main className="dashboard-container"><AppBreadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Rule sets', href: '/rule-sets' }, { label: 'Unavailable' }]} /><p className="rule-set-notice error">{error}</p></main>;
  if (!ruleSet) return <main className="dashboard-container"><div className="card-surface recent-empty"><p>Loading {kind}…</p></div></main>;

  const isModules = kind === 'modules';
  const collectionLabel = isModules ? 'Modules' : 'Definitions';
  const records = isModules ? filteredModules : filteredDefinitions;
  const createHref = `/rule-sets/${numericId}/${kind}/new${!isModules && moduleFilter !== 'all' ? `?module=${encodeURIComponent(moduleFilter)}` : ''}`;

  return (
    <main className="dashboard-container rule-set-detail-container">
      <AppBreadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Rule sets', href: '/rule-sets' },
        { label: ruleSet.name, href: `/rule-sets/${numericId}` },
        { label: collectionLabel },
      ]} />
      <RuleSetSectionNavigation active={kind} ruleSetId={numericId} />
      <header className="dashboard-header rule-set-detail-header">
        <div className="header-left">
          <span className="eyebrow">{ruleSet.name}</span>
          <h2>{collectionLabel}</h2>
          <p>{isModules ? 'Manage the namespaces that organize this rule set.' : 'Browse and filter the authored rules in this rule set.'}</p>
        </div>
        <Link className="primary-action" href={createHref}>New {isModules ? 'module' : 'definition'}</Link>
      </header>
      <section className="card-surface rule-set-child-section rule-set-collection-section">
        <div className="section-title-bar">
          <div className="rule-set-panel-title"><h3>{collectionLabel}</h3><span>{records.length} of {isModules ? modules.length : definitions.length}</span></div>
        </div>
        {(isModules ? modules.length : definitions.length) ? (
          <div className={`rule-set-list-tools ${isModules ? 'rule-set-module-collection-filters' : 'rule-set-collection-filters'}`}>
            <label className="rule-set-filter-search">
              <span>Search {kind}</span>
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={isModules ? 'Name, namespace, or description' : 'Name, description, type, or tag'} />
            </label>
            {!isModules ? <label><span>Module</span><select value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)}><option value="all">All modules</option>{modules.map((module) => <option key={module.id} value={module.id}>{module.name}</option>)}</select></label> : null}
            {!isModules ? <label><span>Type</span><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">All types</option>{ruleDefinitionTypes.map((value) => <option value={value} key={value}>{value}</option>)}</select></label> : null}
            <label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="draft">Draft</option><option value="published">Published</option></select></label>
          </div>
        ) : null}
        <div className="list-stack">
          {isModules ? filteredModules.map((module) => (
            <article className="list-item rule-set-collection-row" id={`module-${module.id}`} key={module.id}>
              <Link className="rule-set-artifact-row rule-set-record-link" href={`/rule-sets/${numericId}/modules/${module.id}`}>
                <strong>{module.name}</strong><span className="subtext">{module.namespace} · {module.status}</span>
              </Link>
              <Link className="text-link rule-set-related-link" href={`/rule-sets/${numericId}/definitions?module=${module.id}`}>View definitions</Link>
            </article>
          )) : filteredDefinitions.map((definition) => (
            <article className="list-item" id={`definition-${definition.id}`} key={definition.id}>
              <Link className="rule-set-artifact-row rule-set-record-link" href={`/rule-sets/${numericId}/definitions/${definition.id}`}>
                <strong>{definition.name}</strong><span className="subtext">{definition.definitionType} · {definition.status}</span>
              </Link>
            </article>
          ))}
          {!records.length ? <p className="subtext rule-set-no-results">{(isModules ? modules.length : definitions.length) ? `No ${kind} match the current filters.` : isModules ? 'No modules have been authored yet.' : modules.length ? 'No rules have been defined yet.' : 'Create a module before defining rules.'}</p> : null}
        </div>
      </section>
    </main>
  );
}
