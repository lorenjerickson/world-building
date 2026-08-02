'use client';

import type { TraitShapeNode } from '@wanderlust-vtt/common';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppBreadcrumbs, BreadcrumbItem } from '@/components/app-breadcrumbs';
import { MediaAssetPicker } from '@/components/guided-trait-grants-editor';
import {
  CreateableTrait,
  WorldEntity,
  WorldEntityReference,
  WorldEntitySchema,
  WorldSummary,
  worldApi,
} from '@/lib/world-entities';

type CollectionNode = Extract<TraitShapeNode, { kind: 'collection' }>;
type TerminalNode = Extract<TraitShapeNode, { kind: 'terminal' }>;

type CollectionOptions = {
  collection: CollectionNode;
  options?: CreateableTrait[];
  groups?: Array<{ acceptedTraitId: string; options: CreateableTrait[] }>;
};

function displayName(entity?: WorldEntity) { return String(entity?.values.name || 'Untitled World Entity'); }
function jsonBody(value: unknown) { return JSON.stringify(value); }

function valueFromInput(terminal: TerminalNode, value: string): string | number {
  return terminal.dataType === 'number' ? Number(value) : value;
}

function EntityTerminalField({ terminal, value, onChange }: {
  terminal: TerminalNode;
  value: string | number | boolean | null | undefined;
  onChange: (value: string | number | boolean) => void;
}) {
  const path = terminal.path.join('.');
  if (terminal.dataType === 'media') {
    return <fieldset className="fieldset rule-set-field rule-set-field-wide"><legend className="fieldset-legend">{terminal.label}</legend><MediaAssetPicker mediaType={terminal.mediaType ?? 'image'} value={typeof value === 'string' ? value : ''} onChange={onChange} /><p className="label">{terminal.required ? 'Required ' : ''}{terminal.mediaType} asset</p></fieldset>;
  }
  if (terminal.dataType === 'boolean') {
    return <label className="world-entity-check"><input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} /><span>{terminal.label}</span></label>;
  }
  if (terminal.dataType === 'enum') {
    return <label className="rule-set-field"><span>{terminal.label}</span><select className="select" required={terminal.required} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)}><option value="">Select…</option>{terminal.allowedValues?.map((option) => <option key={option} value={option}>{option}</option>)}</select><small>{path}</small></label>;
  }
  const common = {
    required: terminal.required || path === 'name' || path === 'description',
    value: typeof value === 'string' || typeof value === 'number' ? value : '',
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(valueFromInput(terminal, event.target.value)),
  };
  return <label className={`rule-set-field${path === 'description' ? ' rule-set-field-wide' : ''}`}><span>{terminal.label}</span>{path === 'description' || terminal.dataType === 'text' && path.includes('notes') ? <textarea className="textarea" rows={path === 'description' ? 5 : 3} {...common} /> : <input className="input" type={terminal.dataType === 'number' ? 'number' : 'text'} min={terminal.min} max={terminal.max} {...common} />}<small>{path}{terminal.unit ? ` · ${terminal.unit}` : ''}</small></label>;
}

function CollectionPanel({ collection, entity, trail, worldId, onChanged }: {
  collection: CollectionNode;
  entity: WorldEntity;
  trail: string[];
  worldId: string;
  onChanged: () => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [candidates, setCandidates] = useState<WorldEntity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const references = entity.outgoingReferences?.filter((reference) => reference.collectionPath === collection.path.join('.')) ?? [];
  const collectionPath = collection.path.join('.');
  const nextTrail = [...trail, entity.id];
  const newQuery = new URLSearchParams({ parent: entity.id, collection: collectionPath, trail: nextTrail.join(',') });

  const implementationMap = useCallback((candidate: WorldEntity): Record<string, string> | null => {
    if (collection.acceptsMode === 'any') return {};
    const available = new Set(candidate.rootTraitIds);
    const result: Record<string, string> = {};
    for (const accepted of collection.acceptedTraitIds) {
      const root = candidate.rootTraitIds.find((id) => id === accepted || candidate.satisfiedTraitIds.includes(accepted) && !Object.values(result).includes(id));
      if (!root || !available.has(root)) return null;
      result[accepted] = root;
    }
    return new Set(Object.values(result)).size === collection.acceptedTraitIds.length ? result : null;
  }, [collection]);

  async function openBrowser() {
    setLoading(true); setError(''); dialogRef.current?.showModal();
    try {
      const items = await worldApi<WorldEntity[]>(`/${encodeURIComponent(worldId)}/entities`);
      const referenced = new Set(references.map((reference) => reference.childEntityId));
      setCandidates(items.filter((candidate) => candidate.id !== entity.id && !referenced.has(candidate.id)
        && (collection.acceptsMode === 'any'
          ? collection.acceptedTraitIds.some((id) => candidate.satisfiedTraitIds.includes(id))
          : implementationMap(candidate) !== null)));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'World Entities could not be loaded.'); }
    finally { setLoading(false); }
  }

  async function attach(candidate: WorldEntity) {
    setLoading(true); setError('');
    try {
      await worldApi(`/${encodeURIComponent(worldId)}/entities/${encodeURIComponent(entity.id)}/collections/${encodeURIComponent(collectionPath)}/references`, {
        method: 'POST', body: jsonBody({ childEntityId: candidate.id, implementationMap: implementationMap(candidate) ?? {} }),
      });
      dialogRef.current?.close();
      await onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The reference could not be added.'); }
    finally { setLoading(false); }
  }

  async function detach(reference: WorldEntityReference) {
    await worldApi(`/${encodeURIComponent(worldId)}/entities/${encodeURIComponent(entity.id)}/references/${encodeURIComponent(reference.id)}`, { method: 'DELETE' });
    await onChanged();
  }

  return <section className="card-surface-sub world-entity-collection">
    <div className="section-title-bar"><div><h4>{collection.label}</h4><p className="subtext">Accepts {collection.acceptedTraitIds.join(collection.acceptsMode === 'all' ? ' + ' : ' or ')}{collection.capacity !== undefined ? ` · ${references.length}/${collection.capacity}` : ''}</p></div><div className="world-entity-collection-actions"><button className="secondary-action btn" disabled={collection.capacity !== undefined && references.length >= collection.capacity} type="button" onClick={() => void openBrowser()}>Choose existing</button><Link className="primary-action btn" aria-disabled={collection.capacity !== undefined && references.length >= collection.capacity} href={`/world/${encodeURIComponent(worldId)}/entities/new?${newQuery}`}>Create new</Link></div></div>
    {references.length ? <ul className="list">{references.map((reference) => <li className="list-row" key={reference.id}><div className="list-col-grow"><Link className="world-entity-title" href={`/world/${encodeURIComponent(worldId)}/entities/${encodeURIComponent(reference.childEntityId)}?trail=${encodeURIComponent(nextTrail.join(','))}`}>{displayName(reference.childEntity)}</Link><p>{String(reference.childEntity?.values.description || '')}</p></div><button className="secondary-action btn" type="button" onClick={() => void detach(reference)}>Remove reference</button></li>)}</ul> : <p className="recent-empty">Nothing has been added to this collection.</p>}
    <dialog className="modal" ref={dialogRef}><div className="modal-box world-entity-browser"><h3>Choose an existing World Entity</h3><p className="subtext">Only compatible entities from this world are shown.</p>{error && <div className="alert alert-error"><span>{error}</span></div>}{loading ? <p>Loading…</p> : candidates.length ? <ul className="list">{candidates.map((candidate) => <li className="list-row" key={candidate.id}><div className="list-col-grow"><strong>{displayName(candidate)}</strong><p>{String(candidate.values.description || '')}</p></div><button className="primary-action btn" type="button" onClick={() => void attach(candidate)}>Use this</button></li>)}</ul> : <p className="recent-empty">No compatible existing World Entities are available.</p>}<div className="modal-action"><button className="secondary-action btn" type="button" onClick={() => dialogRef.current?.close()}>Close</button></div></div><form method="dialog" className="modal-backdrop"><button>close</button></form></dialog>
  </section>;
}

export function WorldEntityEditor({ worldId, entityId, parentId, collectionPath, trail = [] }: {
  worldId: string;
  entityId?: string;
  parentId?: string;
  collectionPath?: string;
  trail?: string[];
}) {
  const router = useRouter();
  const [world, setWorld] = useState<(WorldSummary & { createableTraits: CreateableTrait[] }) | null>(null);
  const [entity, setEntity] = useState<WorldEntity | null>(null);
  const [schema, setSchema] = useState<WorldEntitySchema | null>(null);
  const [collectionOptions, setCollectionOptions] = useState<CollectionOptions | null>(null);
  const [rootTraitId, setRootTraitId] = useState('');
  const [implementationMap, setImplementationMap] = useState<Record<string, string>>({});
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [values, setValues] = useState<Record<string, string | number | boolean | null>>({});
  const [trailEntities, setTrailEntities] = useState<WorldEntity[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [aiPrompt, setAiPrompt] = useState('');
  const [proposal, setProposal] = useState<Record<string, string | number | boolean | null> | null>(null);
  const [aiWorking, setAiWorking] = useState(false);

  const roots = useMemo(() => collectionOptions?.groups
    ? collectionOptions.groups.map((group) => implementationMap[group.acceptedTraitId]).filter(Boolean)
    : rootTraitId ? [rootTraitId] : [], [collectionOptions, implementationMap, rootTraitId]);
  const availableTraits = useMemo(() => collectionOptions?.options ?? world?.createableTraits ?? [], [collectionOptions, world]);
  const rootContracts = useMemo(() => roots.map((id) => world?.createableTraits.find((trait) => trait.id === id)
    ?? collectionOptions?.groups?.flatMap((group) => group.options).find((trait) => trait.id === id)).filter(Boolean) as CreateableTrait[], [collectionOptions, roots, world]);
  const choices = useMemo(() => rootContracts.flatMap((trait) => trait.prerequisiteChoices), [rootContracts]);

  const loadEntity = useCallback(async () => {
    if (!entityId) return;
    const result = await worldApi<WorldEntity>(`/${encodeURIComponent(worldId)}/entities/${encodeURIComponent(entityId)}`);
    setEntity(result); setSchema(result.schema ?? null); setValues(result.values); setSelections(result.prerequisiteSelections); setRootTraitId(result.rootTraitIds[0] ?? '');
  }, [entityId, worldId]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const worldResult = await worldApi<WorldSummary & { createableTraits: CreateableTrait[] }>(`/${encodeURIComponent(worldId)}`, { signal: controller.signal });
        setWorld(worldResult);
        if (trail.length) {
          const ancestors = await Promise.all(trail.map((id) => worldApi<WorldEntity>(`/${encodeURIComponent(worldId)}/entities/${encodeURIComponent(id)}`, { signal: controller.signal })));
          setTrailEntities(ancestors);
        }
        if (entityId) await loadEntity();
        else if (parentId && collectionPath) {
          const options = await worldApi<CollectionOptions>(`/${encodeURIComponent(worldId)}/entities/${encodeURIComponent(parentId)}/collections/${encodeURIComponent(collectionPath)}/options`, { signal: controller.signal });
          setCollectionOptions(options);
          if (options.groups) setImplementationMap(Object.fromEntries(options.groups.map((group) => [group.acceptedTraitId, group.options[0]?.id ?? ''])));
          else setRootTraitId(options.options?.[0]?.id ?? '');
        } else setRootTraitId(worldResult.createableTraits[0]?.id ?? '');
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The World Entity editor could not be opened.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [collectionPath, entityId, loadEntity, parentId, trail.join(','), worldId]);

  useEffect(() => {
    if (entityId || !choices.length) return;
    setSelections((current) => ({ ...Object.fromEntries(choices.map((choice) => [choice.traitId, current[choice.traitId] ?? [choice.options[0]?.id].filter(Boolean)])) }));
  }, [choices, entityId]);

  useEffect(() => {
    if (entityId || !roots.length || choices.some((choice) => !selections[choice.traitId]?.length)) return;
    const controller = new AbortController();
    worldApi<WorldEntitySchema>(`/${encodeURIComponent(worldId)}/entity-schema`, {
      method: 'POST', signal: controller.signal, body: jsonBody({ rootTraitIds: roots, prerequisiteSelections: selections }),
    }).then((result) => {
      setSchema(result);
      setValues((current) => {
        const next = { ...current };
        result.shape.nodes.forEach((node) => { if (node.kind === 'terminal' && next[node.path.join('.')] === undefined && node.default !== undefined) next[node.path.join('.')] = node.default; });
        return next;
      });
    }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The trait form could not be built.'); });
    return () => controller.abort();
  }, [choices, entityId, roots.join(','), selections, worldId]);

  const terminals = schema?.shape.nodes.filter((node): node is TerminalNode => node.kind === 'terminal') ?? [];
  const collections = schema?.shape.nodes.filter((node): node is CollectionNode => node.kind === 'collection') ?? [];

  const breadcrumbs: BreadcrumbItem[] = [{ label: 'Worlds', href: '/worlds' }, { label: world?.name ?? 'World', href: `/world/${encodeURIComponent(worldId)}` }];
  trailEntities.forEach((ancestor, index) => breadcrumbs.push({ label: displayName(ancestor), href: `/world/${encodeURIComponent(worldId)}/entities/${encodeURIComponent(ancestor.id)}?trail=${encodeURIComponent(trail.slice(0, index).join(','))}` }));
  breadcrumbs.push({ label: entity ? displayName(entity) : 'New World Entity' });

  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      if (entityId) {
        await worldApi(`/${encodeURIComponent(worldId)}/entities/${encodeURIComponent(entityId)}`, { method: 'PATCH', body: jsonBody({ values, prerequisiteSelections: selections }) });
        await loadEntity(); setSaving(false); return;
      }
      const body = { rootTraitIds: roots, prerequisiteSelections: selections, values, implementationMap };
      const result = parentId && collectionPath
        ? await worldApi<{ entity: WorldEntity }>(`/${encodeURIComponent(worldId)}/entities/${encodeURIComponent(parentId)}/collections/${encodeURIComponent(collectionPath)}/entities`, { method: 'POST', body: jsonBody(body) })
        : { entity: await worldApi<WorldEntity>(`/${encodeURIComponent(worldId)}/entities`, { method: 'POST', body: jsonBody(body) }) };
      router.push(`/world/${encodeURIComponent(worldId)}/entities/${encodeURIComponent(result.entity.id)}${trail.length ? `?trail=${encodeURIComponent(trail.join(','))}` : ''}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The World Entity could not be saved.'); setSaving(false); }
  }

  async function propose() {
    setAiWorking(true); setError(''); setProposal(null);
    try {
      const result = await worldApi<{ proposal: Record<string, string | number | boolean | null>; diagnostics: Array<{ message: string }> }>(`/${encodeURIComponent(worldId)}/entities/proposals`, { method: 'POST', body: jsonBody({ rootTraitIds: roots, prerequisiteSelections: selections, prompt: aiPrompt, currentValues: values, preserveCurrentValues: true }) });
      setProposal(result.proposal);
      if (result.diagnostics.length) setError(`AI proposal needs review: ${result.diagnostics.map((item) => item.message).join(' ')}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'AI assistance failed.'); }
    finally { setAiWorking(false); }
  }

  if (loading) return <div className="loading-screen"><p>Building the trait form…</p></div>;

  return <main className="dashboard-container">
    <AppBreadcrumbs items={breadcrumbs} />
    <header className="dashboard-header"><div className="header-left"><span className="eyebrow">World Entity</span><h2>{entity ? displayName(entity) : 'Create a World Entity'}</h2></div><Link className="secondary-action btn" href={parentId ? `/world/${encodeURIComponent(worldId)}/entities/${encodeURIComponent(parentId)}?trail=${encodeURIComponent(trail.slice(0, -1).join(','))}` : `/world/${encodeURIComponent(worldId)}`}>Cancel</Link></header>
    {entity?.migrationStatus === 'needs_attention' && <div className="alert alert-warning world-entity-alert" role="alert"><div><strong>This World Entity needs attention.</strong><ul>{entity.migrationDiagnostics.map((item, index) => <li key={`${item.code}:${index}`}>{item.path ? `${item.path}: ` : ''}{item.message}</li>)}</ul>{Object.keys(entity.retainedValues).length > 0 && <p>Values removed from the current schema have been retained until this repair is saved.</p>}</div></div>}
    {error && <div className="alert alert-error world-entity-alert" role="alert"><span>{error}</span></div>}
    <form className="world-entity-editor-layout" onSubmit={save}>
      <section className="card-surface">
        {!entity && <><div className="section-title-bar"><div><h3>Implementation</h3><p className="subtext">Choose the createable trait that defines this entity.</p></div></div>{collectionOptions?.groups ? <div className="rule-set-form-grid">{collectionOptions.groups.map((group) => <label className="rule-set-field" key={group.acceptedTraitId}><span>{group.acceptedTraitId}</span><select className="select" required value={implementationMap[group.acceptedTraitId] ?? ''} onChange={(event) => setImplementationMap((current) => ({ ...current, [group.acceptedTraitId]: event.target.value }))}><option value="">Choose implementation…</option>{group.options.map((trait) => <option key={trait.id} value={trait.id}>{trait.name}</option>)}</select></label>)}</div> : <label className="rule-set-field rule-set-field-wide"><span>Createable trait</span><select className="select" required value={rootTraitId} onChange={(event) => { setRootTraitId(event.target.value); setSelections({}); setValues({}); }}><option value="">Choose a trait…</option>{availableTraits.map((trait) => <option key={trait.id} value={trait.id}>{trait.name}</option>)}</select></label>}
        {choices.length > 0 && <div className="world-entity-prerequisites"><h4>Prerequisite choices</h4><div className="rule-set-form-grid">{choices.map((choice) => <label className="rule-set-field" key={choice.traitId}><span>{choice.traitName}</span><select className="select" required value={selections[choice.traitId]?.[0] ?? ''} onChange={(event) => setSelections((current) => ({ ...current, [choice.traitId]: [event.target.value] }))}><option value="">Choose one…</option>{choice.options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>)}</div></div>}</>}
        <div className="section-title-bar world-entity-fields-heading"><div><h3>Details</h3><p className="subtext">Fields are provided by the complete trait prerequisite closure.</p></div>{entity?.migrationStatus === 'needs_attention' && <span className="badge badge-warning">Needs attention</span>}</div>
        {terminals.length ? <div className="rule-set-form-grid">{terminals.map((terminal) => <EntityTerminalField key={terminal.path.join('.')} terminal={terminal} value={values[terminal.path.join('.')]} onChange={(value) => setValues((current) => ({ ...current, [terminal.path.join('.')]: value }))} />)}</div> : <p className="recent-empty">Choose all required traits to build this form.</p>}
        <div className="rule-set-form-actions"><span>Saving repairs clears “needs attention” only after the current schema validates.</span><button className="primary-action btn" disabled={saving || !schema} type="submit">{saving ? 'Saving…' : entity ? 'Save World Entity' : 'Create World Entity'}</button></div>
      </section>
      <aside className="world-entity-assistant card-surface"><span className="eyebrow">AI assistance</span><h3>Propose form values</h3><p className="subtext">Describe what you want. Nothing is applied or saved until you review it.</p><label className="rule-set-field"><span>Prompt</span><textarea className="textarea" rows={6} value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} /></label><button className="secondary-action btn" disabled={aiWorking || !schema || !aiPrompt.trim()} type="button" onClick={() => void propose()}>{aiWorking ? 'Drafting…' : 'Generate proposal'}</button>{proposal && <div className="world-entity-proposal"><h4>Review proposal</h4><pre>{JSON.stringify(proposal, null, 2)}</pre><div className="rule-set-form-actions"><button className="secondary-action btn" type="button" onClick={() => setProposal(null)}>Discard</button><button className="primary-action btn" type="button" onClick={() => { setValues(proposal); setProposal(null); }}>Apply to form</button></div></div>}</aside>
    </form>
    {entity && collections.map((collection) => <CollectionPanel key={collection.path.join('.')} collection={collection} entity={entity} trail={trail} worldId={worldId} onChanged={loadEntity} />)}
  </main>;
}
