import { describe, expect, it } from "vitest";
import {
  HORIZONTAL_LAYOUT_ZOOM,
  calculateHorizontalDisplayGeometry,
} from "./scoreRender";

describe("calculateHorizontalDisplayGeometry", () => {
  it("scales the canonical SVG without changing the engraving zoom", () => {
    const geometry = calculateHorizontalDisplayGeometry({
      nativeWidth: 6_400,
      nativeHeight: 64,
      viewportWidth: 1_280,
      viewportHeight: 360,
      requestedUserZoom: 1,
    });

    expect(geometry).not.toBeNull();
    expect(geometry!.displayZoom).toBeGreaterThan(HORIZONTAL_LAYOUT_ZOOM);
    expect(geometry!.width / geometry!.height).toBeCloseTo(100, 5);
    expect(geometry!.height).toBeLessThanOrEqual(304);
  });

  it("caps user zoom by the available score height deterministically", () => {
    const normal = calculateHorizontalDisplayGeometry({
      nativeWidth: 2_000,
      nativeHeight: 100,
      viewportWidth: 900,
      viewportHeight: 240,
      requestedUserZoom: 1,
    })!;
    const oversized = calculateHorizontalDisplayGeometry({
      nativeWidth: 2_000,
      nativeHeight: 100,
      viewportWidth: 900,
      viewportHeight: 240,
      requestedUserZoom: 4,
    })!;

    expect(oversized.height).toBeCloseTo(normal.height, 5);
    expect(oversized.height).toBeLessThanOrEqual(196);
    expect(oversized.maxUserZoomPercent).toBeGreaterThanOrEqual(50);
  });

  it("rejects missing native or viewport dimensions", () => {
    expect(calculateHorizontalDisplayGeometry({
      nativeWidth: 0,
      nativeHeight: 100,
      viewportWidth: 900,
      viewportHeight: 300,
      requestedUserZoom: 1,
    })).toBeNull();
  });
});
