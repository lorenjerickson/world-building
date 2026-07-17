'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { RuleDefinitionResource } from '@/lib/rule-sets';

// ── Types ─────────────────────────────────────────────────────────────────────

export type GrantDataType = 'text' | 'number' | 'boolean' | 'enum' | 'trait' | 'modifier' | 'slot' | 'slot-affinity';
export type ModifierOperation = 'increases' | 'decreases' | 'sets';

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
  // modifier
  modifierOperation: ModifierOperation;
  modifierField: string;
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

export type TraitGrantsBody = {
  metamodelVersion: 'trait/1';
  grants: GrantEntry[];
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
  amount?: number;
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
    modifierOperation: 'increases', modifierField: '', modifierAmount: '',
    slotCount: '1', slotGrantTypes: [], acceptedTraits: [], acceptedTraitsMode: 'any', slotAffinityTypes: [], slotAffinityMode: 'any',
  };
}

export function buildGrantsBody(grants: GrantDraft[]): TraitGrantsBody {
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
        if (g.modifierField.trim()) entry.field = g.modifierField.trim();
        if (g.modifierAmount !== '') entry.amount = Number(g.modifierAmount);
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
  };
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
    modifierField: g.field ?? '',
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
    case 'trait':    return ['dataType', 'ref'];
    case 'modifier': return ['dataType', 'modifierOperation', 'modifierField', 'modifierAmount'];
  }
}

// ── Field path options ────────────────────────────────────────────────────────

const ENTITY_ROOTS = ['self', 'target', 'creature'] as const;

/** Fallback field paths used when no `field` definitions exist in the rule set yet. */
const FALLBACK_FIELD_PATHS: string[] = [
  'attributes.strength', 'attributes.dexterity', 'attributes.constitution',
  'attributes.intelligence', 'attributes.wisdom', 'attributes.charisma',
  'health.current', 'health.max', 'health.temporary',
  'senses.vision.daytime', 'senses.vision.nighttime',
  'senses.passive.perception', 'senses.passive.insight', 'senses.passive.investigation',
  'rolls.toHit', 'rolls.damage', 'rolls.initiative',
  'speed.walk', 'speed.fly', 'speed.swim', 'speed.climb',
  'armor.class', 'armor.bonus',
];

/**
 * Build ComboOption[] for field path selection.
 * Derives paths from `field` type rule definitions (using body.key if present,
 * else the definition name). Falls back to a common RPG vocabulary when no
 * field definitions have been authored yet.
 * Each path is exposed under three entity roots: self, target, creature.
 */
function buildFieldPathOptions(fieldDefs: RuleDefinitionResource[]): ComboOption[] {
  const rawPaths: string[] = fieldDefs.length > 0
    ? fieldDefs.flatMap((def) => {
        // body.key is the canonical field path (e.g. "attributes.strength")
        if (typeof def.body?.key === 'string' && def.body.key.trim()) {
          return [def.body.key.trim()];
        }
        // Derive from name as a last resort
        const derived = def.name.toLowerCase().replace(/\s+/g, '.').replace(/[^a-z0-9.]/g, '');
        return derived ? [derived] : [];
      })
    : FALLBACK_FIELD_PATHS;

  const options: ComboOption[] = [];
  for (const root of ENTITY_ROOTS) {
    for (const fieldPath of rawPaths) {
      const segments = fieldPath.split('.');
      // path = parent segments (root + all but the final field name)
      const parentPath = [root, ...segments.slice(0, -1)].join('.');
      const fullValue = `${root}.${fieldPath}`;
      options.push({ value: fullValue, label: fullValue, path: parentPath });
    }
  }
  return options;
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
  { value: 'increases', label: 'increases', hint: 'adds to field' },
  { value: 'decreases', label: 'decreases', hint: 'subtracts from field' },
  { value: 'sets',      label: 'sets',      hint: 'replaces field value' },
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
  const wrapRef = useRef<HTMLDivElement>(null);

  // Reset internal search/path when closed
  useEffect(() => {
    if (!isOpen) { setSearch(''); setBrowsePath([]); }
  }, [isOpen]);

  // Click-outside closes
  useEffect(() => {
    if (!isOpen) return;
    function handle(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onDone();
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [isOpen, onDone]);

  function handleSelect(v: string) { onSelect(v); onDone(); }

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
                if (e.key === 'Enter' && searchIsNew) { e.preventDefault(); handleSelect(trimmedSearch); }
                if (e.key === 'Tab') { e.preventDefault(); e.shiftKey ? (onTabPrev ? onTabPrev() : onDone()) : (onTabNext ? onTabNext() : onDone()); }
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

          <div className="combo-list" role="listbox">
            {searchIsNew && (
              <button type="button" className="combo-option combo-option-create"
                onClick={() => handleSelect(trimmedSearch)}>
                Create <strong>"{trimmedSearch}"</strong>
              </button>
            )}
            {listItems.length === 0 && !searchIsNew && <div className="combo-empty">No matches</div>}
            {listItems.map((item) => {
              if (item.kind === 'group') {
                return (
                  <button key={item.fullPath} type="button" className="combo-option is-group"
                    onClick={() => setBrowsePath(item.fullPath.split('.'))}>
                    <span className="combo-option-label">{item.segment}</span>
                    <span className="combo-option-arrow">›</span>
                  </button>
                );
              }
              return (
                <button key={item.value} type="button"
                  className={`combo-option${item.value === value ? ' is-selected' : ''}`}
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

// ── Grant row ─────────────────────────────────────────────────────────────────

function GrantRow({
  grant, traitDefinitions, fieldPathOptions, slotTypeOptions, onChange, onRemove,
}: {
  grant: GrantDraft;
  traitDefinitions: RuleDefinitionResource[];
  fieldPathOptions: ComboOption[];
  slotTypeOptions: ComboOption[];
  onChange: (patch: Partial<GrantDraft>) => void;
  onRemove: () => void;
}) {
  const [editingField, setEditingField] = useState<string | null>(null);

  function edit(f: string) { setEditingField(f); }
  function done() { setEditingField(null); }

  function tabFrom(fieldKey: string, direction: 'next' | 'prev' = 'next') {
    // Slot and slot-affinity have dynamic field lists; compute them inline.
    let fields: string[];
    if (grant.dataType === 'slot') {
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

  // ── Modifier sentence: "[modifier] [op] [field] by/to [amount]" ─────────
  if (grant.dataType === 'modifier') {
    const prep = grant.modifierOperation === 'sets' ? 'to' : 'by';
    return (
      <div className="guided-grant-sentence">
        <ComboToken {...ct('dataType')} value={grant.dataType} placeholder="type"
          options={DATA_TYPE_OPTIONS} onSelect={(v) => onChange({ dataType: v as GrantDataType })} />
        <ComboToken {...ct('modifierOperation')} value={grant.modifierOperation}
          placeholder="increases" options={MODIFIER_OP_OPTIONS}
          onSelect={(v) => onChange({ modifierOperation: v as ModifierOperation })} />
        <ComboToken {...ct('modifierField')} value={grant.modifierField}
          placeholder="self.attr.path" options={fieldPathOptions} hierarchical
          onSelect={(v) => onChange({ modifierField: v })} />
        {prep}
        <Token {...tok('modifierAmount')} value={grant.modifierAmount}
          placeholder="0" inputType="number"
          onChange={(v) => onChange({ modifierAmount: v })} />
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

export function GuidedTraitGrantsEditor({
  traitName, grants, traitDefinitions, fieldDefinitions, onChange,
}: {
  traitName: string;
  grants: GrantDraft[];
  traitDefinitions: RuleDefinitionResource[];
  /** All `field`-type definitions from the rule set — used to populate the field path browser. */
  fieldDefinitions: RuleDefinitionResource[];
  onChange: (grants: GrantDraft[]) => void;
}) {
  const fieldPathOptions = useMemo(() => buildFieldPathOptions(fieldDefinitions), [fieldDefinitions]);
  const slotTypeOptions = useMemo(() => extractSlotTypes(traitDefinitions, grants), [traitDefinitions, grants]);

  function update(id: string, patch: Partial<GrantDraft>) {
    onChange(grants.map((g) => g._id === id ? { ...g, ...patch } : g));
  }
  function remove(id: string) { onChange(grants.filter((g) => g._id !== id)); }
  function add(dataType: GrantDataType) { onChange([...grants, newGrant(dataType)]); }

  return (
    <div className="guided-grants-editor rule-set-field-wide">
      <p className="guided-grants-narrative">
        <strong>{traitName.trim() || 'This trait'}</strong> grants the following to any entity that holds it:
      </p>

      {grants.length === 0 ? (
        <p className="subtext guided-grants-empty">No grants defined yet. Add one below.</p>
      ) : (
        <div className="guided-grants-list">
          {grants.map((grant) => (
            <GrantRow key={grant._id} grant={grant} traitDefinitions={traitDefinitions}
              fieldPathOptions={fieldPathOptions} slotTypeOptions={slotTypeOptions}
              onChange={(patch) => update(grant._id, patch)}
              onRemove={() => remove(grant._id)} />
          ))}
        </div>
      )}

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
    </div>
  );
}
