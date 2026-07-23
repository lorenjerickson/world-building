"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildCanonicalMesh,
  checksumCanonicalMap,
  type EncounterMapCanonical,
  type FaceName,
  type Vec3,
} from "@world-building/common";
import { SpikeScene } from "@/app/encounters/spike/spike-scene";
import type { EncounterEditMode, EncounterSurfaceAction, EncounterSurfaceHit } from "@/app/encounters/spike/webgl-scene";

type Draft = { id: number; mapId: number; version: number; checksum: string; canonical: EncounterMapCanonical; validation: { status: string; errors: string[] }; updatedAt: string };
type History = { past: EncounterMapCanonical[]; present: EncounterMapCanonical; future: EncounterMapCanonical[] };
const FACES: FaceName[] = ["top", "bottom", "north", "south", "east", "west"];
const MATERIALS = ["dirt", "grass", "water", "stone", "wood", "road"] as const;
const TEXTURE_STORAGE_KEY = "encounter-authoring-active-texture";
const clone = (value: EncounterMapCanonical) => structuredClone(value);
const pointKey = (point: readonly number[]) => point.join(",");

function materialFaces(material: string): Partial<Record<FaceName, string>> {
  return Object.fromEntries(FACES.map((face) => [face, material]));
}

function starterTerrain(canonical: EncounterMapCanonical, material: string): EncounterMapCanonical {
  const next = clone(canonical);
  const width = Math.min(10, next.bounds.max[0] - next.bounds.min[0]);
  const depth = Math.min(10, next.bounds.max[1] - next.bounds.min[1]);
  const startX = next.bounds.min[0] + Math.floor((next.bounds.max[0] - next.bounds.min[0] - width) / 2);
  const startY = next.bounds.min[1] + Math.floor((next.bounds.max[1] - next.bounds.min[1] - depth) / 2);
  const z = next.bounds.min[2];
  next.occupiedCells = Array.from({ length: width * depth }, (_, index) => ({
    x: startX + index % width,
    y: startY + Math.floor(index / width),
    z,
    materials: materialFaces(material),
  }));
  return next;
}

function adjacentCell(hit: EncounterSurfaceHit) {
  const [x, y, z] = hit.cellKey.split(",").map(Number);
  if (hit.faceName === "north") return { x, y: y! + 1, z };
  if (hit.faceName === "south") return { x, y: y! - 1, z };
  if (hit.faceName === "east") return { x: x! + 1, y, z };
  if (hit.faceName === "west") return { x: x! - 1, y, z };
  if (hit.faceName === "top") return { x, y, z: z! + 1 };
  return { x, y, z: z! - 1 };
}

function withinBounds(canonical: EncounterMapCanonical, cell: { x: number; y: number; z: number }) {
  return cell.x >= canonical.bounds.min[0] && cell.x < canonical.bounds.max[0]
    && cell.y >= canonical.bounds.min[1] && cell.y < canonical.bounds.max[1]
    && cell.z >= canonical.bounds.min[2] && cell.z < canonical.bounds.max[2];
}

export function EncounterAuthoringEditor({ encId, mapId, draftId }: { encId: string; mapId: string; draftId: string }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [editMode, setEditMode] = useState<EncounterEditMode>("place");
  const [texture, setTexture] = useState<string>("dirt");
  const [message, setMessage] = useState("Loading draft…");
  const [busy, setBusy] = useState(false);
  const dragPlaneZ = useRef<number | null>(null);
  const endpoint = `/api/encounters/${encodeURIComponent(encId)}/maps/${mapId}/drafts/${draftId}`;

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const remembered = window.localStorage.getItem(TEXTURE_STORAGE_KEY);
        const activeTexture = remembered && MATERIALS.includes(remembered as typeof MATERIALS[number]) ? remembered : "dirt";
        setTexture(activeTexture);
        const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        const body = await response.json() as Draft & { message?: string };
        if (!response.ok) { setMessage(body.message ?? "Draft load failed."); return; }
        if (body.canonical.occupiedCells.length > 0 || body.version > 1) {
          setDraft(body);
          setHistory({ past: [], present: body.canonical, future: [] });
          setMessage("Draft loaded.");
          return;
        }

        const canonical = starterTerrain(body.canonical, activeTexture);
        setDraft(body);
        setHistory({ past: [], present: canonical, future: [] });
        setMessage("Creating the starter 10 × 10 terrain…");
        const initialized = await fetch(endpoint, {
          body: JSON.stringify({ canonical, commandId: `initialize-${draftId}-${activeTexture}`, expectedVersion: body.version }),
          headers: { "content-type": "application/json" },
          method: "PUT",
          signal: controller.signal,
        });
        const initializedBody = await initialized.json() as Draft & { message?: string };
        if (!initialized.ok) { setMessage(initializedBody.message ?? "Starter terrain is ready locally but could not be saved."); return; }
        setDraft(initializedBody);
        setHistory({ past: [], present: initializedBody.canonical, future: [] });
        setMessage("Starter terrain ready.");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setMessage("The encounter draft could not be loaded.");
      }
    }
    void load();
    return () => controller.abort();
  }, [draftId, endpoint]);

  const mesh = useMemo(() => {
    if (!history) return { triangles: [], error: "" };
    try { return { triangles: buildCanonicalMesh(history.present).triangles, error: "" }; }
    catch (error) { return { triangles: [], error: error instanceof Error ? error.message : "Geometry is invalid." }; }
  }, [history]);

  function mutate(change: (canonical: EncounterMapCanonical) => boolean) {
    setHistory((current) => {
      if (!current) return current;
      const next = clone(current.present);
      if (!change(next)) return current;
      try {
        buildCanonicalMesh(next);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "That edit would create invalid geometry.";
        queueMicrotask(() => setMessage(`Edit not applied: ${reason}`));
        return current;
      }
      return { past: [...current.past, current.present], present: next, future: [] };
    });
  }

  function place(hit: EncounterSurfaceHit, action: EncounterSurfaceAction) {
    const target = adjacentCell(hit);
    if (action === "primary") dragPlaneZ.current = target.z;
    if (action === "drag" && dragPlaneZ.current !== target.z) return;
    mutate((canonical) => {
      if (!withinBounds(canonical, target)) return false;
      if (canonical.occupiedCells.some((cell) => cell.x === target.x && cell.y === target.y && cell.z === target.z)) return false;
      canonical.occupiedCells.push({ ...target, materials: materialFaces(texture) });
      return true;
    });
  }

  function remove(hit: EncounterSurfaceHit) {
    const [x, y, z] = hit.cellKey.split(",").map(Number);
    mutate((canonical) => {
      const nextCells = canonical.occupiedCells.filter((cell) => cell.x !== x || cell.y !== y || cell.z !== z);
      if (nextCells.length === canonical.occupiedCells.length) return false;
      canonical.occupiedCells = nextCells;
      const remainingSources = new Set(nextCells.flatMap((cell) => [
        [cell.x, cell.y, cell.z + 1],
        [cell.x + 1, cell.y, cell.z + 1],
        [cell.x, cell.y + 1, cell.z + 1],
        [cell.x + 1, cell.y + 1, cell.z + 1],
      ]).map(pointKey));
      canonical.vertexRemaps = canonical.vertexRemaps.filter((remap) => remainingSources.has(pointKey(remap.from)));
      return true;
    });
  }

  function toggleVertex(vertex: Vec3) {
    mutate((canonical) => {
      const key = pointKey(vertex);
      const existing = canonical.vertexRemaps.findIndex((remap) => pointKey(remap.from) === key);
      if (existing >= 0) canonical.vertexRemaps.splice(existing, 1);
      else canonical.vertexRemaps.push({ from: vertex, to: [vertex[0], vertex[1], vertex[2] - 1] });
      return true;
    });
  }

  function paint(hit: EncounterSurfaceHit) {
    const [x, y, z] = hit.cellKey.split(",").map(Number);
    mutate((canonical) => {
      const cell = canonical.occupiedCells.find((item) => item.x === x && item.y === y && item.z === z);
      if (!cell || cell.materials?.[hit.faceName] === texture) return false;
      cell.materials = { ...cell.materials, [hit.faceName]: texture };
      return true;
    });
  }

  function interact(hit: EncounterSurfaceHit, action: EncounterSurfaceAction) {
    if (editMode === "place" && action === "remove") { remove(hit); return; }
    if (action === "remove") return;
    if (editMode === "place") place(hit, action);
    else if (editMode === "shape" && action === "primary") toggleVertex(hit.vertex);
    else if (editMode === "texture" && action === "primary") paint(hit);
  }

  function chooseTexture(value: string) {
    setTexture(value);
    window.localStorage.setItem(TEXTURE_STORAGE_KEY, value);
  }

  function chooseSubdivisionLevel(value: number) {
    mutate((canonical) => {
      if ((canonical.surfaceSubdivisionLevel ?? 0) === value) return false;
      canonical.surfaceSubdivisionLevel = value;
      return true;
    });
    setMessage(value === 0
      ? "Cubic surface selected. The movement grid is unchanged."
      : `Subdivision level ${value} selected. Smoothing is visual only; the movement grid is unchanged.`);
  }

  function undo() {
    setHistory((current) => current?.past.length ? { past: current.past.slice(0, -1), present: current.past.at(-1)!, future: [current.present, ...current.future] } : current);
  }

  function redo() {
    setHistory((current) => current?.future.length ? { past: [...current.past, current.present], present: current.future[0]!, future: current.future.slice(1) } : current);
  }

  async function command(path: string, body?: unknown, method = "POST") {
    setBusy(true);
    setMessage("Working…");
    try {
      const response = await fetch(`${endpoint}${path}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      const result = await response.json();
      if (!response.ok) { setMessage(result.message ?? "Operation failed."); return null; }
      return result;
    } catch {
      setMessage("The encounter map service could not be reached.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft || !history) return null;
    const result = await command("", { canonical: history.present, commandId: crypto.randomUUID(), expectedVersion: draft.version }, "PUT");
    if (result) {
      setDraft(result);
      setHistory({ past: [], present: result.canonical, future: [] });
      setMessage(`Saved version ${result.version}.`);
    }
    return result as Draft | null;
  }

  async function validate() {
    if (!draft || !history) return;
    let savedDraft = draft;
    if (history.past.length > 0) {
      const saved = await save();
      if (!saved) return;
      savedDraft = saved;
    }
    const result = await command("/validate");
    if (result) {
      setDraft({ ...savedDraft, ...result });
      setMessage(result.validation.status === "valid" ? "Validation passed." : result.validation.errors.join(" "));
    }
  }

  async function release() {
    if (!draft) return;
    const result = await command("/finalize", { commandId: crypto.randomUUID(), expectedVersion: draft.version });
    if (result) setMessage(`Released immutable revision ${result.revisionNumber}.`);
  }

  function exportDebug() {
    if (!history) return;
    const envelope = { exportedAt: new Date().toISOString(), checksum: checksumCanonicalMap(history.present), canonical: history.present, validation: draft?.validation };
    const url = URL.createObjectURL(new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `encounter-map-${mapId}-draft-${draftId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!history || !draft) return <main className="dashboard-container encounter-authoring-container"><section className="card-surface encounter-authoring-loading"><span className="eyebrow">Encounter authoring</span><p role="status">{message}</p></section></main>;
  const dirty = history.past.length > 0;
  const checksum = checksumCanonicalMap(history.present).slice(0, 12);

  return <main className="encounter-authoring-page">
    <header className="encounter-map-header">
      <div><span className="eyebrow">Encounter map</span><h1>{`Map ${mapId}`}</h1><p>Version {draft.version} · {history.present.occupiedCells.length} cubes · {checksum}{dirty ? " · unsaved changes" : ""}</p></div>
      <Link href="/dashboard" className="secondary-action compact-action">Exit authoring</Link>
    </header>

    <section className="card-surface encounter-authoring-map">
      <div className="encounter-map-command-bar">
        <strong className="encounter-command-label">Map controls</strong>
        <div className="encounter-edit-mode" aria-label="Editing mode">
          <span>Mode</span>
          {(["place", "shape", "texture"] as const).map((mode) => <button key={mode} type="button" aria-pressed={editMode === mode} onClick={() => setEditMode(mode)}>{mode}</button>)}
        </div>
        <label className="encounter-texture-select"><span>Current</span><select value={texture} onChange={(event) => chooseTexture(event.target.value)}>{MATERIALS.map((value) => <option key={value} value={value}>{value[0]!.toUpperCase() + value.slice(1)}</option>)}</select></label>
        <label className="encounter-texture-select"><span>Surface</span><select aria-label="Surface subdivision level" value={history.present.surfaceSubdivisionLevel ?? 0} onChange={(event) => chooseSubdivisionLevel(Number(event.target.value))}>
          <option value={0}>Cubic · level 0</option>
          <option value={1}>Soft · level 1</option>
          <option value={2}>Smooth · level 2</option>
          <option value={3}>Fine · level 3</option>
        </select></label>
        <span className="encounter-camera-hint">Middle-drag to rotate · Wheel to zoom</span>
        <div className="encounter-history-actions"><button type="button" className="secondary-action compact-action" onClick={undo} disabled={!history.past.length}>Undo</button><button type="button" className="secondary-action compact-action" onClick={redo} disabled={!history.future.length}>Redo</button></div>
        <div className="encounter-release-actions">
          <button type="button" className="secondary-action compact-action" onClick={validate} disabled={busy || !!mesh.error}>Validate</button>
          <button type="button" className="secondary-action compact-action" onClick={save} disabled={busy || !dirty || !!mesh.error}>Save</button>
          <button type="button" className="primary-action compact-action" onClick={release} disabled={busy || dirty || draft.validation.status !== "valid"}>Release</button>
          <button type="button" className="encounter-export-link" onClick={exportDebug}>Export map data</button>
        </div>
      </div>

      <SpikeScene compactDiagnostics editMode={editMode} showViewControls={false} subdivisionLevel={history.present.surfaceSubdivisionLevel ?? 0} triangles={mesh.triangles} onSurfaceAction={interact} onSurfaceActionEnd={() => { dragPlaneZ.current = null; }} />
      <div className="encounter-editor-footer">
        <p><strong>{editMode}</strong> · {editMode === "place" ? "Click or touch a face to add a cube. Drag across top faces to paint a plane; right-click removes a cube." : editMode === "shape" ? "Select a highlighted corner to raise or lower that shared vertex." : "Select a highlighted face to apply the current texture."} Middle-drag rotates; scroll or pinch zooms.</p>
        <p className={mesh.error ? "error" : undefined} role="status">{mesh.error || message}</p>
      </div>
    </section>
  </main>;
}
