export const MIN_SCORE_ZOOM = 70;
export const MAX_SCORE_ZOOM = 150;
export const SCORE_ZOOM_STEP = 5;

export function clampScoreZoom(zoom: number, maxZoom = MAX_SCORE_ZOOM): number {
  const boundedMax = Math.max(MIN_SCORE_ZOOM, Math.min(MAX_SCORE_ZOOM, maxZoom));
  const rounded = Math.round(zoom / SCORE_ZOOM_STEP) * SCORE_ZOOM_STEP;
  return Math.max(MIN_SCORE_ZOOM, Math.min(boundedMax, rounded));
}

export function floorScoreZoomToStep(zoom: number): number {
  return Math.floor(zoom / SCORE_ZOOM_STEP) * SCORE_ZOOM_STEP;
}
