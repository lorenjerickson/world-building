import { dedupeCells } from './canonical';
import { buildMesh, deriveVertexRemaps, validateCells } from './geometry';
import type {
  Cell,
  CellKey,
  ChunkMesh,
  ChunkMeshBuildResult,
  ChunkMeshRebuildResult,
  Vec3,
} from './types';

function keyOf(cell: Cell): CellKey {
  return `${cell.x},${cell.y},${cell.z}`;
}

function chunkCoord(value: number, chunkSize: number): number {
  return Math.floor(value / chunkSize);
}

function chunkKey(coord: Vec3): string {
  return `${coord[0]},${coord[1]},${coord[2]}`;
}

function parseCellKey(key: CellKey): Vec3 {
  const [x, y, z] = key.split(',').map((value) => Number(value));
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    throw new Error(`Invalid cell key: ${key}`);
  }
  return [x, y, z];
}

function neighborChunkCoords(coord: Vec3): Vec3[] {
  return [
    coord,
    [coord[0] + 1, coord[1], coord[2]],
    [coord[0] - 1, coord[1], coord[2]],
    [coord[0], coord[1] + 1, coord[2]],
    [coord[0], coord[1] - 1, coord[2]],
    [coord[0], coord[1], coord[2] + 1],
    [coord[0], coord[1], coord[2] - 1],
  ];
}

function indexChunks(cellsInput: Cell[], chunkSize: number): {
  cells: Cell[];
  occupied: Set<CellKey>;
  cellByKey: Map<CellKey, Cell>;
  byChunk: Map<string, { coord: Vec3; cells: Cell[] }>;
} {
  const { cells } = dedupeCells(cellsInput);
  const occupied = new Set<CellKey>(cells.map(keyOf));
  const cellByKey = new Map<CellKey, Cell>();
  const byChunk = new Map<string, { coord: Vec3; cells: Cell[] }>();

  for (const cell of cells) {
    const k = keyOf(cell);
    cellByKey.set(k, cell);

    const coord: Vec3 = [
      chunkCoord(cell.x, chunkSize),
      chunkCoord(cell.y, chunkSize),
      chunkCoord(cell.z, chunkSize),
    ];
    const id = chunkKey(coord);
    const existing = byChunk.get(id);
    if (existing) {
      existing.cells.push(cell);
      continue;
    }
    byChunk.set(id, { coord, cells: [cell] });
  }

  return { cells, occupied, cellByKey, byChunk };
}

function renderChunks(
  byChunk: Map<string, { coord: Vec3; cells: Cell[] }>,
  occupied: Set<CellKey>,
  cellByKey: Map<CellKey, Cell>,
  vertexRemaps: ReturnType<typeof deriveVertexRemaps>['remaps'],
  includeKeys?: ReadonlySet<string>,
): ChunkMesh[] {
  return [...byChunk.entries()]
    .filter(([id]) => (includeKeys ? includeKeys.has(id) : true))
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, data]) => ({
      chunkKey: id,
      chunkCoord: data.coord,
      cells: data.cells,
      mesh: buildMesh(data.cells, { occupiedKeys: occupied, cellByKey, vertexRemaps }),
    }));
}

export function buildChunkMeshes(cellsInput: Cell[], chunkSize = 16): ChunkMeshBuildResult {
  if (chunkSize < 1) {
    throw new Error('chunkSize must be >= 1');
  }
  const validation = validateCells(cellsInput);
  if (!validation.ok) throw new Error(validation.errors.join('; '));

  const { occupied, cellByKey, byChunk } = indexChunks(cellsInput, chunkSize);
  const vertexRemaps = deriveVertexRemaps(cellsInput).remaps;
  const chunks = renderChunks(byChunk, occupied, cellByKey, vertexRemaps);

  return {
    chunkSize,
    chunks,
  };
}

export function rebuildChunkMeshes(
  cellsInput: Cell[],
  changedCellKeys: CellKey[],
  chunkSize = 16,
): ChunkMeshRebuildResult {
  if (chunkSize < 1) {
    throw new Error('chunkSize must be >= 1');
  }
  const validation = validateCells(cellsInput);
  if (!validation.ok) throw new Error(validation.errors.join('; '));

  const { occupied, cellByKey, byChunk } = indexChunks(cellsInput, chunkSize);
  const vertexRemaps = deriveVertexRemaps(cellsInput).remaps;
  const changedChunkKeys = new Set<string>();

  for (const changedKey of changedCellKeys) {
    const [x, y, z] = parseCellKey(changedKey);
    const baseCoord: Vec3 = [
      chunkCoord(x, chunkSize),
      chunkCoord(y, chunkSize),
      chunkCoord(z, chunkSize),
    ];
    changedChunkKeys.add(chunkKey(baseCoord));

    for (const coord of neighborChunkCoords(baseCoord)) {
      const id = chunkKey(coord);
      if (byChunk.has(id)) changedChunkKeys.add(id);
    }
  }

  const chunks = renderChunks(byChunk, occupied, cellByKey, vertexRemaps, changedChunkKeys);

  return {
    chunkSize,
    changedChunkKeys: [...changedChunkKeys].sort((a, b) => a.localeCompare(b)),
    chunks,
  };
}
