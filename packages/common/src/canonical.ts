import type {
  CanonicalCell,
  Cell,
  CellKey,
  EncounterMapCanonical,
  EncounterMapDraftGeometry,
  EncounterMaterialPalette,
  FaceName,
  ValidationResult,
  Vec3,
  VertexRemap,
} from './types';

const ALLOWED_SCALES_IN_FEET = new Set<number>([0.5, 1, 5]);
const FACE_ORDER: FaceName[] = ['bottom', 'top', 'west', 'east', 'south', 'north'];

export function cellKeyOf(cell: Pick<Cell, 'x' | 'y' | 'z'>): CellKey {
  return `${cell.x},${cell.y},${cell.z}`;
}

export function pointKey(point: Vec3): string {
  return `${point[0]},${point[1]},${point[2]}`;
}

function comparePoint(a: Vec3, b: Vec3): number {
  return a[2] - b[2] || a[1] - b[1] || a[0] - b[0];
}

function sortMaterials(materials: CanonicalCell['materials']): CanonicalCell['materials'] {
  if (!materials) return undefined;
  const result: Partial<Record<FaceName, string>> = {};
  for (const face of FACE_ORDER) {
    const value = materials[face];
    if (value !== undefined) result[face] = value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function cloneAndSortCells<T extends Cell | CanonicalCell>(cells: readonly T[]): T[] {
  return [...cells]
    .map((cell) => ({ ...cell, materials: sortMaterials(cell.materials) }))
    .sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x || ('shape' in a && 'shape' in b ? a.shape.localeCompare(b.shape) : 0)) as T[];
}

function cloneAndSortRemaps(remaps: readonly VertexRemap[]): VertexRemap[] {
  return [...remaps]
    .map((remap) => ({ from: [...remap.from] as Vec3, to: [...remap.to] as Vec3 }))
    .sort((a, b) => comparePoint(a.from, b.from) || comparePoint(a.to, b.to));
}

export function canonicalizeMap(input: EncounterMapCanonical): EncounterMapCanonical {
  return {
    formatVersion: input.formatVersion,
    scaleInFeet: input.scaleInFeet,
    paletteVersion: input.paletteVersion,
    ...(input.surfaceSubdivisionLevel === undefined ? {} : { surfaceSubdivisionLevel: input.surfaceSubdivisionLevel }),
    bounds: { min: [...input.bounds.min] as Vec3, max: [...input.bounds.max] as Vec3 },
    occupiedCells: cloneAndSortCells(input.occupiedCells),
    vertexRemaps: cloneAndSortRemaps(input.vertexRemaps),
  };
}

// Small dependency-free SHA-256 keeps canonical checksums identical in Node and browser workers.
function sha256(value: string): string {
  const rightRotate = (n: number, x: number) => (x >>> n) | (x << (32 - n));
  const maxWord = 2 ** 32;
  const words: number[] = [];
  const ascii = unescape(encodeURIComponent(value));
  const bitLength = ascii.length * 8;
  const hash: number[] = [];
  const constants: number[] = [];
  const composite: Record<number, true> = {};
  let prime = 2;
  while (constants.length < 64) {
    if (!composite[prime]) {
      for (let multiple = prime * prime; multiple < 313; multiple += prime) composite[multiple] = true;
      if (hash.length < 8) hash.push((prime ** 0.5 * maxWord) | 0);
      constants.push((prime ** (1 / 3) * maxWord) | 0);
    }
    prime += 1;
  }
  let message = ascii + '\x80';
  while ((message.length % 64) !== 56) message += '\x00';
  for (let i = 0; i < message.length; i += 1) {
    const code = message.charCodeAt(i);
    words[i >> 2] = (words[i >> 2] ?? 0) | (code << ((3 - i) % 4) * 8);
  }
  words.push(Math.floor(bitLength / maxWord), bitLength);
  for (let block = 0; block < words.length; block += 16) {
    const schedule = words.slice(block, block + 16);
    const oldHash = [...hash];
    for (let i = 0; i < 64; i += 1) {
      const w15 = schedule[i - 15] ?? 0;
      const w2 = schedule[i - 2] ?? 0;
      const s0 = rightRotate(7, w15) ^ rightRotate(18, w15) ^ (w15 >>> 3);
      const s1 = rightRotate(17, w2) ^ rightRotate(19, w2) ^ (w2 >>> 10);
      schedule[i] = i < 16 ? (schedule[i] ?? 0) : (((schedule[i - 16] ?? 0) + s0 + (schedule[i - 7] ?? 0) + s1) | 0);
      const e = hash[4] ?? 0;
      const a = hash[0] ?? 0;
      const sigma1 = rightRotate(6, e) ^ rightRotate(11, e) ^ rightRotate(25, e);
      const choose = (e & (hash[5] ?? 0)) ^ (~e & (hash[6] ?? 0));
      const temp1 = ((hash[7] ?? 0) + sigma1 + choose + (constants[i] ?? 0) + (schedule[i] ?? 0)) | 0;
      const sigma0 = rightRotate(2, a) ^ rightRotate(13, a) ^ rightRotate(22, a);
      const majority = (a & (hash[1] ?? 0)) ^ (a & (hash[2] ?? 0)) ^ ((hash[1] ?? 0) & (hash[2] ?? 0));
      const temp2 = (sigma0 + majority) | 0;
      hash.pop();
      hash.unshift((temp1 + temp2) | 0);
      hash[4] = ((hash[4] ?? 0) + temp1) | 0;
    }
    for (let i = 0; i < 8; i += 1) hash[i] = ((hash[i] ?? 0) + (oldHash[i] ?? 0)) | 0;
  }
  return hash.map((word) => (word >>> 0).toString(16).padStart(8, '0')).join('');
}

export function checksumCanonicalMap(input: EncounterMapCanonical): string {
  return sha256(JSON.stringify(canonicalizeMap(input)));
}

function validPoint(point: unknown, min: number, max: number): point is Vec3 {
  return Array.isArray(point) && point.length === 3
    && point.every((value) => Number.isInteger(value) && value >= min && value <= max);
}

export function validateCanonicalMap(input: EncounterMapCanonical, palette?: EncounterMaterialPalette): ValidationResult {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') {
    return { ok: false, errors: ['canonical map must be an object'] };
  }
  if (input.formatVersion !== 'encounter-map/1') errors.push(`Unsupported formatVersion: ${String(input.formatVersion)}`);
  if (!ALLOWED_SCALES_IN_FEET.has(input.scaleInFeet)) errors.push(`scaleInFeet must be one of 0.5, 1, 5. Received: ${input.scaleInFeet}`);
  if (typeof input.paletteVersion !== 'string' || input.paletteVersion.trim() === '') errors.push('paletteVersion must be a non-empty string');
  if (input.surfaceSubdivisionLevel !== undefined
    && (!Number.isInteger(input.surfaceSubdivisionLevel) || input.surfaceSubdivisionLevel < 0 || input.surfaceSubdivisionLevel > 3)) {
    errors.push(`surfaceSubdivisionLevel must be an integer from 0 to 3. Received: ${input.surfaceSubdivisionLevel}`);
  }
  if (palette && input.paletteVersion !== palette.version) errors.push(`Palette version '${input.paletteVersion}' does not match '${palette.version}'`);
  const knownMaterials = palette ? new Set(palette.materials.map((material) => material.id)) : undefined;
  if (!validPoint(input.bounds?.min, 0, 99) || !validPoint(input.bounds?.max, 1, 100)) {
    errors.push('bounds must contain integer min (0..99) and max (1..100) lattice points');
  } else if (input.bounds.min.some((value, axis) => value >= input.bounds.max[axis]!)) {
    errors.push('bounds.min must be strictly less than bounds.max on every axis');
  }
  if (!Array.isArray(input.occupiedCells)) errors.push('occupiedCells must be an array');
  if (!Array.isArray(input.vertexRemaps)) errors.push('vertexRemaps must be an array');
  const occupied = new Set<string>();
  for (const cell of Array.isArray(input.occupiedCells) ? input.occupiedCells : []) {
    if (!cell || typeof cell !== 'object') {
      errors.push('Every occupied cell must be an object');
      continue;
    }
    const key = cellKeyOf(cell);
    if (occupied.has(key)) errors.push(`Duplicate cells are not allowed: ${key}`);
    occupied.add(key);
    if (![cell.x, cell.y, cell.z].every(Number.isInteger)) errors.push(`Cell coordinates must be integers: ${key}`);
    if (validPoint(input.bounds?.min, 0, 99) && validPoint(input.bounds?.max, 1, 100)
      && (cell.x < input.bounds.min[0] || cell.y < input.bounds.min[1] || cell.z < input.bounds.min[2]
        || cell.x >= input.bounds.max[0] || cell.y >= input.bounds.max[1] || cell.z >= input.bounds.max[2])) {
      errors.push(`Cell is outside declared bounds: ${key}`);
    }
    for (const [face, material] of Object.entries(cell.materials ?? {})) {
      if (!FACE_ORDER.includes(face as FaceName) || typeof material !== 'string' || material.trim() === '') {
        errors.push(`Invalid face material at ${key}:${face}`);
      } else if (knownMaterials && !knownMaterials.has(material)) {
        errors.push(`Unresolved material '${material}' at ${key}:${face}`);
      }
    }
  }
  const remapSources = new Map<string, string>();
  for (const remap of Array.isArray(input.vertexRemaps) ? input.vertexRemaps : []) {
    if (!remap || typeof remap !== 'object') {
      errors.push('Every vertex remap must be an object');
      continue;
    }
    if (!validPoint(remap.from, 0, 100) || !validPoint(remap.to, 0, 100)) {
      errors.push(`Vertex remap coordinates must be integer lattice points in 0..100`);
      continue;
    }
    const from = pointKey(remap.from);
    const to = pointKey(remap.to);
    if (from === to) errors.push(`Identity vertex remap is not canonical: ${from}`);
    const distance = Math.abs(remap.from[0] - remap.to[0]) + Math.abs(remap.from[1] - remap.to[1]) + Math.abs(remap.from[2] - remap.to[2]);
    if (distance !== 1) errors.push(`Vertex remap must be axis-adjacent: ${from} -> ${to}`);
    const prior = remapSources.get(from);
    if (prior && prior !== to) errors.push(`Conflicting vertex remap: ${from} -> ${prior}/${to}`);
    remapSources.set(from, to);
  }
  for (const start of remapSources.keys()) {
    const seen = new Set<string>();
    let cursor: string | undefined = start;
    while (cursor && remapSources.has(cursor)) {
      if (seen.has(cursor)) {
        errors.push(`Cyclic vertex remap involving ${start}`);
        break;
      }
      seen.add(cursor);
      cursor = remapSources.get(cursor);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function compileCanonicalMap(input: EncounterMapDraftGeometry, vertexRemaps: readonly VertexRemap[]): EncounterMapCanonical {
  return canonicalizeMap({
    formatVersion: input.formatVersion,
    scaleInFeet: input.scaleInFeet,
    paletteVersion: input.paletteVersion,
    ...(input.surfaceSubdivisionLevel === undefined ? {} : { surfaceSubdivisionLevel: input.surfaceSubdivisionLevel }),
    bounds: input.bounds,
    occupiedCells: input.cells.map(({ x, y, z, materials }) => ({ x, y, z, materials })),
    vertexRemaps: [...vertexRemaps],
  });
}

export function dedupeCells<T extends Cell | CanonicalCell>(cells: readonly T[]): { cells: T[]; duplicates: CellKey[] } {
  const seen = new Set<CellKey>();
  const kept: T[] = [];
  const duplicates: CellKey[] = [];
  for (const cell of cloneAndSortCells(cells)) {
    const key = cellKeyOf(cell);
    if (seen.has(key)) duplicates.push(key);
    else { seen.add(key); kept.push(cell); }
  }
  return { cells: kept, duplicates };
}
