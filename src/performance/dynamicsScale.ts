import type { PerformanceGroupVisualization } from "./referenceVisualization";

export type DynamicsScaleMode = "global" | "local";

export interface DynamicsViewport {
  left: number;
  width: number;
}

export interface DynamicsDisplayScale {
  mode: DynamicsScaleMode;
  low: number;
  high: number;
  onsetCount: number;
}

interface WeightedIntensity {
  value: number;
  weight: number;
}

const GLOBAL_DYNAMICS_SCALE: DynamicsDisplayScale = {
  mode: "global",
  low: 0,
  high: 1,
  onsetCount: 0,
};
const VIEWPORT_GUARD_RATIO = 0.5;
const MINIMUM_LOCAL_ONSETS = 12;
const MINIMUM_LOCAL_SPAN = 0.18;
const LOCAL_DISPLAY_LOW = 0.08;
const LOCAL_DISPLAY_HIGH = 0.92;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function weightedQuantile(values: WeightedIntensity[], ratio: number): number | undefined {
  if (values.length === 0) return undefined;
  const ordered = [...values].sort((left, right) => left.value - right.value);
  const totalWeight = ordered.reduce((sum, sample) => sum + sample.weight, 0);
  if (totalWeight <= 0) return undefined;
  const target = totalWeight * clamp(ratio, 0, 1);
  let accumulated = 0;
  for (const sample of ordered) {
    accumulated += sample.weight;
    if (accumulated >= target) return sample.value;
  }
  return ordered.at(-1)?.value;
}

function expandSpan(low: number, high: number): { low: number; high: number } {
  if (high - low >= MINIMUM_LOCAL_SPAN) return { low, high };
  const middle = (low + high) / 2;
  let expandedLow = middle - MINIMUM_LOCAL_SPAN / 2;
  let expandedHigh = middle + MINIMUM_LOCAL_SPAN / 2;
  if (expandedLow < 0) {
    expandedHigh -= expandedLow;
    expandedLow = 0;
  }
  if (expandedHigh > 1) {
    expandedLow -= expandedHigh - 1;
    expandedHigh = 1;
  }
  return {
    low: clamp(expandedLow, 0, 1),
    high: clamp(expandedHigh, 0, 1),
  };
}

function contextWeight(x: number, viewport: DynamicsViewport): number {
  const width = Math.max(1, viewport.width);
  const guard = width * VIEWPORT_GUARD_RATIO;
  const visibleRight = viewport.left + width;
  if (x >= viewport.left && x <= visibleRight) return 1;
  if (x < viewport.left) return clamp((x - (viewport.left - guard)) / guard, 0, 1);
  return clamp(((visibleRight + guard) - x) / guard, 0, 1);
}

export function buildDynamicsDisplayScale(
  samples: PerformanceGroupVisualization[],
  xByGroup: Map<string, number>,
  viewport: DynamicsViewport,
  mode: DynamicsScaleMode,
): DynamicsDisplayScale {
  if (mode === "global" || viewport.width <= 0) return GLOBAL_DYNAMICS_SCALE;

  const byTick = new Map<number, Array<{ value: number; weight: number }>>();
  for (const sample of samples) {
    const x = xByGroup.get(sample.groupId);
    if (x == null || sample.intensity == null) continue;
    const weight = contextWeight(x, viewport);
    if (weight <= 0) continue;
    const atTick = byTick.get(sample.tick) ?? [];
    atTick.push({ value: clamp(sample.intensity, 0, 1), weight });
    byTick.set(sample.tick, atTick);
  }

  if (byTick.size < MINIMUM_LOCAL_ONSETS) return GLOBAL_DYNAMICS_SCALE;

  const weighted: WeightedIntensity[] = [];
  for (const atTick of byTick.values()) {
    const tickWeight = Math.max(...atTick.map((sample) => sample.weight));
    const sampleWeight = tickWeight / atTick.length;
    atTick.forEach((sample) => weighted.push({ value: sample.value, weight: sampleWeight }));
  }

  const tailRatio = byTick.size < 40 ? 0.1 : 0.05;
  const low = weightedQuantile(weighted, tailRatio);
  const high = weightedQuantile(weighted, 1 - tailRatio);
  if (low == null || high == null || high <= low) return GLOBAL_DYNAMICS_SCALE;
  const expanded = expandSpan(low, high);
  return {
    mode: "local",
    low: expanded.low,
    high: expanded.high,
    onsetCount: byTick.size,
  };
}

export function scaleDynamicsIntensity(intensity: number, scale: DynamicsDisplayScale): number {
  const value = clamp(intensity, 0, 1);
  if (scale.mode === "global" || scale.high <= scale.low) return value;
  if (value < scale.low) {
    return scale.low <= 0 ? LOCAL_DISPLAY_LOW : LOCAL_DISPLAY_LOW * (value / scale.low);
  }
  if (value > scale.high) {
    if (scale.high >= 1) return LOCAL_DISPLAY_HIGH;
    return LOCAL_DISPLAY_HIGH
      + (1 - LOCAL_DISPLAY_HIGH) * ((value - scale.high) / (1 - scale.high));
  }
  return LOCAL_DISPLAY_LOW
    + ((value - scale.low) / (scale.high - scale.low)) * (LOCAL_DISPLAY_HIGH - LOCAL_DISPLAY_LOW);
}
