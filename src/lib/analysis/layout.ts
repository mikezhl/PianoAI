import type { ScoreRange } from "../../analysis/types";
import type { ScoreData } from "../../types";
import { isZeroOffset } from "./coordinates";

export interface AnalysisMeasureLayout {
  measureIndex: number;
  systemIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  leftStaffY?: number;
  leftStaffHeight?: number;
  leftStaffAnchors?: AnalysisTimeAnchor[];
}

export interface AnalysisTimeAnchor {
  offsetQuarter: number;
  x: number;
}

export interface AnalysisRangeSegment {
  key: string;
  systemIndex: number;
  startMeasureIndex: number;
  endMeasureIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AnalysisPlaybackCursor {
  systemIndex: number;
  x: number;
  y: number;
  height: number;
}

function rationalValue(value: ScoreRange["start"]["offsetQuarter"]): number {
  return value.denominator > 0 ? value.numerator / value.denominator : 0;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 1;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function normalizeMeasureLayoutsBySystem(
  measureLayouts: AnalysisMeasureLayout[],
): AnalysisMeasureLayout[] {
  const systemBounds = new Map<number, { top: number; bottom: number; leftTop: number; leftBottom: number }>();

  for (const layout of measureLayouts) {
    const current = systemBounds.get(layout.systemIndex) ?? {
      top: layout.y,
      bottom: layout.y + layout.height,
      leftTop: layout.leftStaffY ?? layout.y + layout.height * 0.5,
      leftBottom: (layout.leftStaffY ?? layout.y + layout.height * 0.5) + (layout.leftStaffHeight ?? layout.height * 0.5),
    };
    current.top = Math.min(current.top, layout.y);
    current.bottom = Math.max(current.bottom, layout.y + layout.height);
    current.leftTop = Math.min(current.leftTop, layout.leftStaffY ?? current.leftTop);
    current.leftBottom = Math.max(
      current.leftBottom,
      (layout.leftStaffY ?? current.leftTop) + (layout.leftStaffHeight ?? current.leftBottom - current.leftTop),
    );
    systemBounds.set(layout.systemIndex, current);
  }

  const uniformHeight = median(Array.from(systemBounds.values(), (bounds) => bounds.bottom - bounds.top));
  const uniformLeftHeight = median(Array.from(systemBounds.values(), (bounds) => bounds.leftBottom - bounds.leftTop));

  return measureLayouts.map((layout) => {
    const bounds = systemBounds.get(layout.systemIndex);
    if (!bounds) {
      return layout;
    }
    const center = (bounds.top + bounds.bottom) / 2;
    const leftCenter = (bounds.leftTop + bounds.leftBottom) / 2;
    return {
      ...layout,
      y: center - uniformHeight / 2,
      height: Math.max(1, uniformHeight),
      leftStaffY: leftCenter - uniformLeftHeight / 2,
      leftStaffHeight: Math.max(1, uniformLeftHeight),
    };
  });
}

export function playbackCursorAtTick(
  score: ScoreData,
  measureLayouts: AnalysisMeasureLayout[],
  tick: number,
): AnalysisPlaybackCursor | null {
  let measureIndex = 0;
  for (let index = score.measureStarts.length - 1; index >= 0; index -= 1) {
    if (tick >= (score.measureStarts[index] ?? 0)) {
      measureIndex = index;
      break;
    }
  }
  const layout = measureLayouts.find((candidate) => candidate.measureIndex === measureIndex);
  if (!layout) {
    return null;
  }
  const measureStart = score.measureStarts[measureIndex] ?? tick;
  const measureDuration = Math.max(1, score.measureDurations[measureIndex] ?? 1);
  const offsetQuarter = (tick - measureStart) / 480;
  const durationQuarter = measureDuration / 480;
  return {
    systemIndex: layout.systemIndex,
    x: anchoredTimeX(layout, offsetQuarter, durationQuarter),
    y: layout.y,
    height: layout.height,
  };
}

function anchoredTimeX(
  layout: AnalysisMeasureLayout,
  offsetQuarter: number,
  durationQuarter: number,
): number {
  const anchors = layout.leftStaffAnchors;
  if (!anchors || anchors.length === 0) {
    return linearPositionX(layout, offsetQuarter, durationQuarter);
  }
  if (offsetQuarter <= anchors[0].offsetQuarter) {
    const first = anchors[0];
    if (first.offsetQuarter <= 0) {
      return first.x;
    }
    const progress = Math.max(0, offsetQuarter / first.offsetQuarter);
    return layout.x + (first.x - layout.x) * progress;
  }
  for (let index = 1; index < anchors.length; index += 1) {
    const previous = anchors[index - 1];
    const current = anchors[index];
    if (offsetQuarter <= current.offsetQuarter) {
      const span = current.offsetQuarter - previous.offsetQuarter;
      const progress = span > 0 ? (offsetQuarter - previous.offsetQuarter) / span : 0;
      return previous.x + (current.x - previous.x) * progress;
    }
  }
  const last = anchors[anchors.length - 1];
  if (durationQuarter <= last.offsetQuarter) {
    return last.x;
  }
  const progress = Math.min(1, (offsetQuarter - last.offsetQuarter) / (durationQuarter - last.offsetQuarter));
  return last.x + (layout.x + layout.width - last.x) * progress;
}

function positionFraction(
  range: ScoreRange,
  measureIndex: number,
  edge: "start" | "end",
  durationQuartersByMeasure: number[],
): number {
  const position = edge === "start" ? range.start : range.end;
  if (position.measureIndex !== measureIndex) {
    return edge === "start" ? 0 : 1;
  }

  const duration = durationQuartersByMeasure[measureIndex] ?? 0;
  if (duration <= 0) {
    return edge === "start" ? 0 : 1;
  }

  return Math.max(0, Math.min(1, rationalValue(position.offsetQuarter) / duration));
}

function linearPositionX(
  layout: AnalysisMeasureLayout,
  offsetQuarter: number,
  durationQuarter: number,
): number {
  if (durationQuarter <= 0) {
    return layout.x;
  }
  const fraction = Math.max(0, Math.min(1, offsetQuarter / durationQuarter));
  return layout.x + layout.width * fraction;
}

function anchoredBoundaryX(
  layout: AnalysisMeasureLayout,
  offsetQuarter: number,
  durationQuarter: number,
): number {
  const anchors = layout.leftStaffAnchors;
  if (!anchors || anchors.length === 0) {
    return linearPositionX(layout, offsetQuarter, durationQuarter);
  }

  const right = layout.x + layout.width;
  if (offsetQuarter <= anchors[0].offsetQuarter) {
    const first = anchors[0];
    const next = anchors[1];
    const firstBoundary = Math.max(layout.x, next ? first.x - (next.x - first.x) / 2 : first.x);
    if (first.offsetQuarter <= 0) {
      return firstBoundary;
    }
    const progress = Math.max(0, offsetQuarter / first.offsetQuarter);
    return layout.x + (firstBoundary - layout.x) * progress;
  }

  for (let index = 1; index < anchors.length; index += 1) {
    const previous = anchors[index - 1];
    const current = anchors[index];
    if (Math.abs(offsetQuarter - current.offsetQuarter) < 1e-6) {
      return (previous.x + current.x) / 2;
    }
    if (offsetQuarter < current.offsetQuarter) {
      const progress = (offsetQuarter - previous.offsetQuarter) / (current.offsetQuarter - previous.offsetQuarter);
      return previous.x + (current.x - previous.x) * progress;
    }
  }

  const last = anchors[anchors.length - 1];
  const previous = anchors[anchors.length - 2];
  const lastBoundary = Math.min(right, previous ? last.x + (last.x - previous.x) / 2 : last.x);
  if (durationQuarter <= last.offsetQuarter) {
    return lastBoundary;
  }
  const progress = Math.max(0, Math.min(1, (offsetQuarter - last.offsetQuarter) / (durationQuarter - last.offsetQuarter)));
  return lastBoundary + (right - lastBoundary) * progress;
}

function positionX(
  range: ScoreRange,
  measureIndex: number,
  edge: "start" | "end",
  layout: AnalysisMeasureLayout,
  durationQuartersByMeasure: number[],
  horizontalMode: "measure" | "left-staff",
): number {
  const position = edge === "start" ? range.start : range.end;
  const durationQuarter = durationQuartersByMeasure[measureIndex] ?? 0;
  if (position.measureIndex !== measureIndex) {
    if (
      horizontalMode === "left-staff"
      && edge === "end"
      && position.measureIndex === measureIndex + 1
      && isZeroOffset(position)
    ) {
      return anchoredBoundaryX(layout, durationQuarter, durationQuarter);
    }
    return edge === "start" ? layout.x : layout.x + layout.width;
  }

  const offsetQuarter = rationalValue(position.offsetQuarter);
  return horizontalMode === "left-staff"
    ? anchoredBoundaryX(layout, offsetQuarter, durationQuarter)
    : linearPositionX(layout, offsetQuarter, durationQuarter);
}

export function splitRangeBySystems(
  range: ScoreRange,
  measureLayouts: AnalysisMeasureLayout[],
  durationQuartersByMeasure: number[] = [],
  horizontalMode: "measure" | "left-staff" = "measure",
): AnalysisRangeSegment[] {
  const layoutByMeasure = new Map(measureLayouts.map((layout) => [layout.measureIndex, layout]));
  const lastMeasureIndex = isZeroOffset(range.end)
    ? range.end.measureIndex - 1
    : range.end.measureIndex;
  const segments: AnalysisRangeSegment[] = [];
  let current: AnalysisRangeSegment | null = null;

  for (let measureIndex = range.start.measureIndex; measureIndex <= lastMeasureIndex; measureIndex += 1) {
    const layout = layoutByMeasure.get(measureIndex);
    if (!layout) {
      continue;
    }

    const x = horizontalMode === "measure"
      ? layout.x + layout.width * positionFraction(range, measureIndex, "start", durationQuartersByMeasure)
      : positionX(range, measureIndex, "start", layout, durationQuartersByMeasure, horizontalMode);
    const right = horizontalMode === "measure"
      ? layout.x + layout.width * positionFraction(range, measureIndex, "end", durationQuartersByMeasure)
      : positionX(range, measureIndex, "end", layout, durationQuartersByMeasure, horizontalMode);
    const top = layout.y;
    const bottom = layout.y + layout.height;

    if (current && current.systemIndex === layout.systemIndex) {
      current.endMeasureIndex = measureIndex;
      current.x = Math.min(current.x, x);
      current.y = Math.min(current.y, top);
      current.width = Math.max(current.x + current.width, right) - current.x;
      current.height = Math.max(current.y + current.height, bottom) - current.y;
      continue;
    }

    current = {
      key: `${range.start.measureIndex}-${range.end.measureIndex}-${layout.systemIndex}`,
      systemIndex: layout.systemIndex,
      startMeasureIndex: measureIndex,
      endMeasureIndex: measureIndex,
      x,
      y: top,
      width: Math.max(1, right - x),
      height: Math.max(1, bottom - top),
    };
    segments.push(current);
  }

  return segments;
}
