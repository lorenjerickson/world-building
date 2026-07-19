'use client';

import Link from 'next/link';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { RuleSetCreateForm } from './rule-set-create-form';
import { DeleteArtifactButton } from './delete-artifact-button';
import { deleteRuleSet, listRuleSets, RuleSetApiError, RuleSetResource } from '@/lib/rule-sets';

export function RuleSetDashboardSection() {
  const [ruleSets, setRuleSets] = useState<RuleSetResource[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    listRuleSets(3, controller.signal)
      .then((page) => { setRuleSets(page.items); setTotal(page.totalItems); setError(undefined); })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause instanceof RuleSetApiError ? cause.message : 'Rule sets could not be loaded.');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  return (
    <section className="dashboard-section card-surface activity-section rule-set-section">
      <div className="recent-section-header">
        <div><span className="eyebrow">Gameplay foundations</span><h3>Rule sets</h3><p>Author mechanics and compose distinct ways to play in your worlds.</p></div>
        <div className="section-actions"><Link href="/rule-sets" className="secondary-action">All rule sets{total ? ` (${total})` : ''}</Link><button className="primary-action" onClick={() => setCreating((value) => !value)}>{creating ? 'Close creator' : 'New rule set'}</button></div>
      </div>

      {creating && <RuleSetCreateForm onCancel={() => setCreating(false)} onCreated={(created) => {
        setRuleSets((items) => [created, ...items.filter((item) => item.id !== created.id)].slice(0, 3));
        setTotal((value) => value + 1);
        setCreating(false);
        setError(undefined);
      }} />}

      {error && <p className="rule-set-notice error" role="alert">{error}</p>}
      {loading ? <div className="recent-empty"><p>Loading your rule sets…</p></div> : (
        <div className="entity-rows">
          {ruleSets.length ? ruleSets.map((ruleSet) => (
            <article className="entity-row rule-set-row" key={ruleSet.id} style={{ '--rule-set-accent': ruleSet.dashboard.accentColor || '#e5b64c' } as CSSProperties}>
              <span className="entity-meta">{ruleSet.status} · {ruleSet.lifecycle} · Updated {new Date(ruleSet.updatedAt).toLocaleDateString()}</span>
              <Link className="entity-title-link" href={`/rule-sets/${ruleSet.id}`}>{ruleSet.name}</Link>
              <p>{ruleSet.summary}</p>
              {!!ruleSet.tags.length && <div className="rule-set-tags">{ruleSet.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
              <DeleteArtifactButton artifactName={ruleSet.name} artifactType="rule set" onDelete={async () => {
                await deleteRuleSet(ruleSet);
                setRuleSets((items) => items.filter((item) => item.id !== ruleSet.id));
                setTotal((value) => Math.max(0, value - 1));
              }} />
            </article>
          )) : !error && <div className="recent-empty"><p>No rule sets yet. Create one to define how your worlds play.</p></div>}
        </div>
      )}
    </section>
  );
}
