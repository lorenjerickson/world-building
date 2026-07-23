import type { Projection2DPoint, Triangle, Vec3 } from './types';

export interface TopDownProjection {
  vertices: Projection2DPoint[];
}

function projectPoint(v: Vec3): Projection2DPoint {
  return { x: v[0], y: v[1] };
}

export function projectTrianglesTopDown(triangles: Triangle[]): TopDownProjection[] {
  return triangles.map((tri) => ({
    vertices: [projectPoint(tri.a), projectPoint(tri.b), projectPoint(tri.c)],
  }));
}
