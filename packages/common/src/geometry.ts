import { cellKeyOf, dedupeCells, pointKey, validateCanonicalMap } from './canonical';
import type {
  CanonicalCell,
  Cell,
  CellKey,
  EncounterMapCanonical,
  FaceName,
  IndexedMeshBufferOptions,
  IndexedMeshBuffers,
  MeshBuildOptions,
  MeshBuildResult,
  ShapeKind,
  Triangle,
  ValidationResult,
  Vec3,
  VertexRemap,
} from './types';

const EPS = 1e-9;
const SHAPES = new Set<ShapeKind>([
  'cube', 'rampXPos', 'rampXNeg', 'rampYPos', 'rampYNeg',
  'cornerRampNE', 'cornerRampNW', 'cornerRampSE', 'cornerRampSW',
]);

interface FaceDef { name: FaceName; verts: Vec3[] }

function pointId(point: Vec3): number {
  return point[0] + point[1] * 101 + point[2] * 10201;
}

function baseFaces(x: number, y: number, z: number): FaceDef[] {
  const p000: Vec3 = [x, y, z];
  const p100: Vec3 = [x + 1, y, z];
  const p110: Vec3 = [x + 1, y + 1, z];
  const p010: Vec3 = [x, y + 1, z];
  const p001: Vec3 = [x, y, z + 1];
  const p101: Vec3 = [x + 1, y, z + 1];
  const p111: Vec3 = [x + 1, y + 1, z + 1];
  const p011: Vec3 = [x, y + 1, z + 1];
  // Counter-clockwise from outside. Three.js FrontSide therefore renders the exterior.
  return [
    { name: 'bottom', verts: [p000, p010, p110, p100] },
    { name: 'top', verts: [p001, p101, p111, p011] },
    { name: 'west', verts: [p000, p001, p011, p010] },
    { name: 'east', verts: [p100, p110, p111, p101] },
    { name: 'south', verts: [p000, p100, p101, p001] },
    { name: 'north', verts: [p010, p011, p111, p110] },
  ];
}

function remapsForPreset(cell: Cell): VertexRemap[] {
  const { x, y, z } = cell;
  const down = (px: number, py: number): VertexRemap => ({ from: [px, py, z + 1], to: [px, py, z] });
  switch (cell.shape) {
    case 'cube': return [];
    case 'rampXPos': return [down(x + 1, y), down(x + 1, y + 1)];
    case 'rampXNeg': return [down(x, y), down(x, y + 1)];
    case 'rampYPos': return [down(x, y + 1), down(x + 1, y + 1)];
    case 'rampYNeg': return [down(x, y), down(x + 1, y)];
    case 'cornerRampNE': return [down(x, y), down(x + 1, y), down(x, y + 1)];
    case 'cornerRampNW': return [down(x, y), down(x + 1, y), down(x + 1, y + 1)];
    case 'cornerRampSE': return [down(x, y), down(x, y + 1), down(x + 1, y + 1)];
    case 'cornerRampSW': return [down(x + 1, y), down(x, y + 1), down(x + 1, y + 1)];
  }
}

export function deriveVertexRemaps(cellsInput: readonly Cell[]): { remaps: VertexRemap[]; errors: string[] } {
  const targets = new Map<number, VertexRemap>();
  const errors: string[] = [];
  for (const cell of cellsInput) {
    if (!SHAPES.has(cell.shape)) continue;
    for (const remap of remapsForPreset(cell)) {
      const key = pointId(remap.from);
      const prior = targets.get(key);
      if (prior && pointKey(prior.to) !== pointKey(remap.to)) {
        errors.push(`Incompatible shape presets remap ${key} to both ${pointKey(prior.to)} and ${pointKey(remap.to)}`);
      } else {
        targets.set(key, remap);
      }
    }
  }
  return {
    remaps: [...targets.values()].sort((a, b) => pointId(a.from) - pointId(b.from)),
    errors,
  };
}

function remapIndex(remaps: readonly VertexRemap[]): Map<number, Vec3> {
  return new Map(remaps.map((remap) => [pointId(remap.from), remap.to]));
}

export function resolveLatticePoint(point: Vec3, remaps: ReadonlyMap<number, Vec3>): Vec3 {
  let resolved = point;
  const visited = new Set<number>();
  while (remaps.has(pointId(resolved))) {
    const key = pointId(resolved);
    if (visited.has(key)) throw new Error(`Cyclic vertex remap involving ${key}`);
    visited.add(key);
    resolved = remaps.get(key)!;
  }
  return resolved;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function magnitudeSquared(v: Vec3): number {
  return v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
}

function makeTri(a: Vec3, b: Vec3, c: Vec3, materialId: string, faceName: FaceName, cellKey: CellKey): Triangle | undefined {
  if (magnitudeSquared(cross(subtract(b, a), subtract(c, a))) <= EPS) return undefined;
  return { a, b, c, materialId, faceName, cellKey };
}

function polygonToTriangles(face: FaceDef, materialId: string, cellKey: CellKey): Triangle[] {
  const triangles: Triangle[] = [];
  for (let i = 1; i < face.verts.length - 1; i += 1) {
    const tri = makeTri(face.verts[0]!, face.verts[i]!, face.verts[i + 1]!, materialId, face.name, cellKey);
    if (tri) triangles.push(tri);
  }
  return triangles;
}

function facesMatchExactly(a: FaceDef, b: FaceDef): boolean {
  if (a.verts.length !== b.verts.length) return false;
  const left = a.verts.map(pointId).sort((x, y) => x - y);
  const right = b.verts.map(pointId).sort((x, y) => x - y);
  return left.every((value, index) => value === right[index]);
}

function triangleSignature(triangle: Triangle): string {
  return [pointId(triangle.a), pointId(triangle.b), pointId(triangle.c)].sort((a, b) => a - b).join('|');
}

function oppositeFace(face: FaceName): FaceName {
  const opposites: Record<FaceName, FaceName> = {
    north: 'south', south: 'north', east: 'west', west: 'east', top: 'bottom', bottom: 'top',
  };
  return opposites[face];
}

function neighborForFace(cell: Pick<Cell, 'x' | 'y' | 'z'>, face: FaceName): CellKey {
  if (face === 'north') return `${cell.x},${cell.y + 1},${cell.z}`;
  if (face === 'south') return `${cell.x},${cell.y - 1},${cell.z}`;
  if (face === 'east') return `${cell.x + 1},${cell.y},${cell.z}`;
  if (face === 'west') return `${cell.x - 1},${cell.y},${cell.z}`;
  if (face === 'top') return `${cell.x},${cell.y},${cell.z + 1}`;
  return `${cell.x},${cell.y},${cell.z - 1}`;
}

function validateCellSyntax(cells: readonly Cell[]): ValidationResult {
  const errors: string[] = [];
  const { cells: uniqueCells, duplicates } = dedupeCells(cells);
  if (duplicates.length) errors.push(`Duplicate cells are not allowed: ${duplicates.join(', ')}`);
  for (const cell of uniqueCells) {
    const key = cellKeyOf(cell);
    if (![cell.x, cell.y, cell.z].every(Number.isInteger)) errors.push(`Cell coordinates must be finite integers: ${key}`);
    if (cell.x < 0 || cell.y < 0 || cell.z < 0) errors.push(`Negative coordinates are not supported: ${key}`);
    if (cell.x > 99 || cell.y > 99 || cell.z > 99) errors.push(`Coordinates out of 100x100x100 bounds: ${key}`);
    if (!SHAPES.has(cell.shape)) errors.push(`Unsupported shape '${String(cell.shape)}' at ${key}`);
    for (const [face, materialId] of Object.entries(cell.materials ?? {})) {
      if (!['north', 'south', 'east', 'west', 'top', 'bottom'].includes(face)
        || typeof materialId !== 'string' || materialId.trim() === '') errors.push(`Invalid material at ${key}:${face}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function undirectedEdgeKey(a: Vec3, b: Vec3): number {
  const aId = pointId(a);
  const bId = pointId(b);
  const min = Math.min(aId, bId);
  const max = Math.max(aId, bId);
  return min * 1_100_000 + max;
}

function validateClosedTopology(mesh: MeshBuildResult): string[] {
  const edgeCounts = new Map<number, number>();
  for (const triangle of mesh.triangles) {
    for (const [a, b] of [[triangle.a, triangle.b], [triangle.b, triangle.c], [triangle.c, triangle.a]] as const) {
      const key = undirectedEdgeKey(a, b);
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }
  const invalid = [...edgeCounts].filter(([, count]) => count !== 2);
  return invalid.length === 0
    ? []
    : [`Non-manifold topology: ${invalid.length} edge(s) do not have exactly two incident triangles; first edge ${invalid[0]![0]} has ${invalid[0]![1]}`];
}

export function validateCells(cells: readonly Cell[]): ValidationResult {
  const syntax = validateCellSyntax(cells);
  if (!syntax.ok) return syntax;
  const derived = deriveVertexRemaps(cells);
  if (derived.errors.length > 0) return { ok: false, errors: derived.errors };
  const mesh = buildMeshCore(cells, derived.remaps);
  const topologyErrors = validateClosedTopology(mesh);
  return { ok: topologyErrors.length === 0, errors: topologyErrors };
}

function buildMeshCore(
  cellsInput: readonly (Cell | CanonicalCell)[],
  remaps: readonly VertexRemap[],
  options?: Pick<MeshBuildOptions, 'occupiedKeys' | 'cellByKey'>,
): MeshBuildResult {
  const { cells } = dedupeCells(cellsInput);
  const triangles: Triangle[] = [];
  const warnings: string[] = [];
  const occupied = options?.occupiedKeys ?? new Set<CellKey>(cells.map(cellKeyOf));
  const cellByKey = options?.cellByKey ?? new Map<CellKey, Cell>(cells.map((cell) => [cellKeyOf(cell), { ...cell, shape: 'cube' }]));
  const remapLookup = remapIndex(remaps);
  const facesByCell = new Map<CellKey, Map<FaceName, FaceDef>>();
  const shiftedFacesFor = (cell: Cell | CanonicalCell): Map<FaceName, FaceDef> => {
    const key = cellKeyOf(cell);
    const cached = facesByCell.get(key);
    if (cached) return cached;
    const result = new Map<FaceName, FaceDef>();
    for (const face of baseFaces(cell.x, cell.y, cell.z)) {
      result.set(face.name, { name: face.name, verts: face.verts.map((point) => resolveLatticePoint(point, remapLookup)) });
    }
    facesByCell.set(key, result);
    return result;
  };
  for (const cell of cells) {
    const cellKey = cellKeyOf(cell);
    const faces = shiftedFacesFor(cell);
    for (const face of faces.values()) {
      const neighborKey = neighborForFace(cell, face.name);
      const neighbor = cellByKey.get(neighborKey);
      if (occupied.has(neighborKey) && neighbor) {
        const opposite = shiftedFacesFor(neighbor).get(oppositeFace(face.name));
        if (opposite && facesMatchExactly(face, opposite)) continue;
      }
      const materialId = cell.materials?.[face.name] ?? `material/${face.name}`;
      const emitted = polygonToTriangles(face, materialId, cellKey);
      if (emitted.length === 0) warnings.push(`Degenerate face dropped for ${cellKey}:${face.name}`);
      triangles.push(...emitted);
    }
  }
  // Remaps can collapse only part of a logical quad onto another face. Remove exact
  // coincident triangle pairs so corner wedges retain a half-bottom instead of a
  // zero-thickness overlapping surface.
  const trianglesBySignature = new Map<string, number[]>();
  for (let index = 0; index < triangles.length; index += 1) {
    const signature = triangleSignature(triangles[index]!);
    const matches = trianglesBySignature.get(signature) ?? [];
    matches.push(index);
    trianglesBySignature.set(signature, matches);
  }
  const removed = new Set<number>();
  for (const matches of trianglesBySignature.values()) {
    for (let index = 0; index + 1 < matches.length; index += 2) {
      removed.add(matches[index]!);
      removed.add(matches[index + 1]!);
    }
    if (matches.length > 2) warnings.push(`More than two triangles shared one geometric face (${matches.length})`);
  }
  return { triangles: triangles.filter((_, index) => !removed.has(index)), warnings };
}

export function buildMesh(cellsInput: Cell[], options?: MeshBuildOptions): MeshBuildResult {
  if (options?.occupiedKeys && options.vertexRemaps) {
    return buildMeshCore(cellsInput, options.vertexRemaps, options);
  }
  const syntax = validateCellSyntax(cellsInput);
  if (!syntax.ok) throw new Error(syntax.errors.join('; '));
  const derived = deriveVertexRemaps(cellsInput);
  if (derived.errors.length > 0) throw new Error(derived.errors.join('; '));
  const remaps = options?.vertexRemaps ?? derived.remaps;
  const mesh = buildMeshCore(cellsInput, remaps, options);
  if (!options?.occupiedKeys) {
    const topologyErrors = validateClosedTopology(mesh);
    if (topologyErrors.length > 0) throw new Error(topologyErrors.join('; '));
  }
  return mesh;
}

export function buildCanonicalMesh(map: EncounterMapCanonical): MeshBuildResult {
  const validation = validateCanonicalMap(map);
  if (!validation.ok) throw new Error(validation.errors.join('; '));
  const mesh = buildMeshCore(map.occupiedCells, map.vertexRemaps);
  const topologyErrors = validateClosedTopology(mesh);
  if (topologyErrors.length > 0) throw new Error(topologyErrors.join('; '));
  return mesh;
}

export function buildIndexedMeshBuffers(mesh: MeshBuildResult, options: IndexedMeshBufferOptions = {}): IndexedMeshBuffers {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const vertexIndex = new Map<string, number>();
  const materialIds = [...new Set(mesh.triangles.map((tri) => tri.materialId))].sort();
  const materialLookup = new Map(materialIds.map((id, index) => [id, index]));
  const triangleCellKeys: CellKey[] = [];
  const triangleFaceNames: FaceName[] = [];
  const materialIndices: number[] = [];
  const smoothNormals = new Map<string, Vec3>();
  if (options.smoothNormals) {
    for (const triangle of mesh.triangles) {
      const normal = cross(subtract(triangle.b, triangle.a), subtract(triangle.c, triangle.a));
      for (const point of [triangle.a, triangle.b, triangle.c]) {
        const key = pointKey(point);
        const current = smoothNormals.get(key) ?? [0, 0, 0];
        smoothNormals.set(key, [current[0] + normal[0], current[1] + normal[1], current[2] + normal[2]]);
      }
    }
  }
  for (const triangle of mesh.triangles) {
    const normalRaw = cross(subtract(triangle.b, triangle.a), subtract(triangle.c, triangle.a));
    const length = Math.sqrt(magnitudeSquared(normalRaw));
    for (const point of [triangle.a, triangle.b, triangle.c]) {
      const selectedNormal = smoothNormals.get(pointKey(point)) ?? normalRaw;
      const selectedLength = Math.sqrt(magnitudeSquared(selectedNormal));
      const normal: Vec3 = [
        selectedNormal[0] / selectedLength,
        selectedNormal[1] / selectedLength,
        selectedNormal[2] / selectedLength,
      ];
      const uv = triangle.faceName === 'top' || triangle.faceName === 'bottom'
        ? [point[0], point[1]]
        : triangle.faceName === 'north' || triangle.faceName === 'south'
          ? [point[0], point[2]]
          : [point[1], point[2]];
      // Split vertices by face normal and material to preserve hard voxel edges and material groups.
      const signature = `${pointKey(point)}|${normal.map((value) => value.toFixed(9)).join(',')}|${uv.join(',')}|${triangle.materialId}`;
      let index = vertexIndex.get(signature);
      if (index === undefined) {
        index = positions.length / 3;
        vertexIndex.set(signature, index);
        positions.push(...point);
        normals.push(...normal);
        uvs.push(...uv);
      }
      indices.push(index);
    }
    triangleCellKeys.push(triangle.cellKey);
    triangleFaceNames.push(triangle.faceName);
    materialIndices.push(materialLookup.get(triangle.materialId)!);
  }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    uvs: Float32Array.from(uvs),
    indices: Uint32Array.from(indices),
    triangleCellKeys,
    triangleFaceNames,
    materialIds,
    materialIndexByTriangle: Uint16Array.from(materialIndices),
  };
}
