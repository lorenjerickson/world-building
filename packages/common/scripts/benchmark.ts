import { performance } from 'node:perf_hooks';
import { buildChunkMeshes, buildMesh, type Cell, type ShapeKind } from '../src';

const SHAPES: ShapeKind[] = [
  'cube',
  'rampXPos',
  'rampXNeg',
  'rampYPos',
  'rampYNeg',
  'cornerRampNE',
  'cornerRampNW',
  'cornerRampSE',
  'cornerRampSW',
];

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function generateSparseCells(count: number, seed = 42): Cell[] {
  const rand = seededRandom(seed);
  const seen = new Set<string>();
  const cells: Cell[] = [];

  while (cells.length < count) {
    // Isolate mixed presets; exhaustive adjacency correctness belongs to the test corpus.
    const x = Math.floor(rand() * 50) * 2;
    const y = Math.floor(rand() * 50) * 2;
    const z = Math.floor(rand() * 10) * 2;
    const key = `${x},${y},${z}`;
    if (seen.has(key)) continue;

    const shape = SHAPES[Math.floor(rand() * SHAPES.length)] ?? 'cube';

    seen.add(key);
    cells.push({ x, y, z, shape });
  }

  return cells;
}

function run() {
  const cells = generateSparseCells(800);

  const startMesh = performance.now();
  const mesh = buildMesh(cells);
  const endMesh = performance.now();

  const startChunk = performance.now();
  const chunked = buildChunkMeshes(cells, 16);
  const endChunk = performance.now();

  const chunkTriangles = chunked.chunks.reduce((sum, chunk) => sum + chunk.mesh.triangles.length, 0);

  console.log(JSON.stringify({
    sample: {
      cells: cells.length,
      chunkSize: chunked.chunkSize,
      chunks: chunked.chunks.length,
    },
    mesh: {
      triangleCount: mesh.triangles.length,
      ms: Number((endMesh - startMesh).toFixed(3)),
    },
    chunkedMesh: {
      triangleCount: chunkTriangles,
      ms: Number((endChunk - startChunk).toFixed(3)),
    },
  }, null, 2));
}

run();
