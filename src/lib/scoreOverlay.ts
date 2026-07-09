import { TICKS_PER_QUARTER } from "../types";
import type { GroupLayout, Hand, NoteGroup, ScoreData } from "../types";

export interface ScoreGroupLayout extends GroupLayout {
  hand: Hand;
  measureIndex: number;
  measureX: number;
  measureRight: number;
  startTick: number;
  glyphX: number;
  glyphY: number;
  glyphWidth: number;
  glyphHeight: number;
  centerX: number;
  timeX: number;
  segmentX: number;
  segmentWidth: number;
  frameX: number;
  frameY: number;
  frameWidth: number;
  frameHeight: number;
}

export interface StaffGeometry {
  hand: Hand;
  lines: number[];
  spacing: number;
  top: number;
  bottom: number;
}

export type ScoreStaffGeometry = Record<Hand, StaffGeometry | null>;

export interface VisualFrame extends GroupLayout {
  key: string;
  className: string;
}

interface Band {
  top: number;
  height: number;
}

interface StaffBands {
  hit: Record<Hand, Band>;
  frame: Record<Hand, Band>;
}

interface StaffMetrics {
  bands: StaffBands;
  geometry: ScoreStaffGeometry;
}

interface MatchedRenderGroup {
  bounds: GroupLayout | null;
  centerX: number | null;
  centerSamples: number;
  elements: Set<Element>;
}

interface GraphicalMeasureLike {
  PositionAndShape: {
    AbsolutePosition: { x: number };
    Size: { width: number };
  };
  beginInstructionsWidth?: number;
  parentSourceMeasure?: { measureListIndex?: number };
  staffEntries?: unknown[];
}

interface OsmdLike {
  GraphicSheet: {
    MeasureList: Array<Array<GraphicalMeasureLike | null | undefined>>;
  };
}

interface RawMeasureLayout {
  x: number;
  right: number;
  begin: number;
}

interface MeasureLayout {
  x: number;
  right: number;
  contentX: number;
}

export interface TrackSegmentInput {
  groupId: string;
  startTick: number;
  anchorX: number;
  trackLeft: number;
  trackRight: number;
}

export interface TrackSegment {
  groupId: string;
  x: number;
  width: number;
}

function isGraphicalMeasure(measure: GraphicalMeasureLike | null | undefined): measure is GraphicalMeasureLike {
  return measure != null;
}

interface ScoreOverlayLayout {
  layouts: ScoreGroupLayout[];
  scoreFrame: { top: number; height: number };
  surfaceSize: { width: number; height: number };
  staffGeometry: ScoreStaffGeometry;
  svgTargets: Map<string, Element[]>;
}

export const HIT_GAP = 0;

const hands: Hand[] = ["right", "left"];
const FRAME_VERTICAL_PAD = 18;
const STAFF_FRAME_PAD = 2.1;
const BASS_FRAME_BOTTOM_PAD = 5.2;
const MIN_TRACK_SEGMENT_WIDTH = 1;

export function rectsIntersect(a: DOMRect | GroupLayout, b: GroupLayout): boolean {
  const ax1 = "left" in a ? a.left : a.x;
  const ay1 = "top" in a ? a.top : a.y;
  const ax2 = "right" in a ? a.right : a.x + a.width;
  const ay2 = "bottom" in a ? a.bottom : a.y + a.height;
  const bx1 = b.x;
  const by1 = b.y;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;

  return ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1;
}

function glyphLayout(layout: ScoreGroupLayout): GroupLayout {
  return {
    groupId: layout.groupId,
    x: layout.glyphX,
    y: layout.glyphY,
    width: layout.glyphWidth,
    height: layout.glyphHeight,
  };
}

function boxContainsPoint(box: GroupLayout, x: number, y: number): boolean {
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

function trackAnchorIntersectsBox(layout: ScoreGroupLayout, box: GroupLayout): boolean {
  return boxContainsPoint(box, layout.timeX, layout.y + layout.height * 0.5);
}

function parseSvgDimension(value: string | null): number {
  if (!value) {
    return 0;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function bandBottom(band: Band): number {
  return band.top + band.height;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function makeBand(top: number, bottom: number): Band {
  return {
    top,
    height: Math.max(24, bottom - top),
  };
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function medianCoordinate(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function clusterNumbers(values: number[], threshold: number): number[] {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  const clusters: number[][] = [];

  for (const value of sorted) {
    const last = clusters[clusters.length - 1];
    if (!last || Math.abs(value - median(last)) > threshold) {
      clusters.push([value]);
    } else {
      last.push(value);
    }
  }

  return clusters.map((cluster) => median(cluster));
}

function fractionToTicks(fraction: unknown): number | null {
  if (!fraction || typeof fraction !== "object") {
    return null;
  }

  const maybeFraction = fraction as {
    RealValue?: number;
    Numerator?: number;
    Denominator?: number;
    WholeValue?: number;
  };
  let realValue = maybeFraction.RealValue;

  if (!Number.isFinite(realValue)) {
    const numerator = maybeFraction.Numerator ?? 0;
    const denominator = maybeFraction.Denominator ?? 1;
    const wholeValue = maybeFraction.WholeValue ?? 0;
    realValue = denominator === 0 ? Number.NaN : wholeValue + numerator / denominator;
  }

  return typeof realValue === "number" && Number.isFinite(realValue)
    ? Math.round(realValue * 4 * TICKS_PER_QUARTER)
    : null;
}

function groupKey(measureIndex: number, hand: Hand, startTick: number): string {
  return `${measureIndex}:${hand}:${startTick}`;
}

function anyHandGroupKey(measureIndex: number, startTick: number): string {
  return `${measureIndex}:any:${startTick}`;
}

function tickTimeKey(measureIndex: number, startTick: number): string {
  return `${measureIndex}:${startTick}`;
}

function getNoteSvgElement(note: unknown): Element | null {
  const maybeNote = note as {
    getSVGGElement?: () => Element;
    getVFNoteSVG?: () => Element;
  };

  return maybeNote.getVFNoteSVG?.() ?? maybeNote.getSVGGElement?.() ?? null;
}

function collectEntrySvgElements(entry: unknown): Element[] {
  const maybeEntry = entry as {
    graphicalVoiceEntries?: Array<{ notes?: unknown[] }>;
  };
  const elements = new Set<Element>();

  for (const voiceEntry of maybeEntry.graphicalVoiceEntries ?? []) {
    for (const note of voiceEntry.notes ?? []) {
      const element = getNoteSvgElement(note);
      if (element) {
        elements.add(element);
      }
    }
  }

  return [...elements];
}

function staffSplitY(staffBands: StaffBands): number | null {
  const rightBottom = bandBottom(staffBands.hit.right);
  const leftTop = staffBands.hit.left.top;
  return rightBottom <= leftTop ? (rightBottom + leftTop) / 2 : null;
}

function pointBelongsToHand(centerY: number, hand: Hand, staffBands: StaffBands): boolean {
  const splitY = staffSplitY(staffBands);
  if (splitY == null) {
    return true;
  }

  return hand === "right" ? centerY < splitY : centerY >= splitY;
}

function getNoteheadSvgChildren(element: Element): Element[] {
  const children = Array.from(element.querySelectorAll(".vf-notehead path"));
  return element.matches(".vf-notehead path") ? [element, ...children] : children;
}

function getElementBounds(
  groupId: string,
  elements: Element[],
  overlayRect: DOMRect,
  hand: Hand,
  staffBands: StaffBands,
): GroupLayout | null {
  return elements.reduce<GroupLayout | null>((bounds, element) => {
    return getNoteheadSvgChildren(element).reduce<GroupLayout | null>((childBounds, child) => {
      const rect = child.getBoundingClientRect();
      if (rect.width < 1 && rect.height < 1) {
        return childBounds;
      }

      const centerY = rect.top - overlayRect.top + rect.height * 0.5;
      if (!pointBelongsToHand(centerY, hand, staffBands)) {
        return childBounds;
      }

      return mergeBounds(groupId, childBounds, {
        groupId,
        x: rect.left - overlayRect.left,
        y: rect.top - overlayRect.top,
        width: rect.width,
        height: rect.height,
      });
    }, bounds);
  }, null);
}

function mergeBounds(groupId: string, current: GroupLayout | null, next: GroupLayout | null): GroupLayout | null {
  if (!next) {
    return current;
  }

  if (!current) {
    return next;
  }

  const x = Math.min(current.x, next.x);
  const y = Math.min(current.y, next.y);
  const right = Math.max(current.x + current.width, next.x + next.width);
  const bottom = Math.max(current.y + current.height, next.y + next.height);

  return {
    groupId,
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

function getStaffLineYClusters(host: HTMLElement, overlayRect: DOMRect): number[] {
  return clusterNumbers(
    Array.from(host.querySelectorAll("svg path"))
      .map((path) => path.getBoundingClientRect())
      .filter((rect) => rect.width > 100 && rect.height <= 2)
      .map((rect) => rect.top - overlayRect.top),
    3,
  );
}

function getMeasureBarlineXClusters(host: HTMLElement, overlayRect: DOMRect): number[] {
  return clusterNumbers(
    Array.from(host.querySelectorAll("svg rect"))
      .map((rect) => rect.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.width <= 4 && rect.height > 100)
      .map((rect) => rect.left - overlayRect.left),
    3,
  );
}

function makeStaffGeometry(hand: Hand, lines: number[], fallbackSpacing = 18): StaffGeometry {
  const normalizedLines = lines.slice(0, 5);
  const spacing = median(normalizedLines.slice(1).map((line, index) => line - normalizedLines[index])) || fallbackSpacing;

  return {
    hand,
    lines: normalizedLines,
    spacing,
    top: normalizedLines[0],
    bottom: normalizedLines[4],
  };
}

function emptyStaffGeometry(): ScoreStaffGeometry {
  return { right: null, left: null };
}

function getStaffMetrics(host: HTMLElement, overlayRect: DOMRect, svgRect: DOMRect, viewportHeight: number): StaffMetrics {
  const staffLines = getStaffLineYClusters(host, overlayRect);
  const svgTop = svgRect.top - overlayRect.top;
  const svgBottom = svgRect.bottom - overlayRect.top;

  if (staffLines.length >= 10) {
    const rightLines = staffLines.slice(0, 5);
    const leftLines = staffLines.slice(-5);
    const rightSpacing = median(rightLines.slice(1).map((line, index) => line - rightLines[index])) || 18;
    const leftSpacing = median(leftLines.slice(1).map((line, index) => line - leftLines[index])) || rightSpacing;
    const split = (rightLines[4] + leftLines[0]) / 2;
    const rightGeometry = makeStaffGeometry("right", rightLines, rightSpacing);
    const leftGeometry = makeStaffGeometry("left", leftLines, leftSpacing);

    return {
      bands: {
        hit: {
          right: makeBand(Math.max(0, rightLines[0] - rightSpacing * 1.8), split),
          left: makeBand(split, Math.min(viewportHeight, leftLines[4] + leftSpacing * 1.8)),
        },
        frame: {
          right: makeBand(Math.max(0, rightLines[0] - rightSpacing * STAFF_FRAME_PAD), rightLines[4] + rightSpacing * STAFF_FRAME_PAD),
          left: makeBand(leftLines[0] - leftSpacing * STAFF_FRAME_PAD, leftLines[4] + leftSpacing * BASS_FRAME_BOTTOM_PAD),
        },
      },
      geometry: { right: rightGeometry, left: leftGeometry },
    };
  }

  if (staffLines.length >= 5) {
    const spacing = median(staffLines.slice(1).map((line, index) => line - staffLines[index])) || 18;
    const band = makeBand(Math.max(0, staffLines[0] - spacing * 2.2), Math.min(viewportHeight, staffLines[4] + spacing * 2.2));
    const rightGeometry = makeStaffGeometry("right", staffLines.slice(0, 5), spacing);
    const leftGeometry: StaffGeometry = { ...rightGeometry, hand: "left" };

    return {
      bands: {
        hit: { right: band, left: band },
        frame: { right: band, left: band },
      },
      geometry: { right: rightGeometry, left: leftGeometry },
    };
  }

  const split = svgTop + (svgBottom - svgTop) * 0.5;

  return {
    bands: {
      hit: {
        right: makeBand(Math.max(0, svgTop), split),
        left: makeBand(split, Math.min(viewportHeight, svgBottom)),
      },
      frame: {
        right: makeBand(Math.max(0, svgTop + (svgBottom - svgTop) * 0.08), svgTop + (svgBottom - svgTop) * 0.48),
        left: makeBand(svgTop + (svgBottom - svgTop) * 0.52, Math.min(viewportHeight, svgBottom * 0.98)),
      },
    },
    geometry: emptyStaffGeometry(),
  };
}

function applyHorizontalSegments(layouts: ScoreGroupLayout[]): ScoreGroupLayout[] {
  const next = layouts.map((layout) => ({ ...layout }));

  for (const hand of hands) {
    const byMeasure = new Map<number, ScoreGroupLayout[]>();
    next
      .filter((layout) => layout.hand === hand)
      .forEach((layout) => {
        byMeasure.set(layout.measureIndex, [...(byMeasure.get(layout.measureIndex) ?? []), layout]);
      });

    for (const measureLayouts of byMeasure.values()) {
      const segments = new Map(
        buildContiguousTrackSegments(
          measureLayouts.map((layout) => ({
            groupId: layout.groupId,
            startTick: layout.startTick,
            anchorX: layout.centerX,
            trackLeft: layout.measureX,
            trackRight: layout.measureRight,
          })),
        ).map((segment) => [segment.groupId, segment]),
      );

      measureLayouts.forEach((layout) => {
        const segment = segments.get(layout.groupId)!;

        layout.x = segment.x;
        layout.width = segment.width;
        layout.segmentX = segment.x;
        layout.segmentWidth = segment.width;
        layout.frameX = segment.x;
        layout.frameWidth = segment.width;
        layout.timeX = clamp(layout.centerX, segment.x, segment.x + segment.width);
      });
    }
  }

  return next;
}

export function buildContiguousTrackSegments(inputs: TrackSegmentInput[]): TrackSegment[] {
  if (inputs.length === 0) {
    return [];
  }

  const ordered = [...inputs].sort((a, b) => {
    if (a.startTick !== b.startTick) {
      return a.startTick - b.startTick;
    }

    if (a.anchorX !== b.anchorX) {
      return a.anchorX - b.anchorX;
    }

    return a.groupId.localeCompare(b.groupId);
  });
  const trackLeft = ordered[0].trackLeft;
  const trackRight = ordered[0].trackRight;
  const trackWidth = trackRight - trackLeft;
  const anchors = ordered.map((input) => clamp(input.anchorX, trackLeft, trackRight));
  const boundaries = [trackLeft];

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const midpoint = (anchors[index] + anchors[index + 1]) / 2;
    boundaries.push(clamp(midpoint, trackLeft, trackRight));
  }

  boundaries.push(trackRight);
  const minWidth = Math.min(MIN_TRACK_SEGMENT_WIDTH, trackWidth / ordered.length);

  for (let index = 1; index < boundaries.length; index += 1) {
    boundaries[index] = Math.max(boundaries[index], boundaries[index - 1] + minWidth);
  }

  boundaries[boundaries.length - 1] = trackRight;

  for (let index = boundaries.length - 2; index >= 0; index -= 1) {
    boundaries[index] = Math.min(boundaries[index], boundaries[index + 1] - minWidth);
  }

  boundaries[0] = trackLeft;

  return ordered.map((input, index) => ({
    groupId: input.groupId,
    x: boundaries[index],
    width: boundaries[index + 1] - boundaries[index],
  }));
}

export function buildMeasureLayouts(
  rawMeasureLayouts: RawMeasureLayout[],
  firstGlyphLeftByMeasure = new Map<number, number>(),
  measureBarlineXs: number[] = [],
): MeasureLayout[] {
  const sortedBarlines = [...measureBarlineXs].filter(Number.isFinite).sort((a, b) => a - b);
  let barlineIndex = 0;
  const adjustedMeasureLayouts = rawMeasureLayouts.map((measure, index) => {
    const maxDistance = Math.max(90, Math.min(220, (measure.right - measure.x) * 0.45));

    while (barlineIndex < sortedBarlines.length && sortedBarlines[barlineIndex] < measure.x - maxDistance) {
      barlineIndex += 1;
    }

    let matchedBarlineX: number | null = null;
    let matchedBarlineIndex = -1;
    for (
      let candidateIndex = barlineIndex;
      candidateIndex < sortedBarlines.length && sortedBarlines[candidateIndex] <= measure.x + maxDistance;
      candidateIndex += 1
    ) {
      const candidateX = sortedBarlines[candidateIndex];
      if (
        matchedBarlineX == null
        || Math.abs(candidateX - measure.x) < Math.abs(matchedBarlineX - measure.x)
      ) {
        matchedBarlineX = candidateX;
        matchedBarlineIndex = candidateIndex;
      }
    }

    if (matchedBarlineIndex >= 0) {
      barlineIndex = matchedBarlineIndex + 1;
    }

    const fallbackGlyphLeft = firstGlyphLeftByMeasure.get(index);
    const x = matchedBarlineX ?? Math.min(measure.x, fallbackGlyphLeft ?? measure.x);

    return {
      ...measure,
      x,
    };
  });

  return adjustedMeasureLayouts.map<MeasureLayout>((measure, index) => {
    const nextMeasureX = adjustedMeasureLayouts[index + 1]?.x;
    const right =
      nextMeasureX != null && nextMeasureX > measure.x
        ? Math.max(measure.x, Math.min(measure.right, nextMeasureX))
        : measure.right;
    const contentInset = Math.max(12, Math.min(90, measure.begin));

    return {
      x: measure.x,
      right,
      contentX: Math.min(right, Math.max(measure.x, rawMeasureLayouts[index].x + contentInset)),
    };
  });
}

export function frameFromLayouts(key: string, className: string, layouts: ScoreGroupLayout[]): VisualFrame | null {
  if (layouts.length === 0) {
    return null;
  }

  const x = Math.min(...layouts.map((layout) => layout.frameX));
  const y = Math.min(...layouts.map((layout) => layout.frameY));
  const right = Math.max(...layouts.map((layout) => layout.frameX + layout.frameWidth));
  const bottom = Math.max(...layouts.map((layout) => layout.frameY + layout.frameHeight));

  return {
    key,
    groupId: key,
    className,
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

export function getBoxSelectedGroupIds(layouts: ScoreGroupLayout[], box: GroupLayout): string[] {
  return layouts
    .filter((layout) => trackAnchorIntersectsBox(layout, box) || rectsIntersect(box, glyphLayout(layout)))
    .map((layout) => layout.groupId);
}

export function buildSelectedFrames(
  layouts: ScoreGroupLayout[],
  selectedIds: string[],
  mergeAcrossHands = false,
): VisualFrame[] {
  const selected = new Set(selectedIds);
  const frames: VisualFrame[] = [];
  const selectedLayouts = layouts.filter((layout) => selected.has(layout.groupId));

  if (mergeAcrossHands) {
    const mergedFrame = frameFromLayouts("selected-both", "selected", selectedLayouts);
    return mergedFrame ? [mergedFrame] : [];
  }

  for (const hand of hands) {
    const ordered = layouts.filter((layout) => layout.hand === hand);
    let run: ScoreGroupLayout[] = [];

    ordered.forEach((layout) => {
      if (selected.has(layout.groupId)) {
        run.push(layout);
        return;
      }

      const frame = frameFromLayouts(`selected-${hand}-${frames.length}`, "selected", run);
      if (frame) {
        frames.push(frame);
      }
      run = [];
    });

    const frame = frameFromLayouts(`selected-${hand}-${frames.length}`, "selected", run);
    if (frame) {
      frames.push(frame);
    }
  }

  return frames;
}

export function buildScoreOverlayLayout(
  host: HTMLElement,
  overlay: HTMLElement,
  svg: SVGSVGElement,
  osmd: OsmdLike,
  score: ScoreData,
  viewportHeight: number,
): ScoreOverlayLayout {
  const rect = svg.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  const overlayRect = overlay.getBoundingClientRect();
  const offsetLeft = rect.left - overlayRect.left;
  const viewBoxWidth = svg.viewBox?.baseVal?.width || parseSvgDimension(svg.getAttribute("width"));
  const rawMeasures = osmd.GraphicSheet.MeasureList.map((measureList) => measureList[0]).filter(isGraphicalMeasure);
  const rawRight = rawMeasures.reduce((max, measure) => {
    const shape = measure.PositionAndShape;
    return Math.max(max, shape.AbsolutePosition.x + shape.Size.width);
  }, 0);
  const unitToCss = rawRight > 0 ? rect.width / rawRight : viewBoxWidth > 0 ? rect.width / viewBoxWidth : 10;

  const rawMeasureLayouts = rawMeasures.map<RawMeasureLayout>((measure) => {
    const shape = measure.PositionAndShape;
    const x = offsetLeft + shape.AbsolutePosition.x * unitToCss;
    const width = Math.max(40, shape.Size.width * unitToCss);
    const begin = Math.max(0, (measure.beginInstructionsWidth ?? 0) * unitToCss);
    return { x, right: x + width, begin };
  });
  const staffMetrics = getStaffMetrics(host, overlayRect, rect, viewportHeight);
  const staffBands = staffMetrics.bands;

  const exactGroups = new Map<string, NoteGroup>();
  const groupsByAnyHand = new Map<string, NoteGroup[]>();
  for (const group of score.noteGroups) {
    exactGroups.set(groupKey(group.measureIndex, group.hand, group.startTick), group);
    const anyKey = anyHandGroupKey(group.measureIndex, group.startTick);
    groupsByAnyHand.set(anyKey, [...(groupsByAnyHand.get(anyKey) ?? []), group]);
  }

  const matchedGroups = new Map<string, MatchedRenderGroup>();
  const tickTimeSamples = new Map<string, number[]>();
  const svgTargets = new Map<string, Element[]>();

  osmd.GraphicSheet.MeasureList.forEach((measureList, fallbackMeasureIndex) => {
    measureList.forEach((measure, staffIndex) => {
      if (!measure) {
        return;
      }

      const hand: Hand = staffIndex === 1 ? "left" : "right";
      const measureIndex = measure.parentSourceMeasure?.measureListIndex ?? fallbackMeasureIndex;

      for (const entry of measure.staffEntries ?? []) {
        const maybeEntry = entry as {
          hasOnlyRests?: () => boolean;
          relInMeasureTimestamp?: unknown;
          sourceStaffEntry?: { Timestamp?: unknown };
          getAbsoluteStartAndEnd?: () => [number, number];
        };
        if (maybeEntry.hasOnlyRests?.()) {
          continue;
        }

        const startTick = fractionToTicks(maybeEntry.relInMeasureTimestamp ?? maybeEntry.sourceStaffEntry?.Timestamp);
        if (startTick == null) {
          continue;
        }

        const exactGroup = exactGroups.get(groupKey(measureIndex, hand, startTick));
        const anyHandGroups = groupsByAnyHand.get(anyHandGroupKey(measureIndex, startTick)) ?? [];
        const group =
          exactGroup ??
          (anyHandGroups.length === 1 ? anyHandGroups[0] : anyHandGroups.find((candidate) => candidate.hand === hand));
        if (!group) {
          continue;
        }

        const elements = collectEntrySvgElements(entry);
        const bounds = getElementBounds(group.id, elements, overlayRect, hand, staffBands);
        const absolute = maybeEntry.getAbsoluteStartAndEnd?.();
        const centerX = absolute ? offsetLeft + ((absolute[0] + absolute[1]) / 2) * unitToCss : null;
        const fallbackCenterX = bounds ? bounds.x + bounds.width * 0.5 : null;
        const timeSampleX = centerX ?? fallbackCenterX;
        const previous = matchedGroups.get(group.id) ?? {
          bounds: null,
          centerX: null,
          centerSamples: 0,
          elements: new Set<Element>(),
        };

        for (const element of elements) {
          previous.elements.add(element);
        }
        previous.bounds = mergeBounds(group.id, previous.bounds, bounds);
        if (centerX != null && Number.isFinite(centerX)) {
          previous.centerX =
            previous.centerX == null
              ? centerX
              : (previous.centerX * previous.centerSamples + centerX) / (previous.centerSamples + 1);
          previous.centerSamples += 1;
        }

        if (timeSampleX != null && Number.isFinite(timeSampleX)) {
          const key = tickTimeKey(measureIndex, startTick);
          tickTimeSamples.set(key, [...(tickTimeSamples.get(key) ?? []), timeSampleX]);
        }

        matchedGroups.set(group.id, previous);
        svgTargets.set(group.id, [...previous.elements]);
      }
    });
  });

  const timeXByTick = new Map(
    Array.from(tickTimeSamples.entries()).map(([key, samples]) => [key, medianCoordinate(samples)]),
  );
  const firstTickByMeasure = new Map<number, number>();
  for (const group of score.noteGroups) {
    firstTickByMeasure.set(
      group.measureIndex,
      Math.min(firstTickByMeasure.get(group.measureIndex) ?? group.startTick, group.startTick),
    );
  }

  const firstGlyphLeftByMeasure = new Map<number, number>();
  for (const group of score.noteGroups) {
    if (group.startTick !== firstTickByMeasure.get(group.measureIndex)) {
      continue;
    }

    const bounds = matchedGroups.get(group.id)?.bounds;
    if (!bounds) {
      continue;
    }

    firstGlyphLeftByMeasure.set(
      group.measureIndex,
      Math.min(firstGlyphLeftByMeasure.get(group.measureIndex) ?? bounds.x, bounds.x),
    );
  }

  const measureBarlineXs = getMeasureBarlineXClusters(host, overlayRect);
  const measureLayouts = buildMeasureLayouts(rawMeasureLayouts, firstGlyphLeftByMeasure, measureBarlineXs);

  const baseLayouts = score.noteGroups.map<ScoreGroupLayout>((group) => {
    const measure = measureLayouts[group.measureIndex];
    const measureDuration = score.measureDurations[group.measureIndex] || 1;
    const fallbackWidth = Math.max(2200, score.noteGroups.length * 54);
    const fallbackX = 120 + (group.absoluteTick / Math.max(1, score.totalTicks)) * fallbackWidth;
    const measureX = measure?.x ?? fallbackX;
    const measureRight = measure?.right ?? measureX + 80;
    const contentX = measure?.contentX ?? measureX + 12;
    const usableWidth = Math.max(30, measureRight - contentX - 10);
    const ratio = Math.max(0, Math.min(1, group.startTick / measureDuration));
    const matched = matchedGroups.get(group.id);
    const fallbackTimeX = contentX + ratio * usableWidth;
    const timeX = clamp(timeXByTick.get(tickTimeKey(group.measureIndex, group.startTick)) ?? fallbackTimeX, measureX, measureRight);
    const rawCenterX =
      matched?.bounds != null
        ? matched.bounds.x + matched.bounds.width * 0.5
        : matched?.centerX ?? timeX;
    const centerX = clamp(rawCenterX, measureX, measureRight);
    const hitBand = staffBands.hit[group.hand];
    const groupBounds = matched?.bounds;
    const glyphX = groupBounds?.x ?? centerX - 1;
    const glyphY = groupBounds?.y ?? hitBand.top;
    const glyphWidth = groupBounds?.width ?? 2;
    const glyphHeight = groupBounds?.height ?? hitBand.height;
    const baseFrameBand = staffBands.frame[group.hand];
    const baseFrameTop = Math.min(baseFrameBand.top, hitBand.top);
    const baseFrameBottom = Math.max(bandBottom(baseFrameBand), bandBottom(hitBand));
    const groupFrameBottom = groupBounds ? groupBounds.y + groupBounds.height + FRAME_VERTICAL_PAD : baseFrameBottom;
    const frameTop = Math.max(0, baseFrameTop);
    const frameBottom = Math.max(baseFrameBottom, groupFrameBottom);

    return {
      groupId: group.id,
      hand: group.hand,
      measureIndex: group.measureIndex,
      measureX,
      measureRight,
      startTick: group.startTick,
      glyphX,
      glyphY,
      glyphWidth,
      glyphHeight,
      centerX,
      timeX,
      x: centerX - 24,
      y: hitBand.top,
      width: 48,
      height: hitBand.height,
      segmentX: centerX - 24,
      segmentWidth: 48,
      frameX: centerX - 24,
      frameY: frameTop,
      frameWidth: 48,
      frameHeight: Math.max(56, frameBottom - frameTop),
    };
  });

  const layouts = applyHorizontalSegments(baseLayouts);
  const frameTop = Math.min(...hands.map((hand) => staffBands.frame[hand].top));
  const frameBottom = Math.max(...hands.map((hand) => bandBottom(staffBands.frame[hand])));

  return {
    layouts,
    scoreFrame: {
      top: Math.max(8, frameTop),
      height: Math.max(180, frameBottom - frameTop),
    },
    surfaceSize: {
      width: Math.max(hostRect.width, rect.width + offsetLeft + 60, ...layouts.map((layout) => layout.x + layout.width + 120)),
      height: Math.max(
        viewportHeight,
        rect.bottom - overlayRect.top + 20,
        frameBottom + 24,
        ...layouts.map((layout) => layout.y + layout.height + 20),
      ),
    },
    staffGeometry: staffMetrics.geometry,
    svgTargets,
  };
}
