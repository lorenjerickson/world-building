export type Vec3 = readonly [number, number, number];

export type LatticePoint = Vec3;

export type CellKey = `${number},${number},${number}`;

export type FaceName = 'north' | 'south' | 'east' | 'west' | 'top' | 'bottom';

export type ShapeKind =
  | 'cube'
  | 'rampXPos'
  | 'rampXNeg'
  | 'rampYPos'
  | 'rampYNeg'
  | 'cornerRampNE'
  | 'cornerRampNW'
  | 'cornerRampSE'
  | 'cornerRampSW';

/** Authoring/spike input. Shape presets compile to shared lattice remaps. */
export interface Cell {
  x: number;
  y: number;
  z: number;
  shape: ShapeKind;
  materials?: Partial<Record<FaceName, string>>;
}

/** Canonical occupancy does not duplicate deformation state per cell. */
export interface CanonicalCell {
  x: number;
  y: number;
  z: number;
  materials?: Partial<Record<FaceName, string>>;
}

export interface VertexRemap {
  from: LatticePoint;
  to: LatticePoint;
}

export interface EncounterMapCanonical {
  formatVersion: 'encounter-map/1';
  scaleInFeet: number;
  paletteVersion: string;
  /** Visual-only Loop subdivision passes. Occupancy and movement remain on the cubic lattice. */
  surfaceSubdivisionLevel?: number;
  bounds: {
    min: Vec3;
    max: Vec3;
  };
  occupiedCells: CanonicalCell[];
  vertexRemaps: VertexRemap[];
}

export interface EncounterMapDraftGeometry {
  formatVersion: 'encounter-map/1';
  scaleInFeet: number;
  paletteVersion: string;
  surfaceSubdivisionLevel?: number;
  bounds: EncounterMapCanonical['bounds'];
  cells: Cell[];
}

export interface EncounterMaterialDefinition {
  id: string;
  version: number;
  kind: 'solid' | 'water';
  physicalTileSizeInInches: number;
  fallbackColor: string;
}

export interface EncounterMaterialPalette {
  version: string;
  materials: readonly EncounterMaterialDefinition[];
}

export interface Triangle {
  a: Vec3;
  b: Vec3;
  c: Vec3;
  materialId: string;
  faceName: FaceName;
  cellKey: CellKey;
}

export interface MeshBuildResult {
  triangles: Triangle[];
  warnings: string[];
}

export interface MeshBuildOptions {
  occupiedKeys?: ReadonlySet<CellKey>;
  cellByKey?: ReadonlyMap<CellKey, Cell>;
  vertexRemaps?: readonly VertexRemap[];
}

export interface IndexedMeshBufferOptions {
  /** Average normals at shared positions for visually smooth derived surfaces. */
  smoothNormals?: boolean;
}

export interface ChunkMesh {
  chunkKey: string;
  chunkCoord: Vec3;
  cells: Cell[];
  mesh: MeshBuildResult;
}

export interface ChunkMeshBuildResult {
  chunkSize: number;
  chunks: ChunkMesh[];
}

export interface ChunkMeshRebuildResult {
  chunkSize: number;
  /** Includes empty invalidated chunks so renderer caches can evict stale geometry. */
  changedChunkKeys: string[];
  chunks: ChunkMesh[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export interface PickHit {
  cellKey: CellKey;
  faceName: FaceName;
  t: number;
  point: Vec3;
}

export interface Projection2DPoint {
  x: number;
  y: number;
}

export interface IndexedMeshBuffers {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  triangleCellKeys: CellKey[];
  triangleFaceNames: FaceName[];
  materialIds: string[];
  materialIndexByTriangle: Uint16Array;
}
