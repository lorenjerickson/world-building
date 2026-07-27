'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppBreadcrumbs } from './app-breadcrumbs';
import { RuleSetSectionNavigation } from './rule-set-section-navigation';
import {
  getRuleSet,
  getRuleSetChildren,
  RuleDefinitionResource,
  RuleModuleResource,
  RuleReleaseResource,
  RuleSetApiError,
  RuleSetResource,
} from '@/lib/rule-sets';

export function RuleSetOverviewRoute({ ruleSetId }: { ruleSetId: string }) {
  const numericId = Number(ruleSetId);
  const invalidId = !Number.isInteger(numericId) || numericId < 1;
  const [ruleSet, setRuleSet] = useState<RuleSetResource>();
  const [modules, setModules] = useState<RuleModuleResource[]>([]);
  const [definitions, setDefinitions] = useState<RuleDefinitionResource[]>([]);
  const [releases, setReleases] = useState<RuleReleaseResource[]>([]);
  const [error, setError] = useState<string>();

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

  if (invalidId) return <main className="dashboard-container"><AppBreadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Rule sets', href: '/rule-sets' }, { label: 'Unavailable' }]} /><p className="rule-set-notice error">This rule-set address is invalid.</p></main>;
  if (error) return <main className="dashboard-container"><AppBreadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Rule sets', href: '/rule-sets' }, { label: 'Unavailable' }]} /><p className="rule-set-notice error">{error}</p></main>;
  if (!ruleSet) return <main className="dashboard-container"><div className="card-surface recent-empty"><p>Loading rule set…</p></div></main>;

  return (
    <main className="dashboard-container rule-set-detail-container">
      <AppBreadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Rule sets', href: '/rule-sets' }, { label: ruleSet.name }]} />
      <RuleSetSectionNavigation active="overview" ruleSetId={numericId} />
      <header className="dashboard-header rule-set-detail-header">
        <div className="header-left"><span className="eyebrow">{ruleSet.status} · {ruleSet.lifecycle}</span><h2>{ruleSet.name}</h2><p>{ruleSet.summary}</p></div>
      </header>
      <section className="rule-set-detail-summary">
        <Link className="card-surface rule-set-summary-link" href={`/rule-sets/${numericId}/modules`}><span className="eyebrow">Modules</span><strong>{modules.length}</strong><p>Namespaces organizing this rule set.</p><span className="text-link">Open modules</span></Link>
        <Link className="card-surface rule-set-summary-link" href={`/rule-sets/${numericId}/definitions`}><span className="eyebrow">Definitions</span><strong>{definitions.length}</strong><p>Traits, operations, effects, and authored rules.</p><span className="text-link">Open definitions</span></Link>
        <article className="card-surface"><span className="eyebrow">Releases</span><strong>{releases.length}</strong><p>{releases[0] ? `Latest: ${releases[0].version}` : 'No immutable release yet.'}</p></article>
      </section>
    </main>
  );
}
