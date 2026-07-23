import type { PickHit, Triangle, Vec3 } from './types';

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function add(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + b[0] * t, a[1] + b[1] * t, a[2] + b[2] * t];
}

export function pickFirstTriangle(origin: Vec3, direction: Vec3, triangles: Triangle[]): PickHit | undefined {
  let best: PickHit | undefined;
  const eps = 1e-8;

  for (const tri of triangles) {
    const edge1 = sub(tri.b, tri.a);
    const edge2 = sub(tri.c, tri.a);
    const pvec = cross(direction, edge2);
    const det = dot(edge1, pvec);
    if (det > -eps && det < eps) continue;

    const invDet = 1 / det;
    const tvec = sub(origin, tri.a);
    const u = dot(tvec, pvec) * invDet;
    if (u < 0 || u > 1) continue;

    const qvec = cross(tvec, edge1);
    const v = dot(direction, qvec) * invDet;
    if (v < 0 || u + v > 1) continue;

    const t = dot(edge2, qvec) * invDet;
    if (t <= eps) continue;

    if (!best || t < best.t) {
      best = {
        cellKey: tri.cellKey,
        faceName: tri.faceName,
        t,
        point: add(origin, direction, t),
      };
    }
  }

  return best;
}
