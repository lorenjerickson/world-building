export type UnitDimension = 'scalar' | 'length' | 'duration' | 'movement-rate';

export type CanonicalUnitId =
  | '1'
  | 'mm'
  | 'cm'
  | 'm'
  | 'km'
  | 'in'
  | 'ft'
  | 'yd'
  | 'mi'
  | 'ms'
  | 's'
  | 'min'
  | 'h'
  | 'm/turn'
  | 'ft/turn'
  | 'yd/turn';

export type UnitDefinition = {
  id: CanonicalUnitId;
  dimension: UnitDimension;
  label: string;
  symbol: string;
  scaleToBase: number;
};

export type UnitAmount = {
  value: number;
  unit: CanonicalUnitId;
};

export const UNIT_DEFINITIONS: readonly UnitDefinition[] = [
  { id: '1', dimension: 'scalar', label: 'unitless', symbol: '×', scaleToBase: 1 },
  { id: 'mm', dimension: 'length', label: 'millimeters', symbol: 'mm', scaleToBase: 0.001 },
  { id: 'cm', dimension: 'length', label: 'centimeters', symbol: 'cm', scaleToBase: 0.01 },
  { id: 'm', dimension: 'length', label: 'meters', symbol: 'm', scaleToBase: 1 },
  { id: 'km', dimension: 'length', label: 'kilometers', symbol: 'km', scaleToBase: 1_000 },
  { id: 'in', dimension: 'length', label: 'inches', symbol: 'in', scaleToBase: 0.0254 },
  { id: 'ft', dimension: 'length', label: 'feet', symbol: 'ft', scaleToBase: 0.3048 },
  { id: 'yd', dimension: 'length', label: 'yards', symbol: 'yd', scaleToBase: 0.9144 },
  { id: 'mi', dimension: 'length', label: 'miles', symbol: 'mi', scaleToBase: 1_609.344 },
  { id: 'ms', dimension: 'duration', label: 'milliseconds', symbol: 'ms', scaleToBase: 0.001 },
  { id: 's', dimension: 'duration', label: 'seconds', symbol: 's', scaleToBase: 1 },
  { id: 'min', dimension: 'duration', label: 'minutes', symbol: 'min', scaleToBase: 60 },
  { id: 'h', dimension: 'duration', label: 'hours', symbol: 'h', scaleToBase: 3_600 },
  { id: 'm/turn', dimension: 'movement-rate', label: 'meters per turn', symbol: 'm/turn', scaleToBase: 1 },
  { id: 'ft/turn', dimension: 'movement-rate', label: 'feet per turn', symbol: 'ft/turn', scaleToBase: 0.3048 },
  { id: 'yd/turn', dimension: 'movement-rate', label: 'yards per turn', symbol: 'yd/turn', scaleToBase: 0.9144 },
] as const;

const definitionsById = new Map(UNIT_DEFINITIONS.map((definition) => [definition.id, definition]));

const aliases: Readonly<Record<string, CanonicalUnitId>> = {
  unitless: '1',
  scalar: '1',
  meter: 'm',
  meters: 'm',
  metre: 'm',
  metres: 'm',
  foot: 'ft',
  feet: 'ft',
  inch: 'in',
  inches: 'in',
  yard: 'yd',
  yards: 'yd',
  second: 's',
  seconds: 's',
  minute: 'min',
  minutes: 'min',
  hour: 'h',
  hours: 'h',
  'meters/turn': 'm/turn',
  'meters per turn': 'm/turn',
  'feet/turn': 'ft/turn',
  'feet per turn': 'ft/turn',
  'yards/turn': 'yd/turn',
  'yards per turn': 'yd/turn',
};

export function isCanonicalUnitId(value: unknown): value is CanonicalUnitId {
  return typeof value === 'string' && definitionsById.has(value as CanonicalUnitId);
}

export function normalizeUnitId(value: string): CanonicalUnitId | null {
  const normalized = value.trim().toLowerCase();
  return isCanonicalUnitId(normalized) ? normalized : aliases[normalized] ?? null;
}

export function unitDefinition(unit: CanonicalUnitId): UnitDefinition {
  return definitionsById.get(unit)!;
}

export function compatibleUnits(unit: CanonicalUnitId): UnitDefinition[] {
  const dimension = unitDefinition(unit).dimension;
  return UNIT_DEFINITIONS.filter((definition) => definition.dimension === dimension);
}

export function unitsAreCompatible(left: CanonicalUnitId, right: CanonicalUnitId): boolean {
  return unitDefinition(left).dimension === unitDefinition(right).dimension;
}

export function convertUnitValue(
  value: number,
  from: CanonicalUnitId,
  to: CanonicalUnitId,
): number | null {
  if (!Number.isFinite(value) || !unitsAreCompatible(from, to)) return null;
  return value * unitDefinition(from).scaleToBase / unitDefinition(to).scaleToBase;
}
