'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { RuleDefinitionResource } from '@/lib/rule-sets';

// ── Types ─────────────────────────────────────────────────────────────────────

export type GrantDataType = 'text' | 'number' | 'boolean' | 'enum' | 'trait' | 'modifier' | 'slot' | 'slot-affinity';
export type ModifierOperation = 'increases' | 'decreases' | 'multiplies' | 'divides' | 'sets';

export interface GrantDraft {
  _id: string;
  key: string;
  label: string;
  dataType: GrantDataType;
  required: boolean;
  // number
  min: string;
  max: string;
  defaultNum: string;
  // text | boolean ('true'/'false') | enum default
  defaultStr: string;
  // enum allowed values (comma-separated)
  allowedValues: string;
  // trait reference (externalId)
  ref: string;
  // modifier — path expressed as ordered segments: [root][subtrait…][property]
  modifierOperation: ModifierOperation;
  modifierFieldSegments: string[];
  modifierAmount: string;
  // slot
  slotCount: string;
  slotGrantTypes: string[];
  acceptedTraits: string[];
  acceptedTraitsMode: 'any' | 'all';
  // slot-affinity
  slotAffinityTypes: string[];
  slotAffinityMode: 'any' | 'all';
}

export type PrerequisiteSpec = {
  /** 'any' — at least one must be present; 'all' — every one must be present */
  mode: 'any' | 'all';
  ids: string[];
};

export type TraitGrantsBody = {
  metamodelVersion: 'trait/1';
  grants: GrantEntry[];
  prerequisites?: PrerequisiteSpec;
};

type GrantEntry = {
  key?: string;
  label?: string;
  dataType: GrantDataType;
  required?: boolean;
  min?: number;
  max?: number;
  default?: number | string | boolean;
  allowedValues?: string[];
  ref?: string;
  // modifier
  operation?: ModifierOperation;
  field?: string;
  amount?: boolean | number | string;
  // slot
  count?: number;
  /** Type tags on the slot (e.g. ["armor", "hands"]). Replaces the old single slotType string. */
  slotTypes?: string[];
  acceptedTraits?: string[];
  /** Matching mode for acceptedTraits: 'any' (OR) or 'all' (AND). Omitted means 'any'. */
  acceptsMode?: 'any' | 'all';
  // slot-affinity
  mode?: 'any' | 'all';
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export function newGrant(dataType: GrantDataType): GrantDraft {
  return {
    _id: crypto.randomUUID(),
    key: '', label: '', dataType, required: true,
    min: '', max: '', defaultNum: '', defaultStr: '', allowedValues: '', ref: '',
    modifierOperation: 'increases', modifierFieldSegments: [], modifierAmount: '',
    slotCount: '1', slotGrantTypes: [], acceptedTraits: [], acceptedTraitsMode: 'any', slotAffinityTypes: [], slotAffinityMode: 'any',
  };
}

export function buildGrantsBody(
  grants: GrantDraft[],
  prerequisites: PrerequisiteSpec = { mode: 'any', ids: [] },
  traitDefinitions: RuleDefinitionResource[] = [],
): TraitGrantsBody {
  return {
    metamodelVersion: 'trait/1',
    grants: grants.map((g): GrantEntry => {
      const entry: GrantEntry = { dataType: g.dataType };
      if (g.key.trim()) entry.key = g.key.trim();
      if (g.label.trim()) entry.label = g.label.trim();
      if (g.dataType !== 'trait' && g.required) entry.required = true;
      if (g.dataType === 'number') {
        if (g.min !== '') entry.min = Number(g.min);
        if (g.max !== '') entry.max = Number(g.max);
        if (g.defaultNum !== '') entry.default = Number(g.defaultNum);
      } else if (g.dataType === 'text' || g.dataType === 'enum') {
        if (g.defaultStr.trim()) entry.default = g.defaultStr.trim();
        if (g.dataType === 'enum') {
          const vals = g.allowedValues.split(',').map((v) => v.trim()).filter(Boolean);
          if (vals.length) entry.allowedValues = vals;
        }
      } else if (g.dataType === 'boolean') {
        if (g.defaultStr === 'true') entry.default = true;
        else if (g.defaultStr === 'false') entry.default = false;
      } else if (g.dataType === 'trait') {
        if (g.ref) entry.ref = g.ref;
      } else if (g.dataType === 'modifier') {
        entry.operation = g.modifierOperation;
        const segs = g.modifierFieldSegments.filter((s) => s.trim());
        if (segs.length > 0) entry.field = segs.join('.');
        if (g.modifierAmount !== '') {
          const resolved = resolveTerminalGrant(g.modifierFieldSegments, traitDefinitions, prerequisites.ids, grants);
          const tt = resolved?.dataType ?? null;
          if (tt === 'boolean') {
            entry.amount = g.modifierAmount === 'true';
          } else if (tt === 'text' || tt === 'enum') {
            entry.amount = g.modifierAmount;
          } else {
            const n = Number(g.modifierAmount);
            entry.amount = isNaN(n) ? g.modifierAmount : n;
          }
        }
      } else if (g.dataType === 'slot') {
        const tags = g.slotGrantTypes.filter(Boolean);
        if (tags.length > 0) entry.slotTypes = tags;
        if (g.slotCount !== '') entry.count = Number(g.slotCount);
        if (g.acceptedTraits.length > 0) {
          entry.acceptedTraits = g.acceptedTraits.filter(Boolean);
          if (g.acceptedTraitsMode === 'all') entry.acceptsMode = 'all';
        }
      } else if (g.dataType === 'slot-affinity') {
        const types = g.slotAffinityTypes.filter(Boolean);
        if (types.length > 0) entry.slotTypes = types;
        if (g.slotAffinityMode === 'all') entry.mode = 'all';
      }
      return entry;
    }),
    ...(prerequisites.ids.length > 0 ? { prerequisites } : {}),
  };
}

export function prerequisitesDraftFromBody(body: Record<string, unknown>): PrerequisiteSpec {
  const empty: PrerequisiteSpec = { mode: 'any', ids: [] };
  if (body.metamodelVersion !== 'trait/1') return empty;
  const p = body.prerequisites;
  // New format: { mode, ids }
  if (p !== null && typeof p === 'object' && !Array.isArray(p)) {
    const obj = p as Record<string, unknown>;
    const mode: 'any' | 'all' = obj.mode === 'all' ? 'all' : 'any';
    const ids = Array.isArray(obj.ids)
      ? (obj.ids as unknown[]).filter((v): v is string => typeof v === 'string')
      : [];
    return { mode, ids };
  }
  // Legacy format: string[] → treat as 'all'
  if (Array.isArray(p)) {
    const ids = (p as unknown[]).filter((v): v is string => typeof v === 'string');
    return { mode: 'all', ids };
  }
  return empty;
}

export function grantsDraftFromBody(body: Record<string, unknown>): GrantDraft[] | null {
  if (body.metamodelVersion !== 'trait/1') return null;
  if (!Array.isArray(body.grants)) return null;
  return (body.grants as GrantEntry[]).map((g): GrantDraft => ({
    _id: crypto.randomUUID(),
    key: g.key ?? '',
    label: g.label ?? '',
    dataType: g.dataType ?? 'text',
    required: g.required ?? true,
    min: g.min != null ? String(g.min) : '',
    max: g.max != null ? String(g.max) : '',
    defaultNum: g.default != null && g.dataType === 'number' ? String(g.default) : '',
    defaultStr: g.default != null && g.dataType !== 'number' && g.dataType !== 'trait'
      ? String(g.default) : '',
    allowedValues: Array.isArray(g.allowedValues) ? g.allowedValues.join(', ') : '',
    ref: g.ref ?? '',
    modifierOperation: (g.operation ?? 'increases') as ModifierOperation,
    modifierFieldSegments: g.field ? g.field.split('.') : [],
    modifierAmount: g.amount != null ? String(g.amount) : '',
    slotCount: g.count != null ? String(g.count) : '1',
    // slotTypes is now an array for slot grants; accept legacy single-string slotType too
    slotGrantTypes: g.dataType === 'slot'
      ? (Array.isArray(g.slotTypes) ? g.slotTypes : (typeof (g as any).slotType === 'string' && (g as any).slotType ? [(g as any).slotType] : []))
      : [],
    acceptedTraits: Array.isArray(g.acceptedTraits) ? g.acceptedTraits : [],
    acceptedTraitsMode: g.acceptsMode === 'all' ? 'all' : 'any',
    slotAffinityTypes: g.dataType === 'slot-affinity' && Array.isArray(g.slotTypes) ? g.slotTypes : [],
    slotAffinityMode: g.mode === 'all' ? 'all' : 'any',
  }));
}

// ── Tab field ordering ─────────────────────────────────────────────────────────

function getTabFields(dataType: GrantDataType): string[] {
  switch (dataType) {
    case 'text':    return ['key', 'dataType', 'defaultStr', 'label'];
    case 'number':  return ['key', 'dataType', 'label', 'min', 'max', 'defaultNum'];
    case 'boolean': return ['key', 'dataType', 'defaultStr', 'label'];
    case 'enum':    return ['key', 'dataType', 'allowedValues', 'defaultStr', 'label'];
    case 'trait':         return ['dataType', 'ref', 'key'];
    case 'modifier':      return ['dataType', 'modifierOperation', 'modifierPath', 'modifierAmount'];
    case 'slot':          return ['dataType'];
    case 'slot-affinity': return ['dataType'];
  }
}

// ── Field path options ────────────────────────────────────────────────────────

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Convert a human-readable trait name to a path-safe slug (e.g. "Main Hand" → "main-hand"). */
function nameToSlug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

/**
 * Extract a readable path slug from a trait's externalId, or fall back to
 * the definition's display name. Returns null for GUIDs with no slug form.
 */
function traitSlug(def: RuleDefinitionResource, segment: 'root' | 'leaf'): string | null {
  const id = def.externalId ?? '';
  if (id.startsWith('trait:')) {
    const path = id.slice(6);
    const part = segment === 'root' ? path.split('.')[0] : (path.split('.').pop() ?? '');
    if (part && !GUID_RE.test(part)) return part;
  }
  // externalId is a bare GUID or absent — derive from the human-readable name instead
  const slug = nameToSlug(def.name);
  return slug || null;
}

/**
 * Return only the trait definitions whose externalId is listed in prerequisiteIds.
 */
function filterPrereqDefs(
  traitDefinitions: RuleDefinitionResource[],
  prerequisiteIds: string[],
): RuleDefinitionResource[] {
  if (!prerequisiteIds.length) return [];
  const idSet = new Set(prerequisiteIds);
  return traitDefinitions.filter((d) => d.externalId != null && idSet.has(d.externalId));
}

/**
 * Return all terminal (settable) keyed grants from a trait/1 body.
 * Excludes trait-type grants — those are navigable intermediates, not terminal properties.
 */
function grantGrantsFrom(def: RuleDefinitionResource): { key: string; dataType: GrantDataType }[] {
  if (def.body?.metamodelVersion !== 'trait/1') return [];
  if (!Array.isArray(def.body.grants)) return [];
  return (def.body.grants as GrantEntry[])
    .filter((g) => g.key?.trim() && g.dataType !== 'trait')
    .map((g) => ({ key: g.key!.trim(), dataType: g.dataType }));
}

/**
 * Resolve a path key that refers to a named trait grant (e.g. 'senses' in self.senses.vision).
 * Looks in:
 *  1. The current trait's own draft grants (siblingGrants)
 *  2. Named trait grants nested inside each prerequisite trait's grants
 * Returns the referenced trait definition if found.
 */
function resolveNamedTraitGrantDef(
  key: string,
  traitDefinitions: RuleDefinitionResource[],
  prerequisiteIds: string[],
  siblingGrants: GrantDraft[],
): RuleDefinitionResource | null {
  // 1. Current trait's own named trait grants
  const sibling = siblingGrants.find((g) => g.dataType === 'trait' && g.key.trim() === key);
  if (sibling?.ref) {
    const def = traitDefinitions.find((d) => d.externalId === sibling.ref);
    if (def) return def;
  }
  // 2. Named trait grants inside each prerequisite trait
  const prereqs = filterPrereqDefs(traitDefinitions, prerequisiteIds);
  for (const prereq of prereqs) {
    if (prereq.body?.metamodelVersion !== 'trait/1' || !Array.isArray(prereq.body.grants)) continue;
    const traitGrant = (prereq.body.grants as GrantEntry[]).find(
      (g) => g.dataType === 'trait' && g.key?.trim() === key,
    );
    if (traitGrant?.ref) {
      const def = traitDefinitions.find((d) => d.externalId === traitGrant.ref);
      if (def) return def;
    }
  }
  return null;
}

function numericCompatible(op: ModifierOperation, dataType: GrantDataType): boolean {
  if (op === 'increases' || op === 'decreases' || op === 'multiplies' || op === 'divides') return dataType === 'number';
  return true; // 'sets' works with any type
}

function propertyOptions(
  grants: { key: string; dataType: GrantDataType }[],
  operation: ModifierOperation,
): ComboOption[] {
  const seen = new Set<string>();
  return grants
    .filter((g) => numericCompatible(operation, g.dataType) && !seen.has(g.key) && seen.add(g.key))
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((g) => ({ value: g.key, label: g.key, hint: g.dataType }));
}

/**
 * Build ComboOption[] for a single segment of a modifier field path.
 *
 * depth 0  — self / target / owner
 * depth 1  — prerequisite trait slugs + named trait-grant keys (actor-relative roots)
 * depth 2+ — property keys from the matched trait, filtered by operation compatibility
 */
function buildSegmentOptions(
  depth: number,
  segments: string[],
  traitDefinitions: RuleDefinitionResource[],
  prerequisiteIds: string[],
  operation: ModifierOperation,
  siblingGrants: GrantDraft[] = [],
): ComboOption[] {
  if (depth === 0) {
    return [
      { value: 'self',   label: 'self'   },
      { value: 'target', label: 'target' },
      { value: 'owner',  label: 'owner'  },
    ];
  }

  const rootIsActorRelative = ACTOR_RELATIVE_ROOTS.has(segments[0] ?? '');

  // depth 1: trait slugs from prerequisites + named trait-grant keys
  if (depth === 1 && rootIsActorRelative) {
    const defs = filterPrereqDefs(traitDefinitions, prerequisiteIds);
    const seen = new Set<string>();
    const options: ComboOption[] = [];

    // Prerequisite trait slugs
    for (const d of defs) {
      const slug = traitSlug(d, 'leaf');
      if (slug && !seen.has(slug)) { seen.add(slug); options.push({ value: slug, label: slug }); }
    }

    // Named trait-grant keys from sibling grants
    for (const g of siblingGrants) {
      const k = g.dataType === 'trait' ? g.key.trim() : '';
      if (k && !seen.has(k)) { seen.add(k); options.push({ value: k, label: k, hint: 'sub-trait' }); }
    }
    // Named trait-grant keys nested inside each prerequisite
    for (const prereq of defs) {
      if (prereq.body?.metamodelVersion !== 'trait/1' || !Array.isArray(prereq.body.grants)) continue;
      for (const g of prereq.body.grants as GrantEntry[]) {
        const k = g.dataType === 'trait' ? g.key?.trim() ?? '' : '';
        if (k && !seen.has(k)) { seen.add(k); options.push({ value: k, label: k, hint: 'sub-trait' }); }
      }
    }

    if (options.length) return options.sort((a, b) => a.value.localeCompare(b.value));
  }

  // depth 2+: properties of the trait identified by segments[1]
  if (depth >= 2 && rootIsActorRelative && segments[1]) {
    // Named trait-grant key takes priority over a same-name slug
    const namedDef = resolveNamedTraitGrantDef(segments[1], traitDefinitions, prerequisiteIds, siblingGrants);
    if (namedDef) {
      const grants = grantGrantsFrom(namedDef);
      if (grants.length) return propertyOptions(grants, operation);
    }
    // Fall back to prerequisite trait slug
    const defs = filterPrereqDefs(traitDefinitions, prerequisiteIds);
    const matched = defs.find((d) => traitSlug(d, 'leaf') === segments[1]);
    if (matched) {
      const grants = grantGrantsFrom(matched);
      if (grants.length) return propertyOptions(grants, operation);
    }
  }

  // Generic fallback: all property keys across all trait definitions, filtered by operation
  const all: { key: string; dataType: GrantDataType }[] = [];
  for (const def of traitDefinitions) {
    for (const g of grantGrantsFrom(def)) all.push(g);
  }
  return propertyOptions(all, operation);
}

// ── Static option sets ────────────────────────────────────────────────────────

interface ComboOption {
  value: string;
  label: string;
  hint?: string;
  /** Dot-separated path for hierarchical browsing */
  path?: string;
}

const DATA_TYPE_OPTIONS: ComboOption[] = [
  { value: 'text',     label: 'text',        hint: 'string' },
  { value: 'number',   label: 'number',      hint: 'numeric' },
  { value: 'boolean',  label: 'true / false', hint: 'boolean' },
  { value: 'enum',     label: 'one of…',     hint: 'enumerated' },
  { value: 'trait',    label: 'trait',       hint: 'trait reference' },
  { value: 'modifier', label: 'modifier',    hint: 'arithmetic change' },
  { value: 'slot',         label: 'slot',            hint: 'equipment slot' },
  { value: 'slot-affinity', label: 'slot-affinity',  hint: 'slot compatibility' },
];

const BOOL_OPTIONS: ComboOption[] = [
  { value: 'true',  label: 'true' },
  { value: 'false', label: 'false' },
];

const MODIFIER_OP_OPTIONS: ComboOption[] = [
  { value: 'increases',  label: 'increases',  hint: 'adds to field' },
  { value: 'decreases',  label: 'decreases',  hint: 'subtracts from field' },
  { value: 'multiplies', label: 'multiplies', hint: 'scales field by factor' },
  { value: 'divides',    label: 'divides',    hint: 'divides field by factor' },
  { value: 'sets',       label: 'sets',       hint: 'replaces field value' },
];

// ── ComboToken — controlled searchable picker ─────────────────────────────────

function ComboToken({
  fieldKey,
  value,
  placeholder,
  options,
  onSelect,
  hierarchical = false,
  allowCreate = false,
  editingField,
  onEdit,
  onDone,
  onTabNext,
  onTabPrev,
}: {
  fieldKey: string;
  value: string;
  placeholder: string;
  options: ComboOption[];
  onSelect: (v: string) => void;
  hierarchical?: boolean;
  /** When true, typing a value not in the list shows a "Create 'X'" option. */
  allowCreate?: boolean;
  editingField: string | null;
  onEdit: (f: string) => void;
  onDone: () => void;
  onTabNext?: () => void;
  onTabPrev?: () => void;
}) {
  const isOpen = editingField === fieldKey;
  const [search, setSearch] = useState('');
  const [browsePath, setBrowsePath] = useState<string[]>([]);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset internal search/path/highlight when closed
  useEffect(() => {
    if (!isOpen) { setSearch(''); setBrowsePath([]); setHighlightIdx(-1); }
  }, [isOpen]);

  // Reset highlight whenever the search or browse context changes
  useEffect(() => { setHighlightIdx(-1); }, [search, browsePath]);

  // Scroll highlighted option into view
  useEffect(() => {
    if (highlightIdx < 0) return;
    listRef.current?.querySelector<HTMLElement>('[data-highlighted]')?.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx]);

  // Click-outside closes
  useEffect(() => {
    if (!isOpen) return;
    function handle(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onDone();
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [isOpen, onDone]);

  function handleSelect(v: string) { onSelect(v); onDone(); onTabNext?.(); }

  // If value matches an option, show its label. If value is a UUID with no matching option,
  // it's a broken cross-reference — treat it as unset so the placeholder is shown instead.
  const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const matchedOption = options.find((o) => o.value === value);
  const isUnresolvedRef = !matchedOption && GUID_RE.test(value ?? '');
  const currentLabel = matchedOption?.label ?? (isUnresolvedRef ? null : value || null);

  // For allowCreate: whether the current search text is a new value not yet in options
  const trimmedSearch = search.trim();
  const searchIsNew = allowCreate && trimmedSearch.length > 0 &&
    !options.some((o) => o.value.toLowerCase() === trimmedSearch.toLowerCase());
  const isSearching = search.length > 0;

  // Build list items (groups + leaves)
  type GroupItem = { kind: 'group'; segment: string; fullPath: string };
  type LeafItem = { kind: 'leaf' } & ComboOption;
  type ListItem = GroupItem | LeafItem;

  let listItems: ListItem[];
  if (isSearching) {
    const q = search.toLowerCase();
    listItems = options
      .filter((o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        (o.path?.toLowerCase().includes(q) ?? false),
      )
      .map((o) => ({ kind: 'leaf' as const, ...o }));
  } else if (hierarchical) {
    const prefix = browsePath.length > 0 ? browsePath.join('.') + '.' : '';
    const leaves: LeafItem[] = options
      .filter((o) => {
        const p = o.path ?? '';
        if (!p.startsWith(prefix)) return false;
        const rest = p.slice(prefix.length);
        return rest !== '' && !rest.includes('.');
      })
      .map((o) => ({ kind: 'leaf' as const, ...o }));
    const groupMap = new Map<string, string>();
    for (const o of options) {
      const p = o.path ?? '';
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      if (rest.includes('.')) {
        const seg = rest.split('.')[0];
        if (!groupMap.has(seg)) groupMap.set(seg, prefix + seg);
      }
    }
    listItems = [
      ...Array.from(groupMap.entries()).map(([segment, fullPath]) => ({
        kind: 'group' as const, segment, fullPath,
      })),
      ...leaves,
    ];
  } else {
    listItems = options.map((o) => ({ kind: 'leaf' as const, ...o }));
  }

  return (
    <div className="combo-token-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`grant-token${(!value || isUnresolvedRef) ? ' grant-token-empty' : ''}`}
        onClick={() => isOpen ? onDone() : onEdit(fieldKey)}
      >
        {currentLabel ?? placeholder}
      </button>

      {isOpen && (
        <div className="combo-dropdown" role="dialog">
          <div className="combo-search-wrap">
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input
              autoFocus
              type="text"
              className="combo-search"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { onDone(); }
                if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightIdx((i) => Math.min(i + 1, listItems.length - 1)); }
                if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightIdx((i) => Math.max(i - 1, -1)); }
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (highlightIdx >= 0 && highlightIdx < listItems.length) {
                    const item = listItems[highlightIdx];
                    if (item.kind === 'leaf') handleSelect(item.value);
                    else { setBrowsePath(item.fullPath.split('.')); setHighlightIdx(-1); }
                  } else if (highlightIdx < 0 && listItems.length === 1 && listItems[0].kind === 'leaf') {
                    handleSelect(listItems[0].value);
                  } else if (searchIsNew) {
                    handleSelect(trimmedSearch);
                  }
                }
                if (e.key === 'Tab') {
                  e.preventDefault();
                  if (!e.shiftKey && search.trim()) {
                    // Try to match before advancing: highlighted item, single match, or exact match
                    if (highlightIdx >= 0 && highlightIdx < listItems.length) {
                      const item = listItems[highlightIdx];
                      if (item.kind === 'leaf') { handleSelect(item.value); return; }
                    } else if (listItems.length === 1 && listItems[0].kind === 'leaf') {
                      handleSelect(listItems[0].value); return;
                    }
                  }
                  e.shiftKey ? (onTabPrev ? onTabPrev() : onDone()) : (onTabNext ? onTabNext() : onDone());
                }
              }}
            />
          </div>

          {hierarchical && !isSearching && browsePath.length > 0 && (
            <div className="combo-breadcrumb">
              <button type="button" className="combo-crumb" onClick={() => setBrowsePath([])}>root</button>
              {browsePath.map((seg, i) => (
                <span key={seg + i} style={{ display: 'contents' }}>
                  <span className="combo-crumb-sep"> / </span>
                  <button type="button" className="combo-crumb"
                    onClick={() => setBrowsePath(browsePath.slice(0, i + 1))}>
                    {seg}
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="combo-list" role="listbox" ref={listRef}>
            {searchIsNew && (
              <button type="button" className="combo-option combo-option-create"
                onClick={() => handleSelect(trimmedSearch)}>
                Create <strong>"{trimmedSearch}"</strong>
              </button>
            )}
            {listItems.length === 0 && !searchIsNew && <div className="combo-empty">No matches</div>}
            {listItems.map((item, idx) => {
              const isHighlighted = idx === highlightIdx;
              if (item.kind === 'group') {
                return (
                  <button key={item.fullPath} type="button"
                    className={`combo-option is-group${isHighlighted ? ' is-highlighted' : ''}`}
                    data-highlighted={isHighlighted || undefined}
                    onClick={() => { setBrowsePath(item.fullPath.split('.')); setHighlightIdx(-1); }}>
                    <span className="combo-option-label">{item.segment}</span>
                    <span className="combo-option-arrow">›</span>
                  </button>
                );
              }
              return (
                <button key={item.value} type="button"
                  className={`combo-option${item.value === value ? ' is-selected' : ''}${isHighlighted ? ' is-highlighted' : ''}`}
                  data-highlighted={isHighlighted || undefined}
                  onClick={() => handleSelect(item.value)}>
                  <span className="combo-option-label">{item.label}</span>
                  {item.hint && <span className="combo-option-hint">{item.hint}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Token — prose text that becomes an input when active ─────────────────────

function Token({
  fieldKey, value, placeholder, editingField, onEdit, onChange, onDone, onTabNext, onTabPrev,
  inputType = 'text', size = 'sm',
}: {
  fieldKey: string; value: string; placeholder: string;
  editingField: string | null;
  onEdit: (f: string) => void; onChange: (v: string) => void;
  onDone: () => void; onTabNext?: () => void; onTabPrev?: () => void;
  inputType?: string; size?: 'sm' | 'md' | 'lg';
}) {
  // Prevent onBlur from closing when Tab is already handling focus move
  const tabbing = useRef(false);

  if (editingField === fieldKey) {
    return (
      <input
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        type={inputType}
        value={value}
        placeholder={placeholder}
        className={`grant-token-input grant-token-input-${size}`}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => {
          if (tabbing.current) { tabbing.current = false; return; }
          onDone();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onDone(); }
          if (e.key === 'Escape') { onDone(); }
          if (e.key === 'Tab') {
            e.preventDefault();
            tabbing.current = true;
            e.shiftKey ? (onTabPrev ? onTabPrev() : onDone()) : (onTabNext ? onTabNext() : onDone());
          }
        }}
      />
    );
  }
  return (
    <button type="button"
      className={`grant-token${!value.trim() ? ' grant-token-empty' : ''}`}
      title={`Click to edit ${placeholder}`}
      onClick={() => onEdit(fieldKey)}>
      {value.trim() || placeholder}
    </button>
  );
}

// ── Slot type vocabulary ──────────────────────────────────────────────────────

/**
 * Collect all slotType strings currently defined in the rule set.
 * Scans the body of every trait definition in the rule set (to pick up slot types
 * authored in other traits) plus the live `currentGrants` being edited right now
 * (so newly typed values show up immediately as options in the same editor session).
 */
function extractSlotTypes(
  traitDefinitions: RuleDefinitionResource[],
  currentGrants: GrantDraft[],
): ComboOption[] {
  const seen = new Set<string>();
  // From persisted trait bodies
  for (const def of traitDefinitions) {
    if (def.body?.metamodelVersion !== 'trait/1' || !Array.isArray(def.body.grants)) continue;
    for (const g of def.body.grants as GrantEntry[]) {
      if (g.dataType === 'slot') {
        // New format: slotTypes array
        if (Array.isArray(g.slotTypes)) { for (const t of g.slotTypes) { if (t?.trim()) seen.add(t.trim()); } }
        // Legacy format: single slotType string
        else if (typeof (g as any).slotType === 'string' && (g as any).slotType.trim()) { seen.add((g as any).slotType.trim()); }
      }
    }
  }
  // From the grant rows being authored right now
  for (const g of currentGrants) {
    if (g.dataType === 'slot') { for (const t of g.slotGrantTypes) { if (t.trim()) seen.add(t.trim()); } }
  }
  return Array.from(seen).sort().map((t) => ({ value: t, label: t }));
}

// ── Terminal property resolution ──────────────────────────────────────────────

type ResolvedGrant = { dataType: GrantDataType; allowedValues?: string[] };

/**
 * Given a complete modifier path (segments), resolve the terminal property's
 * grant definition so the value control can adapt its type.
 *
 * For actor-relative paths (self / owner):
 *   2 segments  → property is directly on one of the prerequisites
 *   3+ segments → segments[-2] is a trait slug or named sub-trait key
 *
 * Falls back to a generic search across all traitDefinitions if no match found.
 */
function resolveTerminalGrant(
  segments: string[],
  traitDefinitions: RuleDefinitionResource[],
  prerequisiteIds: string[],
  siblingGrants: GrantDraft[] = [],
): ResolvedGrant | null {
  if (segments.length < 2) return null;
  const propertyKey = segments.at(-1);
  if (!propertyKey) return null;
  const traitSeg = segments.at(-2)!;

  const prereqs = filterPrereqDefs(traitDefinitions, prerequisiteIds);

  let searchIn: RuleDefinitionResource[];
  if (ACTOR_RELATIVE_ROOTS.has(traitSeg)) {
    // Two-segment path: search all prerequisites for the property
    searchIn = prereqs.length ? prereqs : traitDefinitions;
  } else {
    // Named sub-trait key (e.g. 'senses' in self.senses.vision) takes priority over slug
    const namedDef = resolveNamedTraitGrantDef(traitSeg, traitDefinitions, prerequisiteIds, siblingGrants);
    if (namedDef) {
      searchIn = [namedDef];
    } else {
      // Fall back to prerequisite trait slug
      const matched = prereqs.find((d) => traitSlug(d, 'leaf') === traitSeg);
      searchIn = matched ? [matched] : traitDefinitions;
    }
  }

  for (const def of searchIn) {
    if (def.body?.metamodelVersion !== 'trait/1' || !Array.isArray(def.body.grants)) continue;
    for (const g of def.body.grants as GrantEntry[]) {
      if (g.key === propertyKey) {
        return { dataType: g.dataType, allowedValues: g.allowedValues };
      }
    }
  }
  return null;
}

// ── ModifierPathEditor — single popup for the whole segment path ──────────────

const ACTOR_RELATIVE_ROOTS = new Set(['self', 'owner']);

function ModifierPathEditor({
  segments, traitDefinitions, prerequisiteIds, siblingGrants, operation, isTerminalResolved, fieldKey, editingField, onEdit, onDone, onTabNext, onTabPrev, onChange,
}: {
  segments: string[];
  traitDefinitions: RuleDefinitionResource[];
  prerequisiteIds: string[];
  /** Named trait grants from the current trait's own draft — enables sub-trait path navigation */
  siblingGrants: GrantDraft[];
  /** Current modifier operation — narrows property options at the terminal depth */
  operation: ModifierOperation;
  /** When true, the path has resolved to a known terminal property — adding further segments is blocked */
  isTerminalResolved?: boolean;
  fieldKey: string;
  editingField: string | null;
  onEdit: (f: string) => void;
  onDone: () => void;
  onTabNext?: () => void;
  onTabPrev?: () => void;
  onChange: (segments: string[]) => void;
}) {
  const isOpen = editingField === fieldKey;
  const [activeIdx, setActiveIdx] = useState(0);
  const [search, setSearch] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pathListRef = useRef<HTMLDivElement>(null);

  // Reset on close
  useEffect(() => {
    if (!isOpen) { setActiveIdx(0); setSearch(''); setHighlightIdx(-1); }
  }, [isOpen]);

  // Reset highlight when search or active segment changes
  useEffect(() => { setHighlightIdx(-1); }, [search, activeIdx]);

  // Scroll highlighted option into view
  useEffect(() => {
    if (highlightIdx < 0) return;
    pathListRef.current?.querySelector<HTMLElement>('[data-highlighted]')?.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx]);

  // Focus search whenever popup opens or active segment changes
  useEffect(() => {
    if (isOpen) searchRef.current?.focus();
  }, [isOpen, activeIdx]);

  // Click-outside closes
  useEffect(() => {
    if (!isOpen) return;
    function handle(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onDone();
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [isOpen, onDone]);

  function pickValue(value: string) {
    const filled = [...segments];
    if (activeIdx < filled.length) filled[activeIdx] = value;
    else filled.push(value);
    setSearch('');

    const resolved = resolveTerminalGrant(filled, traitDefinitions, prerequisiteIds, siblingGrants);
    if (resolved) {
      // Terminal reached — commit, close popup, advance to value field
      onChange(filled);
      onDone();
      onTabNext?.();
    } else {
      // More segments needed — auto-add the next slot and advance into it
      const next = [...filled, ''];
      onChange(next);
      setActiveIdx(filled.length); // index of the new empty slot
    }
  }

  function addSegment() {
    onChange([...segments, '']);
    setActiveIdx(segments.length);
    setSearch('');
  }

  function removeSegment(idx: number) {
    const updated = segments.filter((_, i) => i !== idx);
    onChange(updated);
    setActiveIdx(Math.min(activeIdx, Math.max(0, updated.length - 1)));
    setSearch('');
  }

  const displayPath = segments.filter(Boolean).join(' › ');
  const options = buildSegmentOptions(activeIdx, segments, traitDefinitions, prerequisiteIds, operation, siblingGrants);
  const trimmedSearch = search.trim();
  const filtered = trimmedSearch
    ? options.filter((o) => o.value.toLowerCase().includes(trimmedSearch.toLowerCase()))
    : options;
  const searchIsNew = trimmedSearch.length > 0 &&
    !options.some((o) => o.value.toLowerCase() === trimmedSearch.toLowerCase());

  // Always render the wrapper so the dropdown anchors under the token
  return (
    <div className="combo-token-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`grant-token${!displayPath ? ' grant-token-empty' : ''}`}
        onClick={() => { setActiveIdx(0); onEdit(fieldKey); }}
      >
        {displayPath || '— path —'}
      </button>

      {isOpen && (
        <div className="combo-dropdown" role="dialog">
          {/* Breadcrumb row — reuses grant-token styling for consistency */}
          <div className="combo-search-wrap" style={{ display: 'flex', alignItems: 'center', gap: '2px', flexWrap: 'wrap' }}>
            {segments.map((seg, i) => (
              <span key={i} style={{ display: 'contents' }}>
                {i > 0 && <span style={{ opacity: 0.4, padding: '0 1px', userSelect: 'none' }}>.</span>}
                <button
                  type="button"
                  className={`grant-token${!seg ? ' grant-token-empty' : ''}${i === activeIdx ? ' is-active' : ''}`}
                  onClick={() => { setActiveIdx(i); setSearch(''); }}
                >
                  {seg || '—'}
                </button>
                <button
                  type="button"
                  className="guided-grant-trait-ref-remove"
                  aria-label={`Remove segment ${i + 1}`}
                  onClick={() => removeSegment(i)}
                >×</button>
              </span>
            ))}
            {!isTerminalResolved && (
              <button type="button" className="secondary-action compact-action" onClick={addSegment}>
                {segments.length === 0 ? '+ segment' : '+ .'}
              </button>
            )}
          </div>

          {/* Search for the active segment */}
          <div className="combo-search-wrap">
            <input
              ref={searchRef}
              type="text"
              className="combo-search"
              placeholder={activeIdx === 0 ? 'self, owner, target…' : 'subtrait or property…'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { onDone(); }
                if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightIdx((i) => Math.min(i + 1, filtered.length - 1)); }
                if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightIdx((i) => Math.max(i - 1, -1)); }
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (highlightIdx >= 0 && highlightIdx < filtered.length) { pickValue(filtered[highlightIdx].value); }
                  else if (highlightIdx < 0 && filtered.length === 1) { pickValue(filtered[0].value); }
                  else if (searchIsNew) { pickValue(trimmedSearch); }
                }
                if (e.key === 'Tab') {
                  e.preventDefault();
                  if (e.shiftKey) { onTabPrev ? onTabPrev() : onDone(); }
                  else if (isTerminalResolved && onTabNext) { onTabNext(); }
                  else { onDone(); }
                }
              }}
            />
          </div>

          {/* Options for the active segment */}
          <div className="combo-list" role="listbox" ref={pathListRef}>
            {searchIsNew && (
              <button type="button" className="combo-option combo-option-create"
                onClick={() => pickValue(trimmedSearch)}>
                Use <strong>"{trimmedSearch}"</strong>
              </button>
            )}
            {filtered.length === 0 && !searchIsNew && <div className="combo-empty">No matches</div>}
            {filtered.map((opt, idx) => {
              const isHighlighted = idx === highlightIdx;
              return (
              <button
                key={opt.value}
                type="button"
                className={`combo-option${opt.value === segments[activeIdx] ? ' is-selected' : ''}${isHighlighted ? ' is-highlighted' : ''}`}
                data-highlighted={isHighlighted || undefined}
                onClick={() => pickValue(opt.value)}
              >
                <span className="combo-option-label">{opt.label}</span>
                {opt.hint && <span className="combo-option-hint">{opt.hint}</span>}
              </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Grant row ─────────────────────────────────────────────────────────────────

function GrantRow({
  grant, traitDefinitions, prerequisiteIds, siblingGrants, slotTypeOptions, autoFocus, onChange, onRemove,
}: {
  grant: GrantDraft;
  traitDefinitions: RuleDefinitionResource[];
  prerequisiteIds: string[];
  /** All grants in the same trait — enables sub-trait path navigation */
  siblingGrants: GrantDraft[];
  slotTypeOptions: ComboOption[];
  /** When true, opens the first field for editing immediately on mount */
  autoFocus?: boolean;
  onChange: (patch: Partial<GrantDraft>) => void;
  onRemove: () => void;
}) {
  const [editingField, setEditingField] = useState<string | null>(null);

  function edit(f: string) { setEditingField(f); }
  function done() { setEditingField(null); }

  // Auto-open the first field when a new row is added.
  // Skip 'dataType' — the user already chose the type by clicking the add button.
  useEffect(() => {
    if (autoFocus) {
      const fields = getTabFields(grant.dataType);
      const firstField = fields[0] === 'dataType' ? fields[1] : fields[0];
      if (firstField) edit(firstField);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount only

  function tabFrom(fieldKey: string, direction: 'next' | 'prev' = 'next') {
    // Slot and slot-affinity have dynamic field lists; compute them inline.
    let fields: string[];
    if (grant.dataType === 'modifier') {
      fields = ['dataType', 'modifierOperation', 'modifierPath', 'modifierAmount'];
    } else if (grant.dataType === 'slot') {
      fields = [
        'dataType',
        ...grant.slotGrantTypes.map((_, i) => `slotGrantType_${i}`),
        'slotCount', 'label',
        ...grant.acceptedTraits.map((_, i) => `acceptedTrait_${i}`),
      ];
    } else if (grant.dataType === 'slot-affinity') {
      fields = ['dataType', ...grant.slotAffinityTypes.map((_, i) => `slotAffinityType_${i}`)];
    } else {
      fields = getTabFields(grant.dataType);
    }
    const idx = fields.indexOf(fieldKey);
    if (direction === 'next') {
      setEditingField(idx >= 0 && idx < fields.length - 1 ? fields[idx + 1] : null);
    } else {
      setEditingField(idx > 0 ? fields[idx - 1] : null);
    }
  }

  // Convenience: shared props for ComboToken / Token in this row
  function ct(fieldKey: string) {
    return { fieldKey, editingField, onEdit: edit, onDone: done, onTabNext: () => tabFrom(fieldKey, 'next'), onTabPrev: () => tabFrom(fieldKey, 'prev') };
  }
  function tok(fieldKey: string) {
    return { fieldKey, editingField, onEdit: edit, onDone: done, onTabNext: () => tabFrom(fieldKey, 'next'), onTabPrev: () => tabFrom(fieldKey, 'prev') };
  }

  const traitOptions: ComboOption[] = traitDefinitions.map((def) => {
    const rawId = def.externalId ?? '';
    const pathPart = rawId.startsWith('trait:') ? rawId.slice(6) : rawId;
    return {
      value: rawId, label: def.name,
      path: pathPart.includes('.') ? pathPart : undefined,
    };
  });
  const hasHierarchy = traitOptions.some((o) => o.path != null);

  // ── Modifier sentence: "[modifier] [op] [path popup] to/by [value]" ──────
  if (grant.dataType === 'modifier') {
    const resolvedTerminal = resolveTerminalGrant(
      grant.modifierFieldSegments, traitDefinitions, prerequisiteIds, siblingGrants,
    );
    const terminalType = resolvedTerminal?.dataType ?? null;

    // Only increases/decreases/sets make sense for numbers; everything else is sets-only
    const opOptions = (terminalType === null || terminalType === 'number')
      ? MODIFIER_OP_OPTIONS
      : MODIFIER_OP_OPTIONS.filter((o) => o.value === 'sets');

    const prep = grant.modifierOperation === 'sets' ? 'to' : 'by';

    // Value control — only shown once path resolves to a known property type
    let valueNode: React.ReactNode = null;
    if (terminalType === 'boolean') {
      valueNode = (
        <ComboToken {...ct('modifierAmount')} value={grant.modifierAmount}
          placeholder="true / false"
          options={[{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }]}
          onSelect={(v) => onChange({ modifierAmount: v })} />
      );
    } else if (terminalType === 'enum' && resolvedTerminal?.allowedValues?.length) {
      valueNode = (
        <ComboToken {...ct('modifierAmount')} value={grant.modifierAmount}
          placeholder="value"
          options={resolvedTerminal.allowedValues.map((v) => ({ value: v, label: v }))}
          onSelect={(v) => onChange({ modifierAmount: v })} />
      );
    } else if (terminalType === 'text') {
      valueNode = (
        <Token {...tok('modifierAmount')} value={grant.modifierAmount}
          placeholder="value" inputType="text"
          onChange={(v) => onChange({ modifierAmount: v })} />
      );
    } else if (terminalType === 'number') {
      valueNode = (
        <Token {...tok('modifierAmount')} value={grant.modifierAmount}
          placeholder="0" inputType="number"
          onChange={(v) => onChange({ modifierAmount: v })} />
      );
    }
    // terminalType === null → no value control yet

    return (
      <div className="guided-grant-sentence">
        <ComboToken {...ct('dataType')} value={grant.dataType} placeholder="type"
          options={DATA_TYPE_OPTIONS} onSelect={(v) => onChange({ dataType: v as GrantDataType })} />
        <ComboToken {...ct('modifierOperation')} value={grant.modifierOperation}
          placeholder="increases" options={opOptions}
          onSelect={(v) => onChange({ modifierOperation: v as ModifierOperation })} />
        <ModifierPathEditor
          fieldKey="modifierPath"
          segments={grant.modifierFieldSegments}
          traitDefinitions={traitDefinitions}
          prerequisiteIds={prerequisiteIds}
          siblingGrants={siblingGrants}
          operation={grant.modifierOperation}
          isTerminalResolved={terminalType !== null}
          editingField={editingField}
          onEdit={edit}
          onDone={done}
          onTabNext={() => tabFrom('modifierPath', 'next')}
          onTabPrev={() => tabFrom('modifierPath', 'prev')}
          onChange={(segs) => {
            const resolved = resolveTerminalGrant(segs, traitDefinitions, prerequisiteIds, siblingGrants);
            const tt = resolved?.dataType ?? null;
            const patch: Partial<GrantDraft> = { modifierFieldSegments: segs, modifierAmount: '' };
            // Non-numeric types only support 'sets'
            if (tt !== null && tt !== 'number') patch.modifierOperation = 'sets';
            onChange(patch);
          }}
        />
        {terminalType !== null && prep}
        {valueNode}
        <button type="button" className="guided-grant-remove" aria-label="Remove" onClick={onRemove}>×</button>
      </div>
    );
  }

  // ── Slot-affinity sentence: "[slot-affinity] → fits in: [head ×] [+]" ─────────
  if (grant.dataType === 'slot-affinity') {
    return (
      <div className="guided-grant-sentence">
        <ComboToken {...ct('dataType')} value={grant.dataType} placeholder="type"
          options={DATA_TYPE_OPTIONS} onSelect={(v) => onChange({ dataType: v as GrantDataType })} />
        → fits in
        <button
          type="button"
          className={`slot-affinity-mode-toggle${grant.slotAffinityMode === 'all' ? ' is-all' : ''}`}
          title={grant.slotAffinityMode === 'any'
            ? 'Currently: matches any listed slot type (OR). Click to switch to ALL (AND).'
            : 'Currently: requires all listed slot types (AND). Click to switch to ANY (OR).'}
          onClick={() => onChange({ slotAffinityMode: grant.slotAffinityMode === 'any' ? 'all' : 'any' })}
        >{grant.slotAffinityMode === 'any' ? 'any' : 'all'} of:</button>
        {grant.slotAffinityTypes.map((slotType, i) => (
          <span key={i} className="guided-grant-trait-ref">
            <ComboToken
              {...ct(`slotAffinityType_${i}`)}
              value={slotType}
              placeholder="— slot type —"
              options={slotTypeOptions}
              allowCreate
              onSelect={(v) => {
                const updated = [...grant.slotAffinityTypes];
                updated[i] = v;
                onChange({ slotAffinityTypes: updated });
              }}
            />
            <button
              type="button"
              className="guided-grant-trait-ref-remove"
              aria-label="Remove slot type"
              onClick={() => onChange({ slotAffinityTypes: grant.slotAffinityTypes.filter((_, j) => j !== i) })}
            >×</button>
          </span>
        ))}
        <button
          type="button"
          className="secondary-action compact-action"
          onClick={() => onChange({ slotAffinityTypes: [...grant.slotAffinityTypes, ''] })}
        >+ slot type</button>
        <button type="button" className="guided-grant-remove" aria-label="Remove" onClick={onRemove}>×</button>
      </div>
    );
  }

  // ── Slot sentence: "[slot] [type] → [count] [label] slot(s) accepting: [trait] [+]" ─
  if (grant.dataType === 'slot') {
    return (
      <div className="guided-grant-sentence">
        <ComboToken {...ct('dataType')} value={grant.dataType} placeholder="type"
          options={DATA_TYPE_OPTIONS} onSelect={(v) => onChange({ dataType: v as GrantDataType })} />
        {grant.slotGrantTypes.map((tag, i) => (
          <span key={i} className="guided-grant-trait-ref">
            <ComboToken
              {...ct(`slotGrantType_${i}`)}
              value={tag}
              placeholder="— type —"
              options={slotTypeOptions}
              allowCreate
              onSelect={(v) => {
                const updated = [...grant.slotGrantTypes];
                updated[i] = v;
                onChange({ slotGrantTypes: updated });
              }}
            />
            <button type="button" className="guided-grant-trait-ref-remove" aria-label="Remove type tag"
              onClick={() => onChange({ slotGrantTypes: grant.slotGrantTypes.filter((_, j) => j !== i) })}>×</button>
          </span>
        ))}
        <button type="button" className="secondary-action compact-action"
          onClick={() => onChange({ slotGrantTypes: [...grant.slotGrantTypes, ''] })}>+ type</button>
        →
        <Token {...tok('slotCount')} value={grant.slotCount} placeholder="1"
          inputType="number" onChange={(v) => onChange({ slotCount: v })} />
        <Token {...tok('label')} value={grant.label} placeholder="slot label"
          size="md" onChange={(v) => onChange({ label: v })} />
        {' '}slot(s) accepting
        <button
          type="button"
          className={`slot-affinity-mode-toggle${grant.acceptedTraitsMode === 'all' ? ' is-all' : ''}`}
          title={grant.acceptedTraitsMode === 'any'
            ? 'Currently: accepts items with any of the listed traits (OR). Click to switch to ONLY (AND).'
            : 'Currently: requires items to have all listed traits (AND). Click to switch to ANY OF (OR).'}
          onClick={() => onChange({ acceptedTraitsMode: grant.acceptedTraitsMode === 'any' ? 'all' : 'any' })}
        >{grant.acceptedTraitsMode === 'any' ? 'any of:' : 'all of:'}</button>
        {grant.acceptedTraits.map((ref, i) => (
          <span key={i} className="guided-grant-trait-ref">
            <ComboToken
              {...ct(`acceptedTrait_${i}`)}
              value={ref}
              placeholder="— select trait —"
              options={traitOptions}
              hierarchical={hasHierarchy}
              onSelect={(v) => {
                const updated = [...grant.acceptedTraits];
                updated[i] = v;
                onChange({ acceptedTraits: updated });
              }}
            />
            <button
              type="button"
              className="guided-grant-trait-ref-remove"
              aria-label="Remove trait requirement"
              onClick={() => onChange({ acceptedTraits: grant.acceptedTraits.filter((_, j) => j !== i) })}
            >×</button>
          </span>
        ))}
        <button
          type="button"
          className="secondary-action compact-action"
          onClick={() => onChange({ acceptedTraits: [...grant.acceptedTraits, ''] })}
        >+ trait</button>
        <button type="button" className="guided-grant-remove" aria-label="Remove" onClick={onRemove}>×</button>
      </div>
    );
  }

  // ── Trait sentence: "[trait] → [name]" ────────────────────────────────────
  if (grant.dataType === 'trait') {
    return (
      <div className="guided-grant-sentence">
        <ComboToken {...ct('dataType')} value={grant.dataType} placeholder="type"
          options={DATA_TYPE_OPTIONS} onSelect={(v) => onChange({ dataType: v as GrantDataType })} />
        →
        <ComboToken {...ct('ref')} value={grant.ref} placeholder="— select trait —"
          options={traitOptions} onSelect={(v) => onChange({ ref: v })} hierarchical={hasHierarchy} />
        {' as '}
        <Token {...tok('key')} value={grant.key} placeholder="path name"
          onChange={(v) => onChange({ key: v })} />
        <button type="button" className="guided-grant-remove" aria-label="Remove" onClick={onRemove}>×</button>
      </div>
    );
  }

  // ── Standard field sentence ───────────────────────────────────────────────
  //
  // "[key] is a [required/optional] [type] field
  //   [number: ranging from [min] to [max]]
  //   [enum:   choosing from ([values])]
  //   with a default value of [default]
  //   and labeled as [label]"

  const defaultNode = (() => {
    if (grant.dataType === 'number')
      return <Token {...tok('defaultNum')} value={grant.defaultNum} placeholder="—"
               inputType="number" onChange={(v) => onChange({ defaultNum: v })} />;
    if (grant.dataType === 'boolean')
      return <ComboToken {...ct('defaultStr')} value={grant.defaultStr}
               placeholder="true / false" options={BOOL_OPTIONS}
               onSelect={(v) => onChange({ defaultStr: v })} />;
    // text or enum
    return <Token {...tok('defaultStr')} value={grant.defaultStr} placeholder="none"
             size="md" onChange={(v) => onChange({ defaultStr: v })} />;
  })();

  return (
    <div className="guided-grant-sentence">

      <Token {...tok('key')} value={grant.key} placeholder="field.name"
        size="md" onChange={(v) => onChange({ key: v })} />

      {' '}is a{' '}

      <button type="button"
        className={`grant-required-toggle${grant.required ? ' is-required' : ''}`}
        title="Click to toggle" onClick={() => onChange({ required: !grant.required })}>
        {grant.required ? 'required' : 'optional'}
      </button>

      <ComboToken {...ct('dataType')} value={grant.dataType} placeholder="type"
        options={DATA_TYPE_OPTIONS} onSelect={(v) => onChange({ dataType: v as GrantDataType })} />

      {' '}field labeled by{' '}

      <Token {...tok('label')} value={grant.label} placeholder="Display label"
        size="md" onChange={(v) => onChange({ label: v })} />

      {grant.dataType === 'number' && (
        <> with a range of{' '}
          <Token {...tok('min')} value={grant.min} placeholder="min"
            inputType="number" onChange={(v) => onChange({ min: v })} />
          {' '}to{' '}
          <Token {...tok('max')} value={grant.max} placeholder="max"
            inputType="number" onChange={(v) => onChange({ max: v })} />
          {', '}and a default value of {defaultNode}
        </>
      )}

      {grant.dataType === 'enum' && (
        <>, choosing from (<Token {...tok('allowedValues')} value={grant.allowedValues}
             placeholder="fire, ice, lightning" size="lg"
             onChange={(v) => onChange({ allowedValues: v })} />){', '}
          default {defaultNode}
        </>
      )}

      {(grant.dataType === 'text' || grant.dataType === 'boolean') && (
        <>, default {defaultNode}
        </>
      )}

      <button type="button" className="guided-grant-remove" aria-label="Remove" onClick={onRemove}>×</button>
    </div>
  );
}

// ── Editor ────────────────────────────────────────────────────────────────────

const DEFAULT_PREREQS: PrerequisiteSpec = { mode: 'any', ids: [] };

export function GuidedTraitGrantsEditor({
  traitName, grants, prerequisites = DEFAULT_PREREQS, traitDefinitions, onChange, onPrerequisitesChange,
}: {
  traitName: string;
  grants: GrantDraft[];
  prerequisites?: PrerequisiteSpec;
  traitDefinitions: RuleDefinitionResource[];
  onChange: (grants: GrantDraft[]) => void;
  onPrerequisitesChange?: (prerequisites: PrerequisiteSpec) => void;
}) {
  const [prereqEditingIndex, setPrereqEditingIndex] = useState<number | null>(null);
  const [prereqModeEditing, setPrereqModeEditing] = useState(false);
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  const slotTypeOptions = useMemo(() => extractSlotTypes(traitDefinitions, grants), [traitDefinitions, grants]);

  function update(id: string, patch: Partial<GrantDraft>) {
    onChange(grants.map((g) => g._id === id ? { ...g, ...patch } : g));
  }
  function remove(id: string) { onChange(grants.filter((g) => g._id !== id)); }
  function add(dataType: GrantDataType) {
    const grant = newGrant(dataType);
    onChange([...grants, grant]);
    setLastAddedId(grant._id);
  }

  const traitOptions: ComboOption[] = traitDefinitions.map((def) => {
    const rawId = def.externalId ?? '';
    const pathPart = rawId.startsWith('trait:') ? rawId.slice(6) : rawId;
    return { value: rawId, label: def.name, path: pathPart.includes('.') ? pathPart : undefined };
  });
  const hasHierarchy = traitOptions.some((o) => o.path != null);

  function updatePrerequisiteId(index: number, value: string) {
    const ids = [...prerequisites.ids];
    ids[index] = value;
    onPrerequisitesChange?.({ ...prerequisites, ids });
  }
  function removePrerequisite(index: number) {
    onPrerequisitesChange?.({ ...prerequisites, ids: prerequisites.ids.filter((_, i) => i !== index) });
  }
  function addPrerequisite() {
    onPrerequisitesChange?.({ ...prerequisites, ids: [...prerequisites.ids, ''] });
    setPrereqEditingIndex(prerequisites.ids.length);
  }
  function setPrerequisiteMode(mode: 'any' | 'all') {
    onPrerequisitesChange?.({ ...prerequisites, mode });
  }

  return (
    <div className="guided-grants-editor rule-set-field-wide">

      {/* ── Prerequisites ── */}
      {onPrerequisitesChange && (
        <div className="guided-grants-prerequisites">
          <p className="guided-grants-narrative">
            <strong>{traitName.trim() || 'This trait'}</strong> requires the grantor to already have
            {prerequisites.ids.length >= 2 ? (
              <>
                {' '}
                <ComboToken
                  fieldKey="prereqMode"
                  value={prerequisites.mode}
                  placeholder="any of"
                  options={[
                    { value: 'any', label: 'any of', hint: 'at least one must be present' },
                    { value: 'all', label: 'all of', hint: 'every one must be present' },
                  ]}
                  editingField={prereqModeEditing ? 'prereqMode' : null}
                  onEdit={() => setPrereqModeEditing(true)}
                  onDone={() => setPrereqModeEditing(false)}
                  onSelect={(v) => { setPrerequisiteMode(v as 'any' | 'all'); setPrereqModeEditing(false); }}
                />
              </>
            ) : (
              ' the following'
            )}
            :
          </p>
          {prerequisites.ids.length === 0 ? (
            <p className="subtext guided-grants-empty">No prerequisites — this trait can always be applied.</p>
          ) : (
            <div className="guided-grants-list">
              {prerequisites.ids.map((ref, i) => (
                <div key={i} className="guided-grant-sentence">
                  <ComboToken
                    fieldKey={`prereq_${i}`}
                    value={ref}
                    placeholder="— select trait —"
                    options={traitOptions}
                    hierarchical={hasHierarchy}
                    editingField={prereqEditingIndex === i ? `prereq_${i}` : null}
                    onEdit={() => setPrereqEditingIndex(i)}
                    onDone={() => setPrereqEditingIndex(null)}
                    onSelect={(v) => { updatePrerequisiteId(i, v); setPrereqEditingIndex(null); }}
                  />
                  <button type="button" className="guided-grant-remove" aria-label="Remove prerequisite"
                    onClick={() => removePrerequisite(i)}>×</button>
                </div>
              ))}
            </div>
          )}
          <div className="guided-grants-add">
            <button type="button" className="secondary-action compact-action" onClick={addPrerequisite}>+ prerequisite</button>
          </div>
        </div>
      )}

      {/* ── Grants ── */}
      <p className="guided-grants-narrative" style={{ marginTop: onPrerequisitesChange ? '1.5rem' : undefined }}>
        <strong>{traitName.trim() || 'This trait'}</strong> grants the following to any entity that holds it:
      </p>

      <div className="guided-grants-add">
        <button type="button" className="secondary-action compact-action" onClick={() => add('text')}>+ text</button>
        <button type="button" className="secondary-action compact-action" onClick={() => add('number')}>+ number</button>
        <button type="button" className="secondary-action compact-action" onClick={() => add('boolean')}>+ true/false</button>
        <button type="button" className="secondary-action compact-action" onClick={() => add('enum')}>+ enum</button>
        <button type="button" className="secondary-action compact-action" onClick={() => add('trait')}>+ trait grant</button>
        <button type="button" className="secondary-action compact-action" onClick={() => add('modifier')}>+ modifier</button>
        <button type="button" className="secondary-action compact-action" onClick={() => add('slot')}>+ slot</button>
        <button type="button" className="secondary-action compact-action" onClick={() => add('slot-affinity')}>+ slot-affinity</button>
      </div>

      {grants.length > 0 && (
        <div className="guided-grants-list">
          {grants.map((grant) => (
            <GrantRow key={grant._id} grant={grant} traitDefinitions={traitDefinitions}
              prerequisiteIds={prerequisites.ids}
              siblingGrants={grants}
              slotTypeOptions={slotTypeOptions}
              autoFocus={grant._id === lastAddedId}
              onChange={(patch) => update(grant._id, patch)}
              onRemove={() => remove(grant._id)} />
          ))}
        </div>
      )}
    </div>
  );
}
