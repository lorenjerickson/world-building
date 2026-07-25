'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { RuleDefinitionResource } from '@/lib/rule-sets';
import {
  buildTraitShape,
  resolveTraitShapeTerminal,
  traitShapeChildren,
  type TraitShape,
  type TraitShapeGrant,
  type TraitShapeNode,
} from '@/lib/trait-shape';

// ── Types ─────────────────────────────────────────────────────────────────────

export type GrantDataType = 'text' | 'number' | 'boolean' | 'enum' | 'trait' | 'trait-collection' | 'modifier' | 'slot' | 'slot-affinity';
export type ModifierOperation = 'increases' | 'decreases' | 'multiplies' | 'divides' | 'sets';
export type ModifierMountSelectorMode = 'all' | 'ordinal';

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
  traitPlacement: 'named' | 'collection' | 'nested';
  traitCount: string;
  traitCollection: string;
  traitParentPath: string;
  // modifier — path expressed as ordered segments: [root][subtrait…][property]
  modifierOperation: ModifierOperation;
  modifierFieldSegments: string[];
  modifierAmount: string;
  modifierMountSelectorMode: ModifierMountSelectorMode;
  modifierMountOrdinal: string;
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
  metamodelVersion: 'trait/1' | 'trait/2';
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
  into?: string;
  at?: string;
  // modifier
  operation?: ModifierOperation;
  field?: string;
  amount?: boolean | number | string;
  mountSelector?: { mode: 'all' } | { mode: 'ordinal'; ordinal: number };
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
    traitPlacement: 'named', traitCount: '1', traitCollection: '', traitParentPath: '',
    modifierOperation: 'increases', modifierFieldSegments: [], modifierAmount: '',
    modifierMountSelectorMode: 'all', modifierMountOrdinal: '1',
    slotCount: '1', slotGrantTypes: [], acceptedTraits: [], acceptedTraitsMode: 'any', slotAffinityTypes: [], slotAffinityMode: 'any',
  };
}

function traitShapeGrantsFromDraft(grants: GrantDraft[]): TraitShapeGrant[] {
  return grants.map((grant) => ({
    key: grant.key,
    label: grant.label,
    dataType: grant.dataType,
    ref: grant.ref,
    acceptedTraits: grant.acceptedTraits,
    acceptsMode: grant.acceptedTraitsMode,
    ...(grant.dataType === 'trait' && grant.traitPlacement === 'collection'
      ? {
        count: Number(grant.traitCount),
        into: grant.traitCollection,
      }
      : {}),
    ...(grant.dataType === 'trait' && grant.traitPlacement === 'nested' && grant.traitParentPath.trim() && grant.key.trim()
      ? { at: `${grant.traitParentPath.trim()}.${grant.key.trim()}` }
      : {}),
    ...(grant.dataType === 'enum'
      ? { allowedValues: grant.allowedValues.split(',').map((value) => value.trim()).filter(Boolean) }
      : {}),
  }));
}

export function buildGrantsBody(
  grants: GrantDraft[],
  prerequisites: PrerequisiteSpec = { mode: 'any', ids: [] },
  traitDefinitions: RuleDefinitionResource[] = [],
  metamodelVersion: 'trait/1' | 'trait/2' = 'trait/2',
): TraitGrantsBody {
  const traitShape = buildTraitShape({
    definitions: traitDefinitions,
    prerequisiteIds: prerequisites.ids,
    prerequisiteMode: prerequisites.mode,
    draftGrants: traitShapeGrantsFromDraft(grants),
  });
  return {
    metamodelVersion,
    grants: grants.map((g): GrantEntry => {
      const entry: GrantEntry = { dataType: g.dataType };
      if (g.key.trim() && (g.dataType !== 'trait' || metamodelVersion === 'trait/1' && g.traitPlacement === 'named')) entry.key = g.key.trim();
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
        if (g.traitPlacement === 'collection') {
          if (g.traitCollection.trim()) {
            entry.into = (/^(self|this|owner|target)\./.test(g.traitCollection.trim())
              || metamodelVersion === 'trait/1')
                ? g.traitCollection.trim()
                : `this.${g.traitCollection.trim()}`;
          }
          if (g.traitCount !== '') entry.count = Number(g.traitCount);
        } else if (g.traitPlacement === 'nested' && g.traitParentPath.trim() && g.key.trim()) {
          const path = `${g.traitParentPath.trim()}.${g.key.trim()}`;
          entry.at = (/^(self|this|owner|target)\./.test(path) || metamodelVersion === 'trait/1')
            ? path
            : `this.${path}`;
        } else if (g.key.trim() && metamodelVersion === 'trait/2') {
          entry.at = `this.${g.key.trim()}`;
        }
      } else if (g.dataType === 'trait-collection') {
        if (g.acceptedTraits.length > 0) {
          entry.acceptedTraits = g.acceptedTraits.filter(Boolean);
          if (g.acceptedTraitsMode === 'all') entry.acceptsMode = 'all';
        }
      } else if (g.dataType === 'modifier') {
        entry.operation = g.modifierOperation;
        const segs = g.modifierFieldSegments.filter((s) => s.trim());
        if (segs.length > 0) entry.field = segs.join('.');
        if (segs.some((segment) => segment.endsWith('[]'))) {
          entry.mountSelector = g.modifierMountSelectorMode === 'ordinal'
            ? { mode: 'ordinal', ordinal: Number(g.modifierMountOrdinal) }
            : { mode: 'all' };
        }
        if (g.modifierAmount !== '') {
          const resolved = resolveTerminalGrant(g.modifierFieldSegments, traitShape, traitDefinitions);
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
  if (!['trait/1', 'trait/2'].includes(String(body.metamodelVersion))) return empty;
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
  if (!['trait/1', 'trait/2'].includes(String(body.metamodelVersion))) return null;
  if (!Array.isArray(body.grants)) return null;
  return (body.grants as GrantEntry[]).map((g): GrantDraft => ({
    _id: crypto.randomUUID(),
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
    traitPlacement: g.into
      ? 'collection'
      : g.at && !(g.at.startsWith('this.') && g.at.split('.').length === 2)
        ? 'nested'
        : 'named',
    traitCount: g.count != null && g.dataType === 'trait' ? String(g.count) : '1',
    traitCollection: g.into ?? '',
    traitParentPath: g.at && !(g.at.startsWith('this.') && g.at.split('.').length === 2)
      ? g.at.split('.').slice(0, -1).join('.')
      : '',
    key: g.at ? g.at.split('.').at(-1) ?? '' : g.key ?? '',
    modifierOperation: (g.operation ?? 'increases') as ModifierOperation,
    modifierFieldSegments: g.field ? g.field.split('.') : [],
    modifierAmount: g.amount != null ? String(g.amount) : '',
    modifierMountSelectorMode: g.mountSelector?.mode === 'ordinal' ? 'ordinal' : 'all',
    modifierMountOrdinal: g.mountSelector?.mode === 'ordinal' ? String(g.mountSelector.ordinal) : '1',
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
    case 'trait':         return ['dataType', 'traitCount', 'ref', 'key'];
    case 'trait-collection': return ['dataType', 'key'];
    case 'modifier':      return ['dataType', 'modifierOperation', 'modifierPath', 'modifierMountSelector', 'modifierMountOrdinal', 'modifierAmount'];
    case 'slot':          return ['dataType'];
    case 'slot-affinity': return ['dataType'];
  }
}

// ── Field path options ────────────────────────────────────────────────────────

function numericCompatible(op: ModifierOperation, dataType: GrantDataType): boolean {
  if (op === 'increases' || op === 'decreases' || op === 'multiplies' || op === 'divides') return dataType === 'number';
  return true; // 'sets' works with any type
}

function branchHasCompatibleTerminal(
  shape: TraitShape,
  branch: Extract<TraitShapeNode, { kind: 'branch' }>,
  operation: ModifierOperation,
): boolean {
  return shape.nodes.some((node) =>
    node.kind === 'terminal'
    && node.path.length > branch.path.length
    && branch.path.every((segment, index) => node.path[index] === segment)
    && numericCompatible(operation, node.dataType));
}

function collectionElementShape(
  shape: TraitShape,
  segments: string[],
  traitDefinitions: RuleDefinitionResource[],
): TraitShape | null {
  const repeatedIndex = segments.findIndex((segment) => segment.endsWith('[]'));
  if (repeatedIndex < 1) return null;
  const collectionPath = [
    ...segments.slice(1, repeatedIndex),
    segments[repeatedIndex].replace(/\[\]$/, ''),
  ];
  const collection = shape.nodes.find((node) =>
    node.kind === 'collection' && node.path.join('.') === collectionPath.join('.'));
  if (!collection || collection.kind !== 'collection' || !collection.acceptedTraitIds.length) return null;
  return buildTraitShape({
    definitions: traitDefinitions,
    prerequisiteIds: collection.acceptedTraitIds,
    prerequisiteMode: collection.acceptsMode,
  });
}

function collectionHasCompatibleTerminal(
  shape: TraitShape,
  collection: Extract<TraitShapeNode, { kind: 'collection' }>,
  operation: ModifierOperation,
  traitDefinitions: RuleDefinitionResource[],
): boolean {
  const elementShape = buildTraitShape({
    definitions: traitDefinitions,
    prerequisiteIds: collection.acceptedTraitIds,
    prerequisiteMode: collection.acceptsMode,
  });
  return elementShape.nodes.some((node) =>
    node.kind === 'terminal' && node.path.length === 1 && numericCompatible(operation, node.dataType));
}

/**
 * Build ComboOption[] for a single segment of a modifier field path.
 *
 * depth 0  — self / target / owner
 * depth 1+ — recursively composed branches and terminal fields
 */
function buildSegmentOptions(
  depth: number,
  segments: string[],
  operation: ModifierOperation,
  shape: TraitShape,
  traitDefinitions: RuleDefinitionResource[],
): ComboOption[] {
  if (depth === 0) {
    return [
      { value: 'self',   label: 'self'   },
      { value: 'this',   label: 'this'   },
      { value: 'target', label: 'target' },
      { value: 'owner',  label: 'owner'  },
    ];
  }

  const rootIsActorRelative = ACTOR_RELATIVE_ROOTS.has(segments[0] ?? '');
  if (!rootIsActorRelative) return [];

  const repeatedIndex = segments.findIndex((segment) => segment.endsWith('[]'));
  if (repeatedIndex >= 1 && depth > repeatedIndex) {
    if (depth !== repeatedIndex + 1) return [];
    const elementShape = collectionElementShape(shape, segments, traitDefinitions);
    if (!elementShape) return [];
    return traitShapeChildren(elementShape, [])
      .filter((node): node is Extract<TraitShapeNode, { kind: 'terminal' }> =>
        node.kind === 'terminal' && numericCompatible(operation, node.dataType))
      .map((node) => ({
        value: node.path.at(-1)!,
        label: node.label,
        hint: node.dataType,
      }));
  }

  const parentPath = segments.slice(1, depth).filter(Boolean);
  return traitShapeChildren(shape, parentPath)
    .filter((node) => node.kind === 'branch'
      ? branchHasCompatibleTerminal(shape, node, operation)
      : node.kind === 'collection'
        ? collectionHasCompatibleTerminal(shape, node, operation, traitDefinitions)
        : node.kind === 'terminal' && numericCompatible(operation, node.dataType))
    .map((node) => ({
      value: node.kind === 'collection' ? `${node.path.at(-1)!}[]` : node.path.at(-1)!,
      label: node.label,
      hint: node.kind === 'branch' ? 'trait' : node.kind === 'terminal' ? node.dataType : 'collection',
    }));
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
  { value: 'trait-collection', label: 'trait collection', hint: 'repeatable typed traits' },
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
    if (!['trait/1', 'trait/2'].includes(String(def.body?.metamodelVersion)) || !Array.isArray(def.body.grants)) continue;
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
 */
function resolveTerminalGrant(
  segments: string[],
  shape: TraitShape,
  traitDefinitions: RuleDefinitionResource[] = [],
): ResolvedGrant | null {
  if (segments.length < 2 || !ACTOR_RELATIVE_ROOTS.has(segments[0] ?? '')) return null;
  const repeatedIndex = segments.findIndex((segment) => segment.endsWith('[]'));
  const terminal = repeatedIndex >= 1
    ? segments.slice(repeatedIndex + 1).length === 1
      ? resolveTraitShapeTerminal(
        collectionElementShape(shape, segments, traitDefinitions) ?? { nodes: [], diagnostics: [] },
        segments.slice(repeatedIndex + 1),
      )
      : undefined
    : resolveTraitShapeTerminal(shape, segments.slice(1));
  return terminal
    ? { dataType: terminal.dataType, allowedValues: terminal.allowedValues }
    : null;
}

// ── ModifierPathEditor — single popup for the whole segment path ──────────────

const ACTOR_RELATIVE_ROOTS = new Set(['self', 'this', 'owner']);

function ModifierPathEditor({
  segments, shape, traitDefinitions, operation, isTerminalResolved, fieldKey, editingField, onEdit, onDone, onTabNext, onTabPrev, onChange,
}: {
  segments: string[];
  shape: TraitShape;
  traitDefinitions: RuleDefinitionResource[];
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

    const resolved = resolveTerminalGrant(filled, shape, traitDefinitions);
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
  const options = buildSegmentOptions(activeIdx, segments, operation, shape, traitDefinitions);
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
  collectionOptions, grant, nestedParentOptions, traitDefinitions, traitShape, slotTypeOptions, autoFocus, onChange, onRemove,
}: {
  collectionOptions: ComboOption[];
  grant: GrantDraft;
  nestedParentOptions: ComboOption[];
  traitDefinitions: RuleDefinitionResource[];
  traitShape: TraitShape;
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
      const repeated = grant.modifierFieldSegments.some((segment) => segment.endsWith('[]'));
      fields = [
        'dataType',
        'modifierOperation',
        'modifierPath',
        ...(repeated ? ['modifierMountSelector'] : []),
        ...(repeated && grant.modifierMountSelectorMode === 'ordinal' ? ['modifierMountOrdinal'] : []),
        'modifierAmount',
      ];
    } else if (grant.dataType === 'trait') {
      fields = grant.traitPlacement === 'collection'
        ? ['dataType', 'traitCount', 'ref', 'traitCollection']
        : grant.traitPlacement === 'nested'
          ? ['dataType', 'traitParentPath', 'ref', 'key']
        : ['dataType', 'ref', 'key'];
    } else if (grant.dataType === 'trait-collection') {
      fields = [
        'dataType', 'key',
        ...grant.acceptedTraits.map((_, i) => `acceptedTrait_${i}`),
      ];
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
    const resolvedTerminal = resolveTerminalGrant(grant.modifierFieldSegments, traitShape, traitDefinitions);
    const terminalType = resolvedTerminal?.dataType ?? null;
    const repeatedPath = grant.modifierFieldSegments.some((segment) => segment.endsWith('[]'));

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
          shape={traitShape}
          traitDefinitions={traitDefinitions}
          operation={grant.modifierOperation}
          isTerminalResolved={terminalType !== null}
          editingField={editingField}
          onEdit={edit}
          onDone={done}
          onTabNext={() => tabFrom('modifierPath', 'next')}
          onTabPrev={() => tabFrom('modifierPath', 'prev')}
          onChange={(segs) => {
            const resolved = resolveTerminalGrant(segs, traitShape, traitDefinitions);
            const tt = resolved?.dataType ?? null;
            const patch: Partial<GrantDraft> = { modifierFieldSegments: segs, modifierAmount: '' };
            // Non-numeric types only support 'sets'
            if (tt !== null && tt !== 'number') patch.modifierOperation = 'sets';
            onChange(patch);
          }}
        />
        {repeatedPath && terminalType !== null && <> for{' '}
          <ComboToken {...ct('modifierMountSelector')} value={grant.modifierMountSelectorMode}
            placeholder="entries"
            options={[
              { value: 'all', label: 'all entries' },
              { value: 'ordinal', label: 'entry number' },
            ]}
            onSelect={(value) => onChange({ modifierMountSelectorMode: value as ModifierMountSelectorMode })} />
          {grant.modifierMountSelectorMode === 'ordinal' && <>
            {' #'}
            <Token {...tok('modifierMountOrdinal')} value={grant.modifierMountOrdinal}
              placeholder="1" inputType="number"
              onChange={(value) => onChange({ modifierMountOrdinal: value })} />
          </>}
        </>}
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

  // ── Trait collection: "[collection] [key] accepts [base trait]" ───────────
  if (grant.dataType === 'trait-collection') {
    return (
      <div className="guided-grant-sentence">
        <ComboToken {...ct('dataType')} value={grant.dataType} placeholder="type"
          options={DATA_TYPE_OPTIONS} onSelect={(v) => onChange({ dataType: v as GrantDataType })} />
        <Token {...tok('key')} value={grant.key} placeholder="collection name"
          size="md" onChange={(v) => onChange({ key: v })} />
        {' '}accepts traits compatible with
        <button
          type="button"
          className={`slot-affinity-mode-toggle${grant.acceptedTraitsMode === 'all' ? ' is-all' : ''}`}
          title={grant.acceptedTraitsMode === 'any'
            ? 'A trait may satisfy any listed base trait. Click to require all.'
            : 'A trait must satisfy all listed base traits. Click to accept any.'}
          onClick={() => onChange({ acceptedTraitsMode: grant.acceptedTraitsMode === 'any' ? 'all' : 'any' })}
        >{grant.acceptedTraitsMode === 'any' ? 'any of:' : 'all of:'}</button>
        {grant.acceptedTraits.map((ref, i) => (
          <span key={i} className="guided-grant-trait-ref">
            <ComboToken
              {...ct(`acceptedTrait_${i}`)}
              value={ref}
              placeholder="— base trait —"
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
              aria-label="Remove accepted base trait"
              onClick={() => onChange({ acceptedTraits: grant.acceptedTraits.filter((_, j) => j !== i) })}
            >×</button>
          </span>
        ))}
        <button
          type="button"
          className="secondary-action compact-action"
          onClick={() => onChange({ acceptedTraits: [...grant.acceptedTraits, ''] })}
        >+ base trait</button>
        <button type="button" className="guided-grant-remove" aria-label="Remove" onClick={onRemove}>×</button>
      </div>
    );
  }

  // ── Trait sentence: named trait or counted collection contribution ─────────
  if (grant.dataType === 'trait') {
    return (
      <div className="guided-grant-sentence">
        <ComboToken {...ct('dataType')} value={grant.dataType} placeholder="type"
          options={DATA_TYPE_OPTIONS} onSelect={(v) => onChange({ dataType: v as GrantDataType })} />
        {grant.traitPlacement === 'collection' && (
          <>
            <Token {...tok('traitCount')} value={grant.traitCount} placeholder="1"
              inputType="number" onChange={(v) => onChange({ traitCount: v })} />
            ×
          </>
        )}
        {grant.traitPlacement === 'named' && '→'}
        <ComboToken {...ct('ref')} value={grant.ref} placeholder="— select trait —"
          options={traitOptions} onSelect={(v) => onChange({ ref: v })} hierarchical={hasHierarchy} />
        {grant.traitPlacement === 'named' ? (
          <>
            {' as '}
            <Token {...tok('key')} value={grant.key} placeholder="path name"
              onChange={(v) => onChange({ key: v })} />
            <button type="button" className="secondary-action compact-action"
              disabled={collectionOptions.length === 0}
              title={collectionOptions.length === 0 ? 'Add a trait collection first.' : 'Add a counted contribution to a trait collection.'}
              onClick={() => onChange({ traitPlacement: 'collection', key: '' })}>
              add to collection
            </button>
            <button type="button" className="secondary-action compact-action"
              disabled={nestedParentOptions.length === 0}
              title={nestedParentOptions.length === 0 ? 'Add or require a trait branch first.' : 'Extend an existing trait branch.'}
              onClick={() => onChange({ traitPlacement: 'nested', key: '' })}>
              extend a trait
            </button>
          </>
        ) : grant.traitPlacement === 'collection' ? (
          <>
            {' into '}
            <ComboToken {...ct('traitCollection')} value={grant.traitCollection}
              placeholder="— collection —" options={collectionOptions}
              onSelect={(v) => onChange({ traitCollection: v })} />
            <button type="button" className="secondary-action compact-action"
              onClick={() => onChange({ traitPlacement: 'named', traitCollection: '', traitCount: '1' })}>
              use named path
            </button>
          </>
        ) : (
          <>
            {' extends '}
            <ComboToken {...ct('traitParentPath')} value={grant.traitParentPath}
              placeholder="— parent trait —" options={nestedParentOptions}
              onSelect={(v) => onChange({ traitParentPath: v })} />
            {' as '}
            <Token {...tok('key')} value={grant.key} placeholder="path name"
              onChange={(v) => onChange({ key: v })} />
            <button type="button" className="secondary-action compact-action"
              onClick={() => onChange({ traitPlacement: 'named', traitParentPath: '' })}>
              use named path
            </button>
          </>
        )}
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

// ── Effective shape preview ───────────────────────────────────────────────────

function TraitShapeTree({
  currentTraitName,
  definitionsById,
  parentPath,
  shape,
}: {
  currentTraitName: string;
  definitionsById: Map<string, RuleDefinitionResource>;
  parentPath: string[];
  shape: TraitShape;
}) {
  const children = traitShapeChildren(shape, parentPath);
  if (children.length === 0) return null;

  return (
    <ul className="trait-shape-tree" role={parentPath.length === 0 ? 'tree' : 'group'}>
      {children.map((node) => {
        const segment = node.path.at(-1)!;
        const sourceName = node.sourceTraitId
          ? definitionsById.get(node.sourceTraitId)?.name ?? node.sourceTraitId
          : currentTraitName;
        return (
          <li
            aria-expanded={node.kind === 'branch' || (node.kind === 'collection' && node.entries.length > 0) ? true : undefined}
            aria-selected={false}
            className={`trait-shape-node is-${node.kind}`}
            key={node.path.join('.')}
            role="treeitem"
          >
            <div className="trait-shape-node-row">
              <span className="trait-shape-connector" aria-hidden="true">
                {node.kind === 'branch' ? '◆' : node.kind === 'collection' ? '▦' : '●'}
              </span>
              <span className="trait-shape-node-name">{node.label}</span>
              <code>.{segment}</code>
              <span className="trait-shape-node-type">
                {node.kind === 'branch' ? 'trait' : node.kind === 'collection' ? 'collection' : node.dataType}
              </span>
              <span className="trait-shape-node-source">
                {node.kind === 'branch' ? 'added by ' : node.kind === 'collection' ? 'declared by ' : 'defined by '}
                {sourceName}
              </span>
            </div>
            {node.kind === 'branch' && (
              <TraitShapeTree
                currentTraitName={currentTraitName}
                definitionsById={definitionsById}
                parentPath={node.path}
                shape={shape}
              />
            )}
            {node.kind === 'collection' && node.entries.length > 0 && (
              <ul className="trait-shape-tree trait-shape-collection-entries" role="group">
                {node.entries.map((entry, index) => {
                  const entryName = definitionsById.get(entry.traitId)?.name ?? entry.traitId;
                  const entrySource = entry.sourceTraitId
                    ? definitionsById.get(entry.sourceTraitId)?.name ?? entry.sourceTraitId
                    : currentTraitName;
                  return (
                    <li className="trait-shape-node is-collection-entry"
                      aria-selected={false}
                      key={`${entry.traitId}-${entry.sourceTraitId ?? 'draft'}-${index}`} role="treeitem">
                      <div className="trait-shape-node-row">
                        <span className="trait-shape-connector" aria-hidden="true">×</span>
                        <span className="trait-shape-node-name">{entryName}</span>
                        <span className="trait-shape-node-type">×{entry.count}</span>
                        <span className="trait-shape-node-source">added by {entrySource}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function TraitShapePreview({
  currentTraitName,
  definitions,
  shape,
}: {
  currentTraitName: string;
  definitions: RuleDefinitionResource[];
  shape: TraitShape;
}) {
  const definitionsById = useMemo(
    () => new Map(definitions.map((definition) => [definition.externalId, definition])),
    [definitions],
  );
  const terminalCount = shape.nodes.filter((node) => node.kind === 'terminal').length;
  const collectionCount = shape.nodes.filter((node) => node.kind === 'collection').length;
  const branchCount = shape.nodes.length - terminalCount - collectionCount;
  const previewTitleId = useId();

  return (
    <section className="trait-shape-preview" aria-labelledby={previewTitleId}>
      <div className="trait-shape-preview-heading">
        <div>
          <span className="eyebrow">Effective shape</span>
          <h5 id={previewTitleId}>Structure available on Self</h5>
        </div>
        <span className="badge">{branchCount} traits · {collectionCount} collections · {terminalCount} fields</span>
      </div>
      <p className="subtext">
        Guaranteed by the selected prerequisites, plus additions from {currentTraitName}.
      </p>
      {shape.nodes.length === 0 ? (
        <div className="trait-shape-empty">
          Add a prerequisite or a named field or trait to begin building this structure.
        </div>
      ) : (
        <div className="trait-shape-root">
          <div className="trait-shape-root-label">
            <span className="trait-shape-root-mark" aria-hidden="true">S</span>
            <strong>Self</strong>
            <code>self</code>
          </div>
          <TraitShapeTree
            currentTraitName={currentTraitName}
            definitionsById={definitionsById}
            parentPath={[]}
            shape={shape}
          />
        </div>
      )}
    </section>
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
  const traitShape = useMemo(() => buildTraitShape({
    definitions: traitDefinitions,
    prerequisiteIds: prerequisites.ids,
    prerequisiteMode: prerequisites.mode,
    draftGrants: traitShapeGrantsFromDraft(grants),
  }), [grants, prerequisites.ids, prerequisites.mode, traitDefinitions]);
  const collectionOptions = useMemo(() => traitShape.nodes
    .filter((node): node is Extract<TraitShapeNode, { kind: 'collection' }> => node.kind === 'collection')
    .map((node) => ({
      value: `self.${node.path.join('.')}`,
      label: `Self › ${node.path.map((segment) => segment.replace(/-/g, ' ')).join(' › ')}`,
      hint: 'trait collection',
    })), [traitShape.nodes]);
  const nestedParentOptions = useMemo(() => traitShape.nodes
    .filter((node): node is Extract<TraitShapeNode, { kind: 'branch' }> => node.kind === 'branch')
    .map((node) => ({
      value: `self.${node.path.join('.')}`,
      label: `Self › ${node.path.map((segment) => segment.replace(/-/g, ' ')).join(' › ')}`,
      hint: 'trait branch',
    })), [traitShape.nodes]);

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
        <button type="button" className="secondary-action compact-action" onClick={() => add('trait-collection')}>+ trait collection</button>
        <button type="button" className="secondary-action compact-action" onClick={() => add('modifier')}>+ modifier</button>
        <button type="button" className="secondary-action compact-action" onClick={() => add('slot')}>+ slot</button>
        <button type="button" className="secondary-action compact-action" onClick={() => add('slot-affinity')}>+ slot-affinity</button>
      </div>

      {grants.length > 0 && (
        <div className="guided-grants-list">
          {grants.map((grant) => (
            <GrantRow key={grant._id} collectionOptions={collectionOptions} grant={grant}
              nestedParentOptions={nestedParentOptions} traitDefinitions={traitDefinitions}
              traitShape={traitShape}
              slotTypeOptions={slotTypeOptions}
              autoFocus={grant._id === lastAddedId}
              onChange={(patch) => update(grant._id, patch)}
              onRemove={() => remove(grant._id)} />
          ))}
        </div>
      )}

      <TraitShapePreview
        currentTraitName={traitName.trim() || 'This trait'}
        definitions={traitDefinitions}
        shape={traitShape}
      />

      {traitShape.diagnostics.length > 0 && (
        <div className="guided-rule-diagnostics" aria-live="polite">
          <strong>Trait structure needs attention</strong>
          <ul>
            {traitShape.diagnostics.map((diagnostic, index) => (
              <li key={`${diagnostic.code}-${diagnostic.path.join('.')}-${index}`}>
                <span>{diagnostic.path.length > 0 ? `self.${diagnostic.path.join('.')}` : 'self'}</span>
                {diagnostic.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
