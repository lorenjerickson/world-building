import { pointKey } from './canonical';
import type { MeshBuildResult, Triangle, Vec3 } from './types';

const MAX_SUBDIVISION_LEVEL = 3;

interface Edge {
  a: Vec3;
  b: Vec3;
  opposites: Vec3[];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(point: Vec3, factor: number): Vec3 {
  return [point[0] * factor, point[1] * factor, point[2] * factor];
}

function edgeKey(a: Vec3, b: Vec3): string {
  const left = pointKey(a);
  const right = pointKey(b);
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function subdivideOnce(triangles: readonly Triangle[]): Triangle[] {
  const vertices = new Map<string, Vec3>();
  const neighbors = new Map<string, Map<string, Vec3>>();
  const boundaryNeighbors = new Map<string, Map<string, Vec3>>();
  const edges = new Map<string, Edge>();

  const connect = (a: Vec3, b: Vec3) => {
    const aKey = pointKey(a);
    const bKey = pointKey(b);
    vertices.set(aKey, a);
    vertices.set(bKey, b);
    const adjacent = neighbors.get(aKey) ?? new Map<string, Vec3>();
    adjacent.set(bKey, b);
    neighbors.set(aKey, adjacent);
  };

  const recordEdge = (a: Vec3, b: Vec3, opposite: Vec3) => {
    connect(a, b);
    connect(b, a);
    const key = edgeKey(a, b);
    const edge = edges.get(key) ?? { a, b, opposites: [] };
    edge.opposites.push(opposite);
    edges.set(key, edge);
  };

  for (const triangle of triangles) {
    recordEdge(triangle.a, triangle.b, triangle.c);
    recordEdge(triangle.b, triangle.c, triangle.a);
    recordEdge(triangle.c, triangle.a, triangle.b);
  }

  for (const edge of edges.values()) {
    if (edge.opposites.length !== 1) continue;
    for (const [from, to] of [[edge.a, edge.b], [edge.b, edge.a]] as const) {
      const adjacent = boundaryNeighbors.get(pointKey(from)) ?? new Map<string, Vec3>();
      adjacent.set(pointKey(to), to);
      boundaryNeighbors.set(pointKey(from), adjacent);
    }
  }

  const movedVertices = new Map<string, Vec3>();
  for (const [key, vertex] of vertices) {
    const boundary = [...(boundaryNeighbors.get(key)?.values() ?? [])];
    if (boundary.length >= 2) {
      movedVertices.set(key, add(scale(vertex, 0.75), scale(add(boundary[0]!, boundary[1]!), 0.125)));
      continue;
    }
    const adjacent = [...(neighbors.get(key)?.values() ?? [])];
    if (adjacent.length === 0) {
      movedVertices.set(key, vertex);
      continue;
    }
    const beta = adjacent.length === 3 ? 3 / 16 : 3 / (8 * adjacent.length);
    const neighborSum = adjacent.reduce<Vec3>((sum, neighbor) => add(sum, neighbor), [0, 0, 0]);
    movedVertices.set(key, add(scale(vertex, 1 - adjacent.length * beta), scale(neighborSum, beta)));
  }

  const edgeVertices = new Map<string, Vec3>();
  for (const [key, edge] of edges) {
    const point = edge.opposites.length === 2
      ? add(scale(add(edge.a, edge.b), 3 / 8), scale(add(edge.opposites[0]!, edge.opposites[1]!), 1 / 8))
      : scale(add(edge.a, edge.b), 0.5);
    edgeVertices.set(key, point);
  }

  const result: Triangle[] = [];
  for (const triangle of triangles) {
    const a = movedVertices.get(pointKey(triangle.a))!;
    const b = movedVertices.get(pointKey(triangle.b))!;
    const c = movedVertices.get(pointKey(triangle.c))!;
    const ab = edgeVertices.get(edgeKey(triangle.a, triangle.b))!;
    const bc = edgeVertices.get(edgeKey(triangle.b, triangle.c))!;
    const ca = edgeVertices.get(edgeKey(triangle.c, triangle.a))!;
    const metadata = {
      materialId: triangle.materialId,
      faceName: triangle.faceName,
      cellKey: triangle.cellKey,
    };
    result.push(
      { a, b: ab, c: ca, ...metadata },
      { a: b, b: bc, c: ab, ...metadata },
      { a: c, b: ca, c: bc, ...metadata },
      { a: ab, b: bc, c: ca, ...metadata },
    );
  }
  return result;
}

/**
 * Builds a visual-only Loop-subdivided surface. Triangle ownership metadata is
 * inherited from each source face; logical occupancy and lattice coordinates
 * are deliberately not changed.
 */
export function subdivideMesh(mesh: MeshBuildResult, level: number): MeshBuildResult {
  if (!Number.isInteger(level) || level < 0 || level > MAX_SUBDIVISION_LEVEL) {
    throw new Error(`Subdivision level must be an integer from 0 to ${MAX_SUBDIVISION_LEVEL}. Received: ${level}`);
  }
  let triangles = mesh.triangles;
  for (let pass = 0; pass < level; pass += 1) triangles = subdivideOnce(triangles);
  return {
    triangles,
    warnings: [...mesh.warnings],
  };
}
