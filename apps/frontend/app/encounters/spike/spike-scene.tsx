"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Triangle } from "@world-building/common";
import type { EncounterEditMode, EncounterSurfaceAction, EncounterSurfaceHit } from "./webgl-scene";

type ViewMode = "perspective" | "overhead" | "svg2d";
type WebGLSupport = { available: boolean; label: string };
type RendererStats = { fps: number; frameMs: number; drawCalls: number; triangles: number; dpr: number; webgl2: boolean };

const WebGLScene = dynamic(
  () => import("./webgl-scene").then((module) => module.WebGLScene),
  { ssr: false, loading: () => <div className="encounter-renderer-loading" role="status">Loading the optional WebGL renderer…</div> },
);

const MATERIAL_COLORS: Record<string, string> = {
  grass: "#5f7f3b", dirt: "#75543a", stone: "#777b7d", road: "#9a835f", wood: "#805a37", water: "#2f89ad",
  "material/top": "#718f4b", "material/bottom": "#5a4432", "material/north": "#80684b", "material/south": "#80684b",
  "material/east": "#725b42", "material/west": "#725b42",
};

function detectWebGLSupport(): WebGLSupport {
  try {
    const canvas = document.createElement("canvas");
    if (canvas.getContext("webgl2")) return { available: true, label: "WebGL 2 context created" };
    if (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")) return { available: true, label: "WebGL 1 context created" };
    return { available: false, label: "The browser did not provide a WebGL context" };
  } catch (error) {
    return { available: false, label: error instanceof Error ? error.message : "WebGL capability detection failed" };
  }
}

function Compatibility2DView({ triangles }: { triangles: Triangle[] }) {
  const projection = useMemo(() => {
    const points = triangles.flatMap((triangle) => [triangle.a, triangle.b, triangle.c]);
    if (points.length === 0) return { viewBox: "-1 -1 2 2", triangles: [] as Triangle[] };
    const minX = Math.min(...points.map((point) => point[0]));
    const maxX = Math.max(...points.map((point) => point[0]));
    const minY = Math.min(...points.map((point) => point[1]));
    const maxY = Math.max(...points.map((point) => point[1]));
    const padding = 0.75;
    return {
      viewBox: `${minX - padding} ${-maxY - padding} ${Math.max(1, maxX - minX) + padding * 2} ${Math.max(1, maxY - minY) + padding * 2}`,
      triangles: [...triangles].sort((left, right) => {
        const leftZ = (left.a[2] + left.b[2] + left.c[2]) / 3;
        const rightZ = (right.a[2] + right.b[2] + right.c[2]) / 3;
        return leftZ - rightZ;
      }),
    };
  }, [triangles]);

  return <svg viewBox={projection.viewBox} preserveAspectRatio="xMidYMid meet" className="encounter-compatibility-map" role="img" aria-label="Server-rendered SVG top-down encounter map compatibility view">
    <rect x="-100" y="-100" width="300" height="300" fill="#c9d3d8" />
    <g transform="scale(1 -1)">
      {projection.triangles.map((triangle, index) => <polygon
        key={`${triangle.cellKey}-${triangle.faceName}-${index}`}
        points={[triangle.a, triangle.b, triangle.c].map((point) => `${point[0]},${point[1]}`).join(" ")}
        fill={MATERIAL_COLORS[triangle.materialId] ?? "#b15f52"}
        stroke="rgba(31, 42, 46, 0.65)"
        strokeWidth="0.035"
        vectorEffect="non-scaling-stroke"
      />)}
    </g>
  </svg>;
}

export function SpikeScene({ compactDiagnostics = false, editMode, onSelectedCellChange, onSurfaceAction, onSurfaceActionEnd, showViewControls = true, subdivisionLevel = 0, triangles }: {
  compactDiagnostics?: boolean;
  editMode?: EncounterEditMode;
  triangles: Triangle[];
  onSelectedCellChange?: (cellKey: string | null) => void;
  onSurfaceAction?: (hit: EncounterSurfaceHit, action: EncounterSurfaceAction) => void;
  onSurfaceActionEnd?: () => void;
  showViewControls?: boolean;
  subdivisionLevel?: number;
}) {
  const [mode, setMode] = useState<ViewMode>("svg2d");
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const [stats, setStats] = useState<RendererStats | null>(null);
  const [webglSupport, setWebglSupport] = useState<WebGLSupport | null>(null);
  const [rendererState, setRendererState] = useState<"checking" | "starting" | "ready" | "failed">("checking");
  const [rendererMessage, setRendererMessage] = useState("Checking browser graphics capability… If this message remains unchanged, the encounter shell did not hydrate.");
  const svg2d = mode === "svg2d";

  const selectCell = useCallback((cellKey: string | null) => {
    setSelectedCell(cellKey);
    onSelectedCellChange?.(cellKey);
  }, [onSelectedCellChange]);

  const rendererFailed = useCallback((message: string) => {
    setRendererState("failed");
    setRendererMessage(message);
    setMode("svg2d");
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const support = detectWebGLSupport();
      setWebglSupport(support);
      if (support.available) {
        setRendererState("starting");
        setRendererMessage(`${support.label}; loading the optional renderer and waiting for its first frame…`);
        setMode("perspective");
      } else rendererFailed(support.label);
    });
    return () => { active = false; };
  }, [rendererFailed]);

  useEffect(() => {
    if (svg2d || rendererState === "ready" || webglSupport?.available !== true) return;
    const timeout = window.setTimeout(() => rendererFailed("WebGL was detected, but the optional renderer produced no frame within 5 seconds."), 5000);
    return () => window.clearTimeout(timeout);
  }, [mode, rendererFailed, rendererState, svg2d, webglSupport]);

  function chooseMode(nextMode: ViewMode) {
    setMode(nextMode);
    setStats(null);
    if (nextMode !== "svg2d") {
      setRendererState("starting");
      setRendererMessage(`${webglSupport?.label ?? "Retrying WebGL"}; loading the optional renderer and waiting for its first frame…`);
    }
  }

  return <section className={`encounter-scene-shell${compactDiagnostics ? " compact" : ""}`}>
    {showViewControls && <div className="encounter-view-toolbar">
      <strong>Camera</strong>
      <button className="encounter-view-button" type="button" onClick={() => chooseMode("perspective")} aria-pressed={mode === "perspective"}>3D perspective</button>
      <button className="encounter-view-button" type="button" onClick={() => chooseMode("overhead")} aria-pressed={mode === "overhead"}>2D overhead</button>
      <button className="encounter-view-button" type="button" onClick={() => chooseMode("svg2d")} aria-pressed={svg2d}>2D compatibility</button>
      <button className="secondary-action compact-action" type="button" onClick={() => selectCell(null)} disabled={!selectedCell}>Clear selection</button>
      <span className="encounter-selection-status" aria-live="polite">Selected cell: <strong>{selectedCell ?? "none"}</strong></span>
    </div>}

    <div className="encounter-renderer-frame" onContextMenu={(event) => event.preventDefault()}>
      {svg2d ? <Compatibility2DView triangles={triangles} /> : <WebGLScene
        editMode={editMode}
        mode={mode}
        subdivisionLevel={subdivisionLevel}
        triangles={triangles}
        selectedCell={selectedCell}
        onSelect={selectCell}
        onFailure={rendererFailed}
        onFirstFrame={() => {
          setRendererState("ready");
          setRendererMessage("WebGL renderer is producing frames.");
        }}
        onStats={setStats}
        onSurfaceAction={onSurfaceAction}
        onSurfaceActionEnd={onSurfaceActionEnd}
      />}
    </div>
    <p className="encounter-camera-help">
      {svg2d ? "The server-rendered SVG compatibility mode presents the canonical top-down projection without WebGL."
        : mode === "perspective" ? "Drag to orbit, right-drag to pan, scroll to zoom, and click terrain to inspect its owning cell."
          : "The orthographic view uses the same geometry and material projection; right-drag pans and scroll zooms."}
    </p>
    <div className="encounter-diagnostics">
      <output className="encounter-renderer-status" aria-live="polite">Graphics: {rendererState} · {rendererMessage}</output>
      <output className="encounter-renderer-status" aria-live="polite">
        {svg2d ? "SVG compatibility · renderer metrics unavailable"
          : stats ? `${stats.webgl2 ? "WebGL 2" : "WebGL 1"} · ${stats.fps.toFixed(1)} fps · ${stats.frameMs.toFixed(2)} ms · ${stats.drawCalls} draws · ${stats.triangles} tris · DPR ${stats.dpr.toFixed(2)}`
            : "Collecting renderer metrics…"}
      </output>
    </div>
  </section>;
}
