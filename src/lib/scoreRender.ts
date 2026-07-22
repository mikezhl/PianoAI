import { MAX_SCORE_ZOOM, MIN_SCORE_ZOOM } from "./scoreZoom";

export const HORIZONTAL_LAYOUT_ZOOM = 0.2;
export const HORIZONTAL_SVG_WIDTH_BUDGET = 65_535;
export const HORIZONTAL_RENDER_BATCH_MEASURES = 24;
export const ANALYSIS_RENDER_BATCH_SYSTEMS = 2;
export const ANALYSIS_RENDER_YIELD_MS = 100;

interface HorizontalDisplayGeometryInput {
  nativeWidth: number;
  nativeHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  requestedUserZoom: number;
  layoutZoom?: number;
}

export interface HorizontalDisplayGeometry {
  width: number;
  height: number;
  displayZoom: number;
  maxUserZoomPercent: number;
}

function baseZoomForHeight(viewportHeight: number): number {
  if (viewportHeight < 260) {
    return 0.78;
  }
  if (viewportHeight < 340) {
    return 0.9;
  }
  return 1.05;
}

export function calculateHorizontalDisplayGeometry({
  nativeWidth,
  nativeHeight,
  viewportWidth,
  viewportHeight,
  requestedUserZoom,
  layoutZoom = HORIZONTAL_LAYOUT_ZOOM,
}: HorizontalDisplayGeometryInput): HorizontalDisplayGeometry | null {
  if (
    nativeWidth <= 0
    || nativeHeight <= 0
    || viewportWidth <= 0
    || viewportHeight <= 0
    || layoutZoom <= 0
  ) {
    return null;
  }

  const unscaledWidth = nativeWidth / layoutZoom;
  const unscaledHeight = nativeHeight / layoutZoom;
  const verticalSafeArea = viewportHeight < 260 ? 22 : 28;
  const maxScoreHeight = Math.max(150, viewportHeight - verticalSafeArea * 2);
  const heightFitZoom = maxScoreHeight / unscaledHeight;
  const maximumDisplayZoom = 2.3 * 1.5;
  const desiredWidth = viewportWidth * (viewportHeight < 260 ? 0.52 : 0.68);
  let baseZoom = baseZoomForHeight(viewportHeight);

  if (unscaledHeight * baseZoom > maxScoreHeight) {
    baseZoom = heightFitZoom;
  } else if (unscaledHeight * baseZoom < maxScoreHeight - 2 && unscaledWidth * baseZoom < desiredWidth) {
    baseZoom = Math.min(2.3, desiredWidth / unscaledWidth, heightFitZoom);
  }

  const maxUserZoom = Math.min(
    MAX_SCORE_ZOOM / 100,
    maximumDisplayZoom / baseZoom,
    heightFitZoom / baseZoom,
  );
  const normalizedUserZoom = Math.max(
    MIN_SCORE_ZOOM / 100,
    Math.min(maxUserZoom, requestedUserZoom),
  );
  const displayZoom = Math.min(maximumDisplayZoom, baseZoom * normalizedUserZoom, heightFitZoom);
  const displayScale = displayZoom / layoutZoom;

  return {
    width: nativeWidth * displayScale,
    height: nativeHeight * displayScale,
    displayZoom,
    maxUserZoomPercent: Math.max(
      MIN_SCORE_ZOOM,
      Math.min(MAX_SCORE_ZOOM, maxUserZoom * 100),
    ),
  };
}
