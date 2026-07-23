import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  buildCanonicalMesh,
  buildIndexedMeshBuffers,
  buildMesh,
  buildChunkMeshes,
  rebuildChunkMeshes,
  subdivideMesh,
  canonicalizeMap,
  checksumCanonicalMap,
  deriveVertexRemaps,
  validateCanonicalMap,
  pickFirstTriangle,
  projectTrianglesTopDown,
  PHASE0_MATERIAL_PALETTE,
  validateCells,
  type Cell,
  type EncounterMapCanonical,
  type ShapeKind,
} from '../src';

const ALL_SHAPES: ShapeKind[] = [
  'cube', 'rampXPos', 'rampXNeg', 'rampYPos', 'rampYNeg',
  'cornerRampNE', 'cornerRampNW', 'cornerRampSE', 'cornerRampSW',
];

function edgeKey(a: readonly number[], b: readonly number[]): string {
  const left = a.join(',');
  const right = b.join(',');
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function assertClosedManifold(cells: Cell[]) {
  const mesh = buildMesh(cells);
  const edges = new Map<string, number>();
  for (const triangle of mesh.triangles) {
    for (const [a, b] of [[triangle.a, triangle.b], [triangle.b, triangle.c], [triangle.c, triangle.a]] as const) {
      const key = edgeKey(a, b);
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  for (const [edge, count] of edges) assert.equal(count, 2, `non-manifold edge ${edge} for ${JSON.stringify(cells)}`);
}

test('cube produces 12 triangles', () => {
  const cells: Cell[] = [{ x: 0, y: 0, z: 0, shape: 'cube' }];
  const mesh = buildMesh(cells);
  assert.equal(mesh.triangles.length, 12);
});

test('cube triangles use outward winding', () => {
  const mesh = buildMesh([{ x: 0, y: 0, z: 0, shape: 'cube' }]);
  const center = [0.5, 0.5, 0.5] as const;
  for (const tri of mesh.triangles) {
    const ab = [tri.b[0] - tri.a[0], tri.b[1] - tri.a[1], tri.b[2] - tri.a[2]] as const;
    const ac = [tri.c[0] - tri.a[0], tri.c[1] - tri.a[1], tri.c[2] - tri.a[2]] as const;
    const normal = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ] as const;
    const centroid = [(tri.a[0] + tri.b[0] + tri.c[0]) / 3, (tri.a[1] + tri.b[1] + tri.c[1]) / 3, (tri.a[2] + tri.b[2] + tri.c[2]) / 3] as const;
    const outward = normal[0] * (centroid[0] - center[0]) + normal[1] * (centroid[1] - center[1]) + normal[2] * (centroid[2] - center[2]);
    assert.ok(outward > 0, `${tri.faceName} triangle should face outwards`);
  }
});

test('all ramp orientations are meshable and deterministic', () => {
  const cells: Cell[] = [
    { x: 0, y: 0, z: 0, shape: 'rampXPos' },
    { x: 2, y: 0, z: 0, shape: 'rampXNeg' },
    { x: 4, y: 0, z: 0, shape: 'rampYPos' },
    { x: 6, y: 0, z: 0, shape: 'rampYNeg' },
  ];
  const first = buildMesh(cells);
  const second = buildMesh([...cells].reverse());
  assert.equal(first.triangles.length, second.triangles.length);
  assert.deepEqual(first.triangles, second.triangles);
});

test('all corner ramp orientations are meshable and deterministic', () => {
  const cells: Cell[] = [
    { x: 0, y: 0, z: 0, shape: 'cornerRampNE' },
    { x: 2, y: 0, z: 0, shape: 'cornerRampNW' },
    { x: 4, y: 0, z: 0, shape: 'cornerRampSE' },
    { x: 6, y: 0, z: 0, shape: 'cornerRampSW' },
  ];

  const first = buildMesh(cells);
  const second = buildMesh([...cells].reverse());
  assert.equal(first.triangles.length, second.triangles.length);
  assert.deepEqual(first.triangles, second.triangles);
});

test('every supported shape pair remains closed across every adjacency axis', () => {
  const offsets = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [16, 0, 0]] as const;
  let rejected = 0;
  for (const first of ALL_SHAPES) {
    for (const second of ALL_SHAPES) {
      for (const [dx, dy, dz] of offsets) {
        const originX = dx === 16 ? 15 : 0;
        const adjacentX = dx === 16 ? 16 : dx;
        const cells: Cell[] = [
          { x: originX, y: 0, z: 0, shape: first },
          { x: adjacentX, y: dy, z: dz, shape: second },
        ];
        const validation = validateCells(cells);
        if (validation.ok) assertClosedManifold(cells);
        else {
          rejected += 1;
          assert.ok(validation.errors.some((error) => error.includes('Non-manifold topology')));
        }
      }
    }
  }
  assert.ok(rejected > 0, 'the vocabulary should explicitly reject incompatible adjacency');
});

test('adjacent cubes cull interior faces', () => {
  const cells: Cell[] = [
    { x: 0, y: 0, z: 0, shape: 'cube' },
    { x: 1, y: 0, z: 0, shape: 'cube' },
  ];
  const mesh = buildMesh(cells);
  assert.equal(mesh.triangles.length, 20);
});

test('successive placements along every edge of the starter plane remain renderable', () => {
  const materials = { top: 'dirt', bottom: 'dirt', north: 'dirt', south: 'dirt', east: 'dirt', west: 'dirt' } as const;
  const map: EncounterMapCanonical = {
    formatVersion: 'encounter-map/1',
    scaleInFeet: 5,
    paletteVersion: PHASE0_MATERIAL_PALETTE.version,
    bounds: { min: [0, 0, 0], max: [16, 16, 8] },
    occupiedCells: Array.from({ length: 100 }, (_, index) => ({
      x: 3 + index % 10,
      y: 3 + Math.floor(index / 10),
      z: 0,
      materials,
    })),
    vertexRemaps: [],
  };
  const placements = [
    { x: 13, y: 3, z: 0 }, { x: 13, y: 4, z: 0 },
    { x: 2, y: 3, z: 0 }, { x: 2, y: 4, z: 0 },
    { x: 3, y: 13, z: 0 }, { x: 4, y: 13, z: 0 },
    { x: 3, y: 2, z: 0 }, { x: 4, y: 2, z: 0 },
  ];
  for (const placement of placements) {
    map.occupiedCells.push({ ...placement, materials });
    assert.ok(buildCanonicalMesh(map).triangles.length > 0, `placement ${JSON.stringify(placement)} should retain a renderable mesh`);
  }
});

test('stacked cells remain valid', () => {
  const cells: Cell[] = [
    { x: 0, y: 0, z: 0, shape: 'cube' },
    { x: 0, y: 0, z: 1, shape: 'rampYPos' },
  ];
  const mesh = buildMesh(cells);
  assert.ok(mesh.triangles.length > 0);
});

test('degenerate and duplicate cases are rejected with useful errors', () => {
  const result = validateCells([
    { x: -1, y: 0, z: 0, shape: 'cube' },
    { x: 0, y: 0, z: 0, shape: 'cube' },
    { x: 0, y: 0, z: 0, shape: 'rampXPos' },
  ]);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((x) => x.includes('Negative coordinates')));
  assert.ok(result.errors.some((x) => x.includes('Duplicate cells')));
});

test('canonical checksum is stable across input order', () => {
  const mapA: EncounterMapCanonical = {
    formatVersion: 'encounter-map/1',
    scaleInFeet: 5,
    paletteVersion: 'core/1',
    bounds: { min: [0, 0, 0], max: [10, 10, 10] },
    occupiedCells: [
      { x: 1, y: 0, z: 0, materials: { top: 'stone', north: 'grass' } },
      { x: 0, y: 0, z: 0 },
    ],
    vertexRemaps: [{ from: [1, 0, 1], to: [1, 0, 0] }],
  };

  const mapB: EncounterMapCanonical = {
    ...mapA,
    occupiedCells: [...mapA.occupiedCells].reverse().map((cell) => cell.materials
      ? { ...cell, materials: { north: cell.materials.north!, top: cell.materials.top! } }
      : cell),
    vertexRemaps: [...mapA.vertexRemaps].reverse(),
  };

  assert.equal(checksumCanonicalMap(mapA), checksumCanonicalMap(mapB));
  const expected = createHash('sha256').update(JSON.stringify(canonicalizeMap(mapA))).digest('hex');
  assert.equal(checksumCanonicalMap(mapA), expected);
});

test('canonical map enforces scale preset policy', () => {
  const valid = validateCanonicalMap({
    formatVersion: 'encounter-map/1',
    scaleInFeet: 1,
    paletteVersion: 'core/1',
    bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    occupiedCells: [],
    vertexRemaps: [],
  });
  assert.equal(valid.ok, true);

  const invalid = validateCanonicalMap({
    formatVersion: 'encounter-map/1',
    scaleInFeet: 2,
    paletteVersion: 'core/1',
    bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    occupiedCells: [],
    vertexRemaps: [],
  });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((x) => x.includes('scaleInFeet must be one of 0.5, 1, 5')));
});

test('canonical validation rejects missing sparse arrays without throwing', () => {
  const invalid = validateCanonicalMap({
    formatVersion: 'encounter-map/1',
    scaleInFeet: 5,
    paletteVersion: 'core/1',
    bounds: { min: [0, 0, 0], max: [1, 1, 1] },
  } as unknown as EncounterMapCanonical);

  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.includes('occupiedCells must be an array'));
  assert.ok(invalid.errors.includes('vertexRemaps must be an array'));
});

test('canonical validation rejects invalid bounds, cells, remaps, and palette metadata', () => {
  const invalid = validateCanonicalMap({
    formatVersion: 'encounter-map/1',
    scaleInFeet: 5,
    paletteVersion: '',
    bounds: { min: [0, 0, 0], max: [2, 2, 2] },
    occupiedCells: [{ x: 2, y: 0, z: 0 }],
    vertexRemaps: [
      { from: [1, 1, 1], to: [1, 1, 0] },
      { from: [1, 1, 0], to: [1, 1, 1] },
    ],
  });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((error) => error.includes('paletteVersion')));
  assert.ok(invalid.errors.some((error) => error.includes('outside declared bounds')));
  assert.ok(invalid.errors.some((error) => error.includes('Cyclic vertex remap')));
});

test('palette validation accepts water on horizontal or vertical faces and rejects unknown IDs', () => {
  const base: EncounterMapCanonical = {
    formatVersion: 'encounter-map/1',
    scaleInFeet: 5,
    paletteVersion: 'core/1',
    bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    occupiedCells: [{ x: 0, y: 0, z: 0, materials: { top: 'water', north: 'water' } }],
    vertexRemaps: [],
  };
  assert.equal(validateCanonicalMap(base, PHASE0_MATERIAL_PALETTE).ok, true);
  const invalid = { ...base, occupiedCells: [{ x: 0, y: 0, z: 0, materials: { top: 'lava' } }] } as EncounterMapCanonical;
  assert.ok(validateCanonicalMap(invalid, PHASE0_MATERIAL_PALETTE).errors.some((error) => error.includes("Unresolved material 'lava'")));
});

test('shape presets compile to shared lattice remaps and reject a zero-thickness join', () => {
  const cells: Cell[] = [
    { x: 0, y: 0, z: 0, shape: 'rampXPos' },
    { x: 1, y: 0, z: 0, shape: 'cube' },
  ];
  const derived = deriveVertexRemaps(cells);
  assert.deepEqual(derived.errors, []);
  assert.ok(derived.remaps.some((remap) => String(remap.from) === '1,0,1' && String(remap.to) === '1,0,0'));
  const validation = validateCells(cells);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((error) => error.includes('Non-manifold topology')));
});

test('canonical meshes reproduce explicitly stored shared remaps', () => {
  const map: EncounterMapCanonical = {
    formatVersion: 'encounter-map/1',
    scaleInFeet: 5,
    paletteVersion: 'core/1',
    bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    occupiedCells: [{ x: 0, y: 0, z: 0 }],
    vertexRemaps: [
      { from: [1, 0, 1], to: [1, 0, 0] },
      { from: [1, 1, 1], to: [1, 1, 0] },
    ],
  };
  const mesh = buildCanonicalMesh(map);
  assert.equal(mesh.triangles.filter((tri) => tri.faceName === 'east' && tri.cellKey === '0,0,0').length, 0);
  assert.ok(mesh.triangles.length > 0);
});

test('renderer buffers are indexed and retain material and picking metadata', () => {
  const mesh = buildMesh([{ x: 0, y: 0, z: 0, shape: 'cube', materials: { top: 'water' } }]);
  const buffers = buildIndexedMeshBuffers(mesh);
  assert.equal(buffers.indices.length, mesh.triangles.length * 3);
  assert.ok(buffers.positions.length < mesh.triangles.length * 9);
  assert.equal(buffers.normals.length, buffers.positions.length);
  assert.equal(buffers.uvs.length, (buffers.positions.length / 3) * 2);
  assert.ok(buffers.materialIds.includes('water'));
  assert.equal(buffers.triangleCellKeys.length, mesh.triangles.length);
});

test('visual subdivision refines and rounds a mesh without changing logical cell ownership', () => {
  const logical = buildMesh([{ x: 0, y: 0, z: 0, shape: 'cube' }]);
  const refined = subdivideMesh(logical, 2);

  assert.equal(refined.triangles.length, logical.triangles.length * 4 ** 2);
  assert.deepEqual(
    new Set(refined.triangles.map((triangle) => triangle.cellKey)),
    new Set(logical.triangles.map((triangle) => triangle.cellKey)),
  );
  assert.ok(refined.triangles.some((triangle) => (
    [triangle.a, triangle.b, triangle.c].some((point) => point.some((coordinate) => coordinate > 0 && coordinate < 1))
  )));
});

test('visual subdivision validates its bounded level and smooth buffers retain metadata', () => {
  const logical = buildMesh([{ x: 0, y: 0, z: 0, shape: 'cube', materials: { top: 'water' } }]);
  assert.throws(() => subdivideMesh(logical, 4), /integer from 0 to 3/);

  const refined = subdivideMesh(logical, 1);
  const buffers = buildIndexedMeshBuffers(refined, { smoothNormals: true });
  assert.equal(buffers.indices.length, refined.triangles.length * 3);
  assert.equal(buffers.triangleCellKeys.length, refined.triangles.length);
  assert.ok(buffers.materialIds.includes('water'));
});

test('canonical subdivision setting is optional for legacy maps and bounded when present', () => {
  const base: EncounterMapCanonical = {
    formatVersion: 'encounter-map/1',
    scaleInFeet: 5,
    paletteVersion: 'core/1',
    bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    occupiedCells: [],
    vertexRemaps: [],
  };
  assert.equal(validateCanonicalMap(base).ok, true);
  assert.equal(validateCanonicalMap({ ...base, surfaceSubdivisionLevel: 3 }).ok, true);
  assert.ok(validateCanonicalMap({ ...base, surfaceSubdivisionLevel: 4 }).errors.some((error) => error.includes('surfaceSubdivisionLevel')));
});

test('top-down projection returns 2D coordinates', () => {
  const mesh = buildMesh([{ x: 0, y: 0, z: 0, shape: 'cube' }]);
  const projected = projectTrianglesTopDown(mesh.triangles);
  assert.ok(projected.length > 0);
  assert.equal(typeof projected[0]?.vertices[0]?.x, 'number');
  assert.equal(typeof projected[0]?.vertices[0]?.y, 'number');
});

test('ray picking returns nearest cell hit', () => {
  const mesh = buildMesh([
    { x: 0, y: 0, z: 0, shape: 'cube' },
    { x: 0, y: 0, z: 3, shape: 'cube' },
  ]);

  const hit = pickFirstTriangle([0.5, 0.5, 10], [0, 0, -1], mesh.triangles);
  assert.ok(hit);
  assert.equal(hit?.cellKey, '0,0,3');
});

test('chunk meshing culls interior faces across chunk boundaries', () => {
  const cells: Cell[] = [
    { x: 15, y: 0, z: 0, shape: 'cube' },
    { x: 16, y: 0, z: 0, shape: 'cube' },
  ];

  const chunked = buildChunkMeshes(cells, 16);
  const total = chunked.chunks.reduce((sum, chunk) => sum + chunk.mesh.triangles.length, 0);
  assert.equal(chunked.chunks.length, 2);
  assert.equal(total, 20);
});

test('chunk meshing is deterministic regardless of input order', () => {
  const cells: Cell[] = [
    { x: 0, y: 0, z: 0, shape: 'cube' },
    { x: 17, y: 0, z: 0, shape: 'rampXPos' },
    { x: 17, y: 1, z: 0, shape: 'cube' },
  ];

  const a = buildChunkMeshes(cells, 16);
  const b = buildChunkMeshes([...cells].reverse(), 16);
  assert.deepEqual(a, b);
});

test('incremental chunk rebuild includes changed chunks and direct neighbors', () => {
  const cells: Cell[] = [
    { x: 15, y: 0, z: 0, shape: 'cube' },
    { x: 16, y: 0, z: 0, shape: 'cube' },
    { x: 32, y: 0, z: 0, shape: 'cube' },
  ];

  const rebuilt = rebuildChunkMeshes(cells, ['15,0,0'], 16);
  assert.deepEqual(rebuilt.changedChunkKeys, ['0,0,0', '1,0,0']);
  assert.equal(rebuilt.chunks.length, 2);
});

test('incremental chunk rebuild reports an emptied chunk for cache eviction', () => {
  const rebuilt = rebuildChunkMeshes([], ['15,0,0'], 16);
  assert.deepEqual(rebuilt.changedChunkKeys, ['0,0,0']);
  assert.deepEqual(rebuilt.chunks, []);
});

test('mixed neighboring ramps receive an explicit topology decision', () => {
  const result = validateCells([
    { x: 0, y: 0, z: 0, shape: 'rampXPos' },
    { x: 1, y: 0, z: 0, shape: 'rampYPos' },
  ]);

  assert.equal(typeof result.ok, 'boolean');
  if (!result.ok) assert.ok(result.errors.some((error) => error.includes('Non-manifold topology')));
});

test('mixed-shape exact shared faces are culled', () => {
  const mesh = buildMesh([
    { x: 0, y: 0, z: 0, shape: 'cube' },
    { x: 1, y: 0, z: 0, shape: 'rampXPos' },
  ]);

  assert.equal(mesh.triangles.length, 16);
  assert.equal(mesh.triangles.filter((tri) => (
    (tri.cellKey === '0,0,0' && tri.faceName === 'east')
    || (tri.cellKey === '1,0,0' && tri.faceName === 'west')
  )).length, 0);
});
