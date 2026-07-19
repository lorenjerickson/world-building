'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { RuleSetCreateForm } from './rule-set-create-form';
import { DeleteArtifactButton } from './delete-artifact-button';
import { deleteRuleSet, listRuleSets, RuleSetApiError, RuleSetResource } from '@/lib/rule-sets';

export function RuleSetIndex() {
  const [ruleSets, setRuleSets] = useState<RuleSetResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    listRuleSets(100, controller.signal)
      .then((page) => { setRuleSets(page.items); setError(undefined); })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause instanceof RuleSetApiError ? cause.message : 'Rule sets could not be loaded.');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  return (
    <main className="dashboard-container">
      <header className="dashboard-header">
        <div className="header-left"><span className="eyebrow">Gameplay foundations</span><h2>Your rule sets</h2></div>
        <div className="section-actions"><Link href="/dashboard" className="secondary-action">Back to dashboard</Link><button className="primary-action" onClick={() => setCreating((value) => !value)}>{creating ? 'Close creator' : 'New rule set'}</button></div>
      </header>
      {creating && <section className="card-surface rule-set-index-creator"><RuleSetCreateForm onCancel={() => setCreating(false)} onCreated={(created) => {
        setRuleSets((items) => [created, ...items]);
        setCreating(false);
        setError(undefined);
      }} /></section>}
      {error && <p className="rule-set-notice error" role="alert">{error}</p>}
      <section className="rule-set-card-grid" aria-busy={loading}>
        {loading ? <div className="card-surface recent-empty"><p>Loading your rule sets…</p></div> : ruleSets.map((ruleSet) => (
          <article className="card-surface rule-set-card" key={ruleSet.id} style={{ borderTopColor: ruleSet.dashboard.accentColor || '#e5b64c' }}>
            <Link href={`/rule-sets/${ruleSet.id}`} className="rule-set-card-link">
              <span className="entity-meta">{ruleSet.status} · {ruleSet.lifecycle}</span>
              <h3>{ruleSet.name}</h3>
              <p>{ruleSet.summary}</p>
              <div className="rule-set-card-footer"><span>Engine {ruleSet.engineFeatureLevel}</span><span>Updated {new Date(ruleSet.updatedAt).toLocaleDateString()}</span></div>
              {!!ruleSet.tags.length && <div className="rule-set-tags">{ruleSet.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
            </Link>
            <DeleteArtifactButton artifactName={ruleSet.name} artifactType="rule set" onDelete={async () => {
              await deleteRuleSet(ruleSet);
              setRuleSets((items) => items.filter((item) => item.id !== ruleSet.id));
            }} />
          </article>
        ))}
        {!loading && !error && !ruleSets.length && <div className="card-surface recent-empty"><p>No rule sets yet. Use “New rule set” to create your first draft.</p></div>}
      </section>
    </main>
  );
}
