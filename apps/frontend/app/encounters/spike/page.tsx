import {
  buildChunkMeshes,
  buildMesh,
  pickFirstTriangle,
  projectTrianglesTopDown,
  type Cell,
} from "@world-building/common";
import { SpikeScene } from "./spike-scene";
import { HydrationProbe } from "./hydration-probe";

const SAMPLE_CELLS: Cell[] = [
  { x: 0, y: 0, z: 0, shape: "cube", materials: { top: "grass" } },
  { x: 1, y: 0, z: 0, shape: "cube", materials: { top: "grass", north: "stone" } },
  { x: 2, y: 0, z: 0, shape: "rampXPos", materials: { top: "road" } },
  { x: 4, y: 2, z: 0, shape: "rampYNeg", materials: { top: "dirt" } },
  { x: 8, y: 3, z: 0, shape: "cornerRampNE", materials: { top: "wood" } },
  { x: 10, y: 1, z: 0, shape: "cube", materials: { top: "water" } },
  { x: 11, y: 1, z: 0, shape: "cube", materials: { top: "water" } },
  { x: 15, y: 0, z: 0, shape: "cube", materials: { top: "stone" } },
  { x: 16, y: 0, z: 0, shape: "cube", materials: { top: "stone" } },
];

export default function EncounterGeometrySpikePage() {
  const mesh = buildMesh(SAMPLE_CELLS);
  const chunks = buildChunkMeshes(SAMPLE_CELLS, 16);
  const topDown = projectTrianglesTopDown(mesh.triangles);
  const pick = pickFirstTriangle([0.5, 0.5, 10], [0, 0, -1], mesh.triangles);

  return (
    <main className="dashboard-container encounter-spike-container">
      <header className="dashboard-header">
        <div className="header-left">
          <span className="eyebrow">Renderer diagnostics</span>
          <h2>Encounter geometry Phase 0 spike</h2>
          <p>This route validates shared-remap mesh generation, chunk partitioning, renderer-ready buffers, face materials, static water, camera projection, and picking.</p>
        </div>
      </header>

      <section className="card-surface encounter-spike-summary">
        <HydrationProbe />

        <div className="encounter-spike-stats">
          <article><span className="eyebrow">Canonical mesh</span><strong>{SAMPLE_CELLS.length}</strong><p>cells · {mesh.triangles.length} triangles · {mesh.warnings.length} warnings</p></article>
          <article><span className="eyebrow">Chunked mesh</span><strong>{chunks.chunks.length}</strong><p>chunks of {chunks.chunkSize} · {chunks.chunks.reduce((sum, chunk) => sum + chunk.mesh.triangles.length, 0)} triangles</p></article>
          <article><span className="eyebrow">2D projection</span><strong>{topDown.length}</strong><p>projected triangles</p></article>
          <article><span className="eyebrow">Picking probe</span><strong>{pick?.cellKey ?? "none"}</strong><p>{pick ? `first hit at t=${pick.t.toFixed(3)}` : "No triangle intersected"}</p></article>
        </div>
      </section>

      <section className="card-surface encounter-spike-renderer">
        <div className="recent-section-header"><div><span className="eyebrow">Rendering probe</span><h3>Interactive map viewport</h3><p>Inspect the same chunk-compatible geometry through perspective and orthographic cameras.</p></div></div>
        <SpikeScene triangles={mesh.triangles} />
      </section>
    </main>
  );
}
