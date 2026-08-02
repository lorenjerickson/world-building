'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppBreadcrumbs } from '@/components/app-breadcrumbs';
import { CreateableTrait, WorldEntity, WorldSummary, worldApi } from '@/lib/world-entities';

function entityName(entity: WorldEntity) { return String(entity.values.name || 'Untitled World Entity'); }

export function WorldEntityIndex({ worldId }: { worldId: string }) {
  const [world, setWorld] = useState<(WorldSummary & { createableTraits: CreateableTrait[]; traitFilters: Array<{ id: string; name: string }> }) | null>(null);
  const [entities, setEntities] = useState<WorldEntity[]>([]);
  const [search, setSearch] = useState('');
  const [traitId, setTraitId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (search.trim()) query.set('search', search.trim());
      if (traitId) query.set('traitId', traitId);
      const [worldResult, entityResult] = await Promise.all([
        worldApi<WorldSummary & { createableTraits: CreateableTrait[]; traitFilters: Array<{ id: string; name: string }> }>(`/${encodeURIComponent(worldId)}`),
        worldApi<WorldEntity[]>(`/${encodeURIComponent(worldId)}/entities${query.size ? `?${query}` : ''}`),
      ]);
      setWorld(worldResult);
      setEntities(entityResult);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The world could not be opened.');
    } finally { setLoading(false); }
  }, [search, traitId, worldId]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 200); return () => window.clearTimeout(timer); }, [load]);

  const traitNames = useMemo(() => new Map(world?.createableTraits.map((trait) => [trait.id, trait.name]) ?? []), [world]);

  async function upgrade() {
    setUpgrading(true);
    try {
      const result = await worldApi<{ upgraded: boolean; needsAttention?: number }>(`/${encodeURIComponent(worldId)}/upgrade`, { method: 'POST' });
      await load();
      if (result.upgraded && result.needsAttention) setError(`${result.needsAttention} World Entit${result.needsAttention === 1 ? 'y needs' : 'ies need'} attention after the upgrade.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The ruleset could not be upgraded.'); }
    finally { setUpgrading(false); }
  }

  return <main className="dashboard-container world-entity-index">
    <AppBreadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Worlds', href: '/worlds' }, { label: world?.name ?? 'World' }]} />
    <header className="dashboard-header">
      <div className="header-left"><div className="world-entity-release-row"><span className="eyebrow">{world?.ruleSetName ?? 'Ruleset'} · release {world?.releaseVersion ?? '—'}</span><button className="link world-entity-upgrade-link" disabled={upgrading || !world} type="button" onClick={() => void upgrade()}>{upgrading ? 'Checking…' : 'Check for upgrade'}</button></div><h2>{world?.name ?? 'Opening world…'}</h2>{world?.description && <p className="subtext world-entity-description">{world.description}</p>}</div>
    </header>
    {error && <div className="alert alert-warning world-entity-alert" role="alert"><span>{error}</span></div>}
    <section className="card-surface">
      <div className="section-title-bar world-entity-section-title"><div><h3>World Entities</h3><p className="subtext">Every created thing in this world, generated from the bound ruleset traits.</p></div><div className="section-actions world-entity-panel-actions"><span className="badge badge-outline">{entities.length}</span><Link className="primary-action btn" href={`/world/${encodeURIComponent(worldId)}/entities/new`}>Create World Entity</Link></div></div>
      <div className="world-entity-filters">
        <label className="rule-set-field"><span>Search</span><input className="input" type="search" placeholder="Name or description" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label className="rule-set-field"><span>Trait</span><select className="select" value={traitId} onChange={(event) => setTraitId(event.target.value)}><option value="">All inherited traits</option>{world?.traitFilters.map((trait) => <option key={trait.id} value={trait.id}>{trait.name}</option>)}</select><small>Matches root traits and every exported inherited prerequisite.</small></label>
      </div>
      {loading ? <p className="recent-empty">Loading World Entities…</p> : entities.length ? <ul className="list world-entity-list">{entities.map((entity) => <li className="list-row" key={entity.id}><div className="list-col-grow"><Link className="world-entity-title" href={`/world/${encodeURIComponent(worldId)}/entities/${encodeURIComponent(entity.id)}`}>{entityName(entity)}</Link><p>{String(entity.values.description || 'No description')}</p><div className="world-entity-traits">{entity.rootTraitIds.map((id) => <span className="badge badge-outline" key={id}>{traitNames.get(id) ?? id}</span>)}{entity.migrationStatus === 'needs_attention' && <span className="badge badge-warning">Needs attention</span>}</div></div><Link className="text-link link" href={`/world/${encodeURIComponent(worldId)}/entities/${encodeURIComponent(entity.id)}`}>Open →</Link></li>)}</ul> : <div className="recent-empty"><p>No World Entities match these filters.</p></div>}
    </section>
  </main>;
}
