'use client';

import Link from 'next/link';
import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { useUser } from '@auth0/nextjs-auth0/client';
import {
  getRuleSetChildren,
  listRuleSets,
  RuleDefinitionResource,
  RuleModuleResource,
} from '@/lib/rule-sets';
import { loadStoredWorlds } from '@/lib/wanderlust-storage';

type IndexedDocument = {
  recordType: string;
  recordId: string;
  title: string;
  summary: string;
  href: string;
  searchableText: string;
};

type SearchResult = Omit<IndexedDocument, 'searchableText'> & { rank: number };

type StoredWorld = {
  id: string;
  name?: string;
  description?: string;
  locations?: Array<{ id: string; name: string; description?: string; type?: string }>;
  characters?: Array<{ id: string; name: string; description?: string }>;
  organizations?: Array<{ id: string; name: string; description?: string; type?: string }>;
  events?: Array<{ id: string; name: string; description?: string; year?: string }>;
  items?: Array<{ id: string; name: string; description?: string; type?: string }>;
};

const worldCollections = [
  ['locations', 'Location'],
  ['characters', 'Character'],
  ['organizations', 'Organization'],
  ['events', 'Event'],
  ['items', 'Item'],
] as const;

function worldDocuments(): IndexedDocument[] {
  try {
    const worlds = loadStoredWorlds<StoredWorld>();
    return worlds.flatMap((world) => {
      const worldHref = `/world/${encodeURIComponent(world.id)}`;
      const documents: IndexedDocument[] = [{
        recordType: 'World',
        recordId: world.id,
        title: world.name || 'Untitled world',
        summary: world.description || '',
        href: worldHref,
        searchableText: world.description || '',
      }];
      for (const [collection, label] of worldCollections) {
        for (const record of world[collection] || []) {
          const details = 'type' in record ? record.type : 'year' in record ? record.year : '';
          documents.push({
            recordType: label,
            recordId: `${world.id}:${record.id}`,
            title: record.name,
            summary: [details, record.description].filter(Boolean).join(' · '),
            href: `${worldHref}/${collection}/${encodeURIComponent(record.id)}`,
            searchableText: [world.name, details, record.description].filter(Boolean).join(' '),
          });
        }
      }
      return documents;
    });
  } catch {
    return [];
  }
}

async function ruleDocuments(signal: AbortSignal): Promise<IndexedDocument[]> {
  const page = await listRuleSets(100, signal);
  const children = await Promise.all(page.items.map(async (ruleSet) => {
    const [modules, definitions] = await Promise.all([
      getRuleSetChildren<RuleModuleResource>(ruleSet.id, 'modules', signal),
      getRuleSetChildren<RuleDefinitionResource>(ruleSet.id, 'definitions', signal),
    ]);
    return [
      {
        recordType: 'Rule set',
        recordId: String(ruleSet.id),
        title: ruleSet.name,
        summary: ruleSet.summary,
        href: `/rule-sets/${ruleSet.id}`,
        searchableText: [ruleSet.description, ...ruleSet.tags].filter(Boolean).join(' '),
      },
      ...modules.map((module) => ({
        recordType: 'Rule module',
        recordId: `${ruleSet.id}:${module.id}`,
        title: module.name,
        summary: module.description || module.namespace,
        href: `/rule-sets/${ruleSet.id}/modules/${module.id}`,
        searchableText: [ruleSet.name, module.namespace, module.description].filter(Boolean).join(' '),
      })),
      ...definitions.map((definition) => ({
        recordType: 'Rule definition',
        recordId: `${ruleSet.id}:${definition.id}`,
        title: definition.name,
        summary: definition.description || definition.definitionType,
        href: `/rule-sets/${ruleSet.id}/definitions/${definition.id}`,
        searchableText: [
          ruleSet.name,
          definition.definitionType,
          definition.description,
          ...definition.tags,
          JSON.stringify(definition.body),
        ].filter(Boolean).join(' '),
      })),
    ] satisfies IndexedDocument[];
  }));
  return children.flat();
}

export function GlobalSearch() {
  const { user } = useUser();
  const input = useRef<HTMLInputElement>(null);
  const lastIndexedAt = useRef(0);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim());
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [indexVersion, setIndexVersion] = useState(0);
  const [message, setMessage] = useState<string>();

  async function refreshIndex() {
    if (indexing || Date.now() - lastIndexedAt.current < 60_000) return;
    setIndexing(true);
    setMessage(undefined);
    const controller = new AbortController();
    try {
      const documents = [...worldDocuments(), ...await ruleDocuments(controller.signal)];
      const response = await fetch('/api/search/index', {
        body: JSON.stringify({ documents }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      if (!response.ok) throw new Error('Search is temporarily unavailable.');
      lastIndexedAt.current = Date.now();
      setIndexVersion((current) => current + 1);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Search is temporarily unavailable.');
    } finally {
      setIndexing(false);
    }
  }

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (target.matches('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      input.current?.focus();
    }
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  useEffect(() => {
    if (!open || deferredQuery.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(deferredQuery)}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Search is temporarily unavailable.');
        setResults(await response.json() as SearchResult[]);
        setMessage(undefined);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setMessage(cause instanceof Error ? cause.message : 'Search is temporarily unavailable.');
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [deferredQuery, indexVersion, open]);

  if (!user) return null;

  return (
    <div className={`global-search${open ? ' is-open' : ''}`}>
      <label className="input input-bordered global-search-input">
        <svg
          aria-hidden="true"
          className="global-search-icon"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
          <path d="m16 16 4.25 4.25" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
        </svg>
        <input
          aria-label="Search worlds and rules"
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => {
            setOpen(true);
            void refreshIndex();
          }}
          placeholder="Search worlds and rules…"
          ref={input}
          type="search"
          value={query}
        />
        <kbd>/</kbd>
      </label>
      {open && query.trim().length >= 2 ? (
        <section className="card-surface global-search-results" aria-label="Search results">
          <header><span>{indexing ? 'Updating index…' : `${results.length} results`}</span><button className="btn btn-ghost btn-xs" onMouseDown={(event) => event.preventDefault()} onClick={() => { lastIndexedAt.current = 0; void refreshIndex(); }}>Refresh</button></header>
          {message ? <p className="global-search-message">{message}</p> : null}
          {!message && !results.length && !indexing ? <p className="global-search-message">No matching records.</p> : null}
          <ul>{results.map((result) => (
            <li key={`${result.recordType}:${result.recordId}`}>
              <Link href={result.href} onClick={() => setOpen(false)}>
                <span>{result.recordType}</span>
                <strong>{result.title}</strong>
                {result.summary ? <small>{result.summary}</small> : null}
              </Link>
            </li>
          ))}</ul>
        </section>
      ) : null}
    </div>
  );
}
