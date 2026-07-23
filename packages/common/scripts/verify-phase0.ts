import { performance } from 'node:perf_hooks';
import { buildChunkMeshes, buildMesh, type Cell, type ShapeKind } from '../src';

const SHAPES: ShapeKind[] = [
  'cube', 'rampXPos', 'rampXNeg', 'rampYPos', 'rampYNeg',
  'cornerRampNE', 'cornerRampNW', 'cornerRampSE', 'cornerRampSW',
];

const BUDGETS = { cells: 800, maxMedianMeshMs: 30, maxMedianChunkedMeshMs: 60 };
const ENFORCE_TIMING = process.env.ENFORCE_PHASE0_TIMING === '1';

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function generateSparseMixed(count: number, seed = 42): Cell[] {
  const rand = seededRandom(seed);
  const seen = new Set<string>();
  const cells: Cell[] = [];
  while (cells.length < count) {
    // Even coordinates deliberately isolate shapes; adjacency is covered exhaustively by tests.
    const x = Math.floor(rand() * 50) * 2;
    const y = Math.floor(rand() * 50) * 2;
    const z = Math.floor(rand() * 10) * 2;
    const key = `${x},${y},${z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cells.push({ x, y, z, shape: SHAPES[Math.floor(rand() * SHAPES.length)] ?? 'cube' });
  }
  return cells;
}

function generateDenseCubes(): Cell[] {
  const cells: Cell[] = [];
  for (let z = 0; z < 2; z += 1) {
    for (let y = 0; y < 20; y += 1) {
      for (let x = 0; x < 20; x += 1) cells.push({ x, y, z, shape: 'cube' });
    }
  }
  return cells;
}

function percentile(samples: number[], fraction: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
}

function measure(name: string, cells: Cell[]) {
  buildMesh(cells);
  buildChunkMeshes(cells, 16);
  const meshSamples: number[] = [];
  const chunkSamples: number[] = [];
  const meshCpuSamples: number[] = [];
  const chunkCpuSamples: number[] = [];
  let meshTriangles = 0;
  let chunkTriangles = 0;
  let chunks = 0;
  for (let run = 0; run < 5; run += 1) {
    let start = performance.now();
    let cpuStart = process.cpuUsage();
    const mesh = buildMesh(cells);
    meshSamples.push(performance.now() - start);
    let cpu = process.cpuUsage(cpuStart);
    meshCpuSamples.push((cpu.user + cpu.system) / 1000);
    start = performance.now();
    cpuStart = process.cpuUsage();
    const chunked = buildChunkMeshes(cells, 16);
    chunkSamples.push(performance.now() - start);
    cpu = process.cpuUsage(cpuStart);
    chunkCpuSamples.push((cpu.user + cpu.system) / 1000);
    meshTriangles = mesh.triangles.length;
    chunkTriangles = chunked.chunks.reduce((sum, chunk) => sum + chunk.mesh.triangles.length, 0);
    chunks = chunked.chunks.length;
  }
  return {
    name,
    cells: cells.length,
    chunks,
    triangles: meshTriangles,
    chunkTriangles,
    meshMs: { median: percentile(meshSamples, 0.5), p95: percentile(meshSamples, 0.95) },
    chunkedMeshMs: { median: percentile(chunkSamples, 0.5), p95: percentile(chunkSamples, 0.95) },
    meshCpuMs: { median: percentile(meshCpuSamples, 0.5), p95: percentile(meshCpuSamples, 0.95) },
    chunkedMeshCpuMs: { median: percentile(chunkCpuSamples, 0.5), p95: percentile(chunkCpuSamples, 0.95) },
  };
}

function main() {
  const profiles = [
    measure('sparse-mixed', generateSparseMixed(BUDGETS.cells)),
    measure('dense-cubes', generateDenseCubes()),
  ];
  const failures: string[] = [];
  for (const profile of profiles) {
    if (profile.triangles !== profile.chunkTriangles) failures.push(`${profile.name}: triangle count mismatch`);
  }
  const sparse = profiles[0]!;
  if (ENFORCE_TIMING && sparse.meshMs.median > BUDGETS.maxMedianMeshMs) failures.push(`sparse mesh median exceeded: ${sparse.meshMs.median.toFixed(3)}ms`);
  if (ENFORCE_TIMING && sparse.chunkedMeshMs.median > BUDGETS.maxMedianChunkedMeshMs) failures.push(`sparse chunk median exceeded: ${sparse.chunkedMeshMs.median.toFixed(3)}ms`);
  const round = (value: number) => Number(value.toFixed(3));
  const report = {
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    sampling: { warmupRuns: 1, measuredRuns: 5 },
    timingEnforced: ENFORCE_TIMING,
    profiles: profiles.map((profile) => ({
      ...profile,
      meshMs: { median: round(profile.meshMs.median), p95: round(profile.meshMs.p95) },
      chunkedMeshMs: { median: round(profile.chunkedMeshMs.median), p95: round(profile.chunkedMeshMs.p95) },
      meshCpuMs: { median: round(profile.meshCpuMs.median), p95: round(profile.meshCpuMs.p95) },
      chunkedMeshCpuMs: { median: round(profile.chunkedMeshCpuMs.median), p95: round(profile.chunkedMeshCpuMs.p95) },
    })),
    budgets: BUDGETS,
    failures,
  };
  console.log(JSON.stringify(report, null, 2));
  if (failures.length > 0) process.exit(1);
}

main();
