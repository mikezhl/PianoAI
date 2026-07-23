import { describe, expect, it } from "vitest";
import type { PerformanceGroupVisualization } from "./referenceVisualization";
import { buildDynamicsDisplayScale, scaleDynamicsIntensity } from "./dynamicsScale";

function sample(
  index: number,
  intensity: number,
  hand: "right" | "left" = "right",
): PerformanceGroupVisualization {
  return {
    groupId: `${hand}-${index}`,
    tick: index * 120,
    measureIndex: Math.floor(index / 4),
    hand,
    intensity,
    durationRatio: 1,
    confidence: 0.9,
  };
}

function positions(samples: PerformanceGroupVisualization[]): Map<string, number> {
  return new Map(samples.map((item, index) => [item.groupId, index * 20]));
}

describe("dynamics display scale", () => {
  it("amplifies a narrow local range without changing its ordering", () => {
    const samples = Array.from({ length: 24 }, (_, index) => sample(index, 0.4 + index * 0.005));
    const scale = buildDynamicsDisplayScale(samples, positions(samples), { left: 0, width: 300 }, "local");
    const globalDifference = samples.at(-1)!.intensity! - samples[0].intensity!;
    const localDifference = scaleDynamicsIntensity(samples.at(-1)!.intensity!, scale)
      - scaleDynamicsIntensity(samples[0].intensity!, scale);

    expect(scale.mode).toBe("local");
    expect(localDifference).toBeGreaterThan(globalDifference * 2);
    expect(scaleDynamicsIntensity(0.46, scale)).toBeGreaterThan(scaleDynamicsIntensity(0.44, scale));
  });

  it("uses one shared mapping for both hands at the same score positions", () => {
    const samples = Array.from({ length: 16 }, (_, index) => [
      sample(index, 0.35 + index * 0.01, "left"),
      sample(index, 0.55 + index * 0.01, "right"),
    ]).flat();
    const xByGroup = new Map(samples.map((item) => [item.groupId, item.tick / 6]));
    const scale = buildDynamicsDisplayScale(samples, xByGroup, { left: 0, width: 320 }, "local");

    expect(scale.mode).toBe("local");
    expect(scale.onsetCount).toBe(16);
    expect(scaleDynamicsIntensity(0.55, scale)).toBeGreaterThan(scaleDynamicsIntensity(0.35, scale));
    expect(scaleDynamicsIntensity(0.55, scale) - scaleDynamicsIntensity(0.35, scale)).toBeGreaterThan(0.2);
  });

  it("ignores newly rendered samples outside the viewport guard area", () => {
    const local = Array.from({ length: 20 }, (_, index) => sample(index, 0.3 + index * 0.01));
    const localPositions = positions(local);
    const initial = buildDynamicsDisplayScale(local, localPositions, { left: 0, width: 240 }, "local");
    const remote = Array.from({ length: 20 }, (_, index) => sample(index + 100, 0.95));
    const expandedPositions = new Map([
      ...localPositions,
      ...remote.map((item, index) => [item.groupId, 2_000 + index * 20] as const),
    ]);
    const afterIncrementalRender = buildDynamicsDisplayScale(
      [...local, ...remote],
      expandedPositions,
      { left: 0, width: 240 },
      "local",
    );

    expect(afterIncrementalRender.low).toBe(initial.low);
    expect(afterIncrementalRender.high).toBe(initial.high);
  });

  it("falls back to the global scale when the local view is too sparse", () => {
    const samples = Array.from({ length: 6 }, (_, index) => sample(index, index / 5));
    const scale = buildDynamicsDisplayScale(samples, positions(samples), { left: 0, width: 300 }, "local");

    expect(scale.mode).toBe("global");
    expect(scaleDynamicsIntensity(0.37, scale)).toBe(0.37);
  });

  it("compresses rather than clips intensities outside the robust local range", () => {
    const samples = Array.from({ length: 20 }, (_, index) => sample(index, 0.3 + index * 0.02));
    const scale = buildDynamicsDisplayScale(samples, positions(samples), { left: 0, width: 300 }, "local");

    expect(scaleDynamicsIntensity(0.01, scale)).toBeLessThan(scaleDynamicsIntensity(0.1, scale));
    expect(scaleDynamicsIntensity(0.9, scale)).toBeLessThan(scaleDynamicsIntensity(0.99, scale));
  });
});
