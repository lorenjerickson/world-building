export interface MapPoint {
  x: number;
  y: number;
}

export interface MapSize {
  height: number;
  width: number;
}

export interface MapRect extends MapSize {
  left: number;
  top: number;
}

export interface MapViewportTransform {
  height: number;
  panX: number;
  panY: number;
  width: number;
  zoom: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function clampMapZoom(value: number): number {
  return clamp(value, 1, 16);
}

export function getContainedMapRect(viewport: MapSize, map: MapSize): MapRect {
  if (viewport.width <= 0 || viewport.height <= 0 || map.width <= 0 || map.height <= 0) {
    return { height: viewport.height, left: 0, top: 0, width: viewport.width };
  }
  const scale = Math.min(viewport.width / map.width, viewport.height / map.height);
  const width = map.width * scale;
  const height = map.height * scale;
  return {
    height,
    left: (viewport.width - width) / 2,
    top: (viewport.height - height) / 2,
    width,
  };
}

export function mapPercentToViewportPoint(point: MapPoint, mapRect: MapRect): MapPoint {
  return {
    x: mapRect.left + clamp(point.x, 0, 100) / 100 * mapRect.width,
    y: mapRect.top + clamp(point.y, 0, 100) / 100 * mapRect.height,
  };
}

export function screenPointToMapPercent(
  point: MapPoint,
  viewport: MapViewportTransform,
  mapSize: MapSize = viewport,
): MapPoint {
  if (viewport.width <= 0 || viewport.height <= 0) return { x: 50, y: 50 };
  const zoom = clampMapZoom(viewport.zoom);
  const mapX = (point.x - viewport.width / 2 - viewport.panX) / zoom + viewport.width / 2;
  const mapY = (point.y - viewport.height / 2 - viewport.panY) / zoom + viewport.height / 2;
  const mapRect = getContainedMapRect(viewport, mapSize);
  return {
    x: Math.round(clamp((mapX - mapRect.left) / mapRect.width * 100, 0, 100) * 100) / 100,
    y: Math.round(clamp((mapY - mapRect.top) / mapRect.height * 100, 0, 100) * 100) / 100,
  };
}
