'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { AppBreadcrumbs } from '@/components/app-breadcrumbs';
import { AvailableRuleSet, WorldSummary, worldApi } from '@/lib/world-entities';

export function NewWorldForm() {
  const router = useRouter();
  const [ruleSets, setRuleSets] = useState<AvailableRuleSet[]>([]);
  const [ruleSetId, setRuleSetId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    worldApi<AvailableRuleSet[]>('/available-rule-sets', { signal: controller.signal })
      .then((items) => {
        setRuleSets(items);
        setRuleSetId(items[0] ? String(items[0].id) : '');
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Rulesets could not be loaded.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const world = await worldApi<WorldSummary>('', {
        method: 'POST',
        body: JSON.stringify({ name, description, ruleSetId: Number(ruleSetId) }),
      });
      router.push(`/world/${encodeURIComponent(world.id)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The world could not be created.');
      setSaving(false);
    }
  }

  return <main className="dashboard-container">
    <AppBreadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Worlds', href: '/worlds' }, { label: 'New world' }]} />
    <header className="dashboard-header">
      <div className="header-left"><span className="eyebrow">World organization</span><h2>Create a world</h2></div>
      <Link className="secondary-action btn" href="/worlds">Cancel</Link>
    </header>
    <form className="card-surface rule-set-create-form" onSubmit={submit}>
      <div className="rule-set-form-heading">
        <div><span className="eyebrow">Pinned rules</span><h2>World details</h2></div>
      </div>
      <div className="rule-set-form-grid">
        <label className="rule-set-field"><span>Name</span><input className="input" required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="rule-set-field"><span>Ruleset</span><select className="select" required disabled={loading || !ruleSets.length} value={ruleSetId} onChange={(event) => setRuleSetId(event.target.value)}><option value="">Select a published ruleset…</option>{ruleSets.map((ruleSet) => <option key={ruleSet.id} value={ruleSet.id}>{ruleSet.name} · {ruleSet.release.version}</option>)}</select><small>New worlds use the latest published release and remain pinned until you explicitly upgrade.</small></label>
        <label className="rule-set-field rule-set-field-wide"><span>Description</span><textarea className="textarea" required rows={6} maxLength={10_000} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      </div>
      {error && <div className="alert alert-error" role="alert"><span>{error}</span></div>}
      {!loading && !ruleSets.length && !error && <div className="alert alert-warning" role="alert"><span>Publish a ruleset before creating a world.</span></div>}
      <div className="rule-set-form-actions"><span>This creates an empty organizational world. You can create its first World Entity next.</span><button className="primary-action btn" disabled={saving || !ruleSetId} type="submit">{saving ? 'Creating…' : 'Create world'}</button></div>
    </form>
  </main>;
}
