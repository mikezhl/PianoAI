import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AnalysisSection } from "../../analysis/types";
import { scorePositionToTick } from "../../lib/scoreIdentity";
import type { ScoreGroupLayout, ScoreStaffGeometry } from "../../lib/scoreOverlay";
import type {
  PerformanceGroupVisualization,
  ReferencePerformanceVisualization,
} from "../../performance/referenceVisualization";
import {
  buildDynamicsDisplayScale,
  scaleDynamicsIntensity,
  type DynamicsDisplayScale,
  type DynamicsScaleMode,
  type DynamicsViewport,
} from "../../performance/dynamicsScale";
import type {
  ReferenceAnalysisCapabilities,
  TempoSample,
} from "../../performance/types";
import type { ScoreData } from "../../types";

export interface PerformanceScoreOverlayConfig {
  capabilities: ReferenceAnalysisCapabilities;
  dynamicsScaleMode: DynamicsScaleMode;
  tempo: TempoSample[];
  sections: AnalysisSection[];
  visualization: ReferencePerformanceVisualization | null;
}

interface PerformanceScoreOverlayProps extends PerformanceScoreOverlayConfig {
  score: ScoreData;
  layouts: ScoreGroupLayout[];
  staffGeometry: ScoreStaffGeometry;
  scoreFrame: { top: number; height: number };
  surfaceWidth: number;
  surfaceHeight: number;
}

interface OverlayBand {
  top: number;
  bottom: number;
  middle: number;
}

interface OverlayGeometry {
  overview: {
    tempo: OverlayBand;
    rightExpression: OverlayBand;
    leftExpression: OverlayBand;
    pedal: OverlayBand;
  };
}

interface OverlayHoverTarget {
  x: number;
  y: number;
  width: number;
  height: number;
  tick: number;
  label: string;
  tooltipTop: number;
}

interface TouchLaneSession {
  pointerId: number;
  startPointerX: number;
  startScrollLeft: number;
  moved: boolean;
}

const TOUCH_PAN_THRESHOLD = 12;

function layoutOffsetWithinAncestor(element: HTMLElement, ancestor: HTMLElement): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let current: HTMLElement | null = element;

  while (current && current !== ancestor) {
    x += current.offsetLeft;
    y += current.offsetTop;
    current = current.offsetParent as HTMLElement | null;
  }

  return { x, y };
}

function logicalPointerX(element: HTMLElement, clientX: number, clientY: number): number {
  const appShell = element.closest<HTMLElement>(".app-shell");
  if (appShell?.dataset.layoutMode === "rotated-long-edge") {
    const transform = window.getComputedStyle(appShell).transform;
    if (transform && transform !== "none") {
      return new DOMPoint(clientX, clientY).matrixTransform(new DOMMatrixReadOnly(transform).inverse()).x;
    }
  }

  return clientX;
}

function laneContentX(element: HTMLElement, clientX: number, clientY: number): number {
  const appShell = element.closest<HTMLElement>(".app-shell");
  const scroll = element.closest<HTMLElement>(".score-scroll");
  if (appShell?.dataset.layoutMode === "rotated-long-edge") {
    const transform = window.getComputedStyle(appShell).transform;
    if (transform && transform !== "none") {
      const appPoint = new DOMPoint(clientX, clientY).matrixTransform(new DOMMatrixReadOnly(transform).inverse());
      const offset = layoutOffsetWithinAncestor(element, appShell);
      return appPoint.x - offset.x + (scroll?.scrollLeft ?? 0);
    }
  }

  return clientX - element.getBoundingClientRect().left;
}

interface TickRange {
  startTick: number;
  endTick: number;
}

interface OverlayRenderWindow {
  left: number;
  right: number;
}

interface OverlayHoverLane {
  y: number;
  height: number;
  targets: OverlayHoverTarget[];
}

function circlePath(x: number, y: number, radius: number): string {
  return `M ${x - radius} ${y} a ${radius} ${radius} 0 1 0 ${radius * 2} 0 a ${radius} ${radius} 0 1 0 ${-radius * 2} 0 Z`;
}

function rectPath(x: number, y: number, width: number, height: number): string {
  return `M ${x} ${y} h ${width} v ${height} h ${-width} Z`;
}

function buildHoverLanes(targets: OverlayHoverTarget[]): OverlayHoverLane[] {
  const lanes: OverlayHoverLane[] = [];
  for (const target of targets) {
    let lane = lanes.find((candidate) => candidate.y === target.y && candidate.height === target.height);
    if (!lane) {
      lane = { y: target.y, height: target.height, targets: [] };
      lanes.push(lane);
    }
    lane.targets.push(target);
  }
  lanes.forEach((lane) => lane.targets.sort((left, right) => left.x - right.x));
  return lanes;
}

function hoverTargetAtX(targets: OverlayHoverTarget[], x: number): OverlayHoverTarget | null {
  let low = 0;
  let high = targets.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (targets[middle].x < x) low = middle + 1;
    else high = middle;
  }
  return [targets[low - 1], targets[low], targets[low + 1]]
    .filter((target): target is OverlayHoverTarget => target != null && Math.abs(target.x - x) <= target.width / 2)
    .sort((left, right) => Math.abs(left.x - x) - Math.abs(right.x - x))[0] ?? null;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2
    : ordered[middle] ?? 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function formatTempoDelta(value: number): string {
  const delta = value - 1;
  if (Math.abs(delta) < 0.005) return "0%";
  return `${delta > 0 ? "+" : ""}${(delta * 100).toFixed(0)}%`;
}

function formatQuarterBpm(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

export function formatMeasureLabel(score: ScoreData, measureIndex: number): string {
  const displayNumber = score.measureNumbers?.[measureIndex];
  if (!displayNumber) return `第 ${measureIndex + 1} 小节`;
  if (displayNumber === "0") return "弱起";
  const matchingIndices = (score.measureNumbers ?? []).reduce<number[]>((matches, number, index) => {
    if (number === displayNumber) matches.push(index);
    return matches;
  }, []);
  if (matchingIndices.length <= 1) return `第 ${displayNumber} 小节`;
  const occurrence = matchingIndices.indexOf(measureIndex) + 1;
  return `第 ${displayNumber} 小节（同号第 ${occurrence} 段）`;
}

function pickupTickRanges(score: ScoreData, sections: AnalysisSection[]): TickRange[] {
  return sections
    .filter((section) => section.kind === "pickup")
    .map((section) => ({
      startTick: scorePositionToTick(score, section.range.start),
      endTick: scorePositionToTick(score, section.range.end),
    }));
}

function tickInRanges(tick: number, ranges: TickRange[]): boolean {
  return ranges.some((range) => tick >= range.startTick && tick < range.endTick);
}

function buildTickMapper(score: ScoreData, layouts: ScoreGroupLayout[], surfaceWidth: number) {
  const groupById = new Map(score.noteGroups.map((group) => [group.id, group]));
  const xByTick = new Map<number, number[]>();
  for (const layout of layouts) {
    const group = groupById.get(layout.groupId);
    if (!group) continue;
    xByTick.set(group.absoluteTick, [...(xByTick.get(group.absoluteTick) ?? []), layout.timeX]);
  }
  const points = [...xByTick]
    .map(([tick, xs]) => ({ tick, x: median(xs) }))
    .sort((left, right) => left.tick - right.tick);
  if (points.length === 0) return () => 0;
  const first = points[0];
  const last = points.at(-1)!;
  const anchors = [
    { tick: 0, x: Math.max(16, first.x - 18) },
    ...points,
    { tick: score.totalTicks, x: Math.max(last.x + 18, surfaceWidth - 24) },
  ].sort((left, right) => left.tick - right.tick || left.x - right.x);

  return (tick: number) => {
    const clampedTick = clamp(tick, 0, score.totalTicks);
    let rightIndex = anchors.findIndex((anchor) => anchor.tick >= clampedTick);
    if (rightIndex < 0) rightIndex = anchors.length - 1;
    const right = anchors[rightIndex];
    const left = anchors[Math.max(0, rightIndex - 1)];
    if (!left || !right || left.tick === right.tick) return right?.x ?? left?.x ?? 0;
    const ratio = (clampedTick - left.tick) / (right.tick - left.tick);
    return left.x + ratio * (right.x - left.x);
  };
}

function buildOverlayGeometry(
  staffGeometry: ScoreStaffGeometry,
  scoreFrame: { top: number; height: number },
  surfaceHeight: number,
): OverlayGeometry {
  const upperNotationTop = staffGeometry.right?.notationTop
    ?? staffGeometry.right?.top
    ?? scoreFrame.top + scoreFrame.height * 0.2;
  const lowerNotationBottom = staffGeometry.left?.notationBottom
    ?? staffGeometry.left?.bottom
    ?? staffGeometry.right?.notationBottom
    ?? staffGeometry.right?.bottom
    ?? scoreFrame.top + scoreFrame.height;
  const edgePadding = 4;
  const upperIdeal = {
    scoreGap: 12,
    expressionHeight: 44,
    trackGap: 8,
    tempoHeight: 48,
  };
  const upperIdealHeight = Object.values(upperIdeal).reduce((sum, value) => sum + value, 0);
  const upperScale = Math.min(1, Math.max(0, upperNotationTop - edgePadding) / upperIdealHeight);

  const lowerIdeal = {
    scoreGap: 12,
    expressionHeight: 44,
    trackGap: 5,
    pedalHeight: 27,
  };
  const lowerIdealHeight = Object.values(lowerIdeal).reduce((sum, value) => sum + value, 0);
  const lowerAvailableHeight = Math.max(0, surfaceHeight - edgePadding - lowerNotationBottom);
  const lowerScale = Math.min(1, lowerAvailableHeight / lowerIdealHeight);
  const expressionScale = Math.min(upperScale, lowerScale);
  const rightExpressionBottom = upperNotationTop - upperIdeal.scoreGap * upperScale;
  const rightExpressionTop = rightExpressionBottom - upperIdeal.expressionHeight * expressionScale;
  const tempoBottom = rightExpressionTop - upperIdeal.trackGap * upperScale;
  const tempoTop = tempoBottom - upperIdeal.tempoHeight * upperScale;
  const leftExpressionTop = lowerNotationBottom + lowerIdeal.scoreGap * lowerScale;
  const leftExpressionBottom = leftExpressionTop + lowerIdeal.expressionHeight * expressionScale;
  const pedalTop = leftExpressionBottom + lowerIdeal.trackGap * lowerScale;
  const pedalBottom = pedalTop + lowerIdeal.pedalHeight * lowerScale;
  const band = (top: number, bottom: number): OverlayBand => ({
    top,
    bottom,
    middle: (top + bottom) / 2,
  });
  return {
    overview: {
      tempo: band(tempoTop, tempoBottom),
      rightExpression: band(rightExpressionTop, rightExpressionBottom),
      leftExpression: band(leftExpressionTop, leftExpressionBottom),
      pedal: band(pedalTop, pedalBottom),
    },
  };
}

function TempoOverlay({
  score,
  tempo,
  band: displayBand,
  xAtTick,
  hiddenRanges,
}: {
  score: ScoreData;
  tempo: TempoSample[];
  band: OverlayBand;
  xAtTick: (tick: number) => number;
  hiddenRanges: TickRange[];
}) {
  const points = tempo.flatMap((sample, index) => {
    if (sample.normalizedTempoRatio == null || sample.tempoMode === "free-time") return [];
    const tick = scorePositionToTick(score, sample.scorePosition);
    if (tickInRanges(tick, hiddenRanges)) return [];
    const nextTick = tempo[index + 1]
      ? scorePositionToTick(score, tempo[index + 1].scorePosition)
      : score.totalTicks;
    return [{
      x: xAtTick(tick),
      endX: xAtTick(Math.max(tick, nextTick)),
      value: sample.normalizedTempoRatio,
      measure: formatMeasureLabel(score, sample.scorePosition.measureIndex),
      tick,
    }];
  });
  const maximumAbsoluteDelta = Math.max(
    0.01,
    ...points.map((point) => Math.abs(point.value - 1)),
  );
  const visualDelta = (value: number) => {
    const delta = value - 1;
    return Math.sign(delta) * Math.cbrt(Math.abs(delta) / maximumAbsoluteDelta);
  };
  const y = (value: number) => displayBand.middle
    - visualDelta(value)
      * (displayBand.middle - displayBand.top);
  const freeTimeRects = tempo.flatMap((sample, index) => {
    if (sample.tempoMode !== "free-time") return [];
    const tick = scorePositionToTick(score, sample.scorePosition);
    if (tickInRanges(tick, hiddenRanges)) return [];
    const x = xAtTick(tick);
    const next = tempo[index + 1];
    const right = next ? xAtTick(scorePositionToTick(score, next.scorePosition)) : xAtTick(score.totalTicks);
    return [rectPath(x, displayBand.top, Math.max(16, right - x), displayBand.bottom - displayBand.top)];
  });
  const changes = new Map<string, Array<{ path: string; height: number }>>();
  for (const point of points) {
    const centerX = (point.x + point.endX) / 2;
    const width = clamp((point.endX - point.x) * 0.18, 8, 24);
    const pointY = y(point.value);
    const delta = point.value - 1;
    const visibleHeight = Math.max(Math.abs(delta) < 0.005 ? 2 : 5, Math.abs(pointY - displayBand.middle));
    const barY = delta >= 0 ? displayBand.middle - visibleHeight : displayBand.middle;
    const changeClass = Math.abs(delta) < 0.005 ? "steady" : delta > 0 ? "faster" : "slower";
    const marks = changes.get(changeClass) ?? [];
    marks.push({
      path: rectPath(centerX - width / 2, barY, width, visibleHeight),
      height: visibleHeight,
    });
    changes.set(changeClass, marks);
  }
  return (
    <>
      <line
        x1="0"
        y1={displayBand.middle}
        x2="100%"
        y2={displayBand.middle}
        className="performance-overlay-baseline tempo-relative-baseline"
      />
      {freeTimeRects.length > 0 ? (
        <path d={freeTimeRects.join(" ")} className="tempo-free-time" data-mark-count={freeTimeRects.length} />
      ) : null}
      {[...changes].map(([changeClass, marks]) => (
        <path
          key={changeClass}
          d={marks.map((mark) => mark.path).join(" ")}
          className={`tempo-change ${changeClass}`}
          data-mark-count={marks.length}
          data-max-height={Math.max(...marks.map((mark) => mark.height))}
        />
      ))}
    </>
  );
}

function DynamicsOverlay({
  samples,
  xByGroup,
  bands,
  scale,
  renderWindow,
}: {
  samples: PerformanceGroupVisualization[];
  xByGroup: Map<string, number>;
  bands: { right: OverlayBand; left: OverlayBand };
  scale: DynamicsDisplayScale;
  renderWindow: OverlayRenderWindow | null;
}) {
  const groupedMarks = new Map<string, Array<{
    x: number;
    centerY: number;
    halfLength: number;
    radius: number;
  }>>();

  for (const sample of samples) {
    const x = xByGroup.get(sample.groupId);
    if (x == null || sample.intensity == null) continue;
    if (renderWindow && (x < renderWindow.left || x > renderWindow.right)) continue;
    const hand = sample.hand;
    const displayBand = bands[hand];
    const bandTop = displayBand.top;
    const bandBottom = displayBand.bottom;
    const centerY = displayBand.middle;
    const scaled = scaleDynamicsIntensity(sample.intensity, scale);
    const maximumHalfLength = (bandBottom - bandTop) / 2 - 5;
    const level = scaled < 0.3 ? "soft" : scaled > 0.72 ? "strong" : "medium";
    const key = `${hand}-${level}`;
    const marks = groupedMarks.get(key) ?? [];
    marks.push({
      x,
      centerY,
      halfLength: 6 + scaled * (maximumHalfLength - 6),
      radius: 4 + scaled * 3,
    });
    groupedMarks.set(key, marks);
  }

  return [...groupedMarks].map(([key, marks]) => {
    const [hand, level] = key.split("-");
    const centerY = marks[0].centerY;
    const lineTop = Math.min(...marks.map((mark) => mark.centerY - mark.halfLength));
    const lineBottom = Math.max(...marks.map((mark) => mark.centerY + mark.halfLength));
    return (
      <g
        key={key}
        className={`dynamics-mark ${hand} ${level}`}
        data-center-y={centerY}
        data-line-top={lineTop}
        data-line-bottom={lineBottom}
        data-mark-count={marks.length}
      >
        <path
          className="dynamics-lines"
          d={marks.map((mark) => `M ${mark.x} ${mark.centerY - mark.halfLength} V ${mark.centerY + mark.halfLength}`).join(" ")}
        />
        <path
          className="dynamics-points"
          d={marks.map((mark) => circlePath(mark.x, mark.centerY, mark.radius)).join(" ")}
        />
      </g>
    );
  });
}

function ArticulationOverlay({
  samples,
  xByGroup,
  bands,
}: {
  samples: PerformanceGroupVisualization[];
  xByGroup: Map<string, number>;
  bands: { right: OverlayBand; left: OverlayBand };
}) {
  const byHand = (hand: "right" | "left") => samples
    .filter((sample) => sample.hand === hand && sample.durationRatio != null && xByGroup.has(sample.groupId))
    .sort((left, right) => (xByGroup.get(left.groupId) ?? 0) - (xByGroup.get(right.groupId) ?? 0));
  const groupedMarks = new Map<string, { expected: string[]; performed: string[]; points: string[] }>();
  for (const hand of ["right", "left"] as const) {
    const handSamples = byHand(hand);
    const y = bands[hand].middle;
    handSamples.forEach((sample, index) => {
      const x = xByGroup.get(sample.groupId)!;
      const nextX = xByGroup.get(handSamples[index + 1]?.groupId ?? "") ?? x + 24;
      const expectedWidth = clamp(nextX - x - 4, 10, 40);
      const ratio = sample.durationRatio ?? 0;
      const performedWidth = expectedWidth * clamp(ratio, 0.12, 2);
      const character = ratio < 0.85
        ? "short"
        : ratio < 1.2 ? "natural"
          : ratio < 1.65 ? "sustained" : "extended";
      const key = `${hand}-${character}`;
      const marks = groupedMarks.get(key) ?? { expected: [], performed: [], points: [] };
      marks.expected.push(`M ${x} ${y} H ${x + expectedWidth}`);
      marks.performed.push(`M ${x} ${y} H ${x + performedWidth}`);
      marks.points.push(circlePath(x + performedWidth, y, 3.5));
      groupedMarks.set(key, marks);
    });
  }

  return [...groupedMarks].map(([key, marks]) => {
    const [hand, character] = key.split("-");
    return (
      <g key={key} className={`articulation-mark ${hand} ${character}`} data-mark-count={marks.points.length}>
        <path d={marks.expected.join(" ")} className="articulation-expected" />
        <path d={marks.performed.join(" ")} className="articulation-performed" />
        <path d={marks.points.join(" ")} className="articulation-point" />
      </g>
    );
  });
}

function ExpressionOverlay({
  samples,
  xByGroup,
  bands,
  scale,
  renderWindow,
}: {
  samples: PerformanceGroupVisualization[];
  xByGroup: Map<string, number>;
  bands: { right: OverlayBand; left: OverlayBand };
  scale: DynamicsDisplayScale;
  renderWindow: OverlayRenderWindow | null;
}) {
  const visibleByHand = (hand: "right" | "left") => samples
    .filter((sample) => {
      if (sample.hand !== hand) return false;
      const x = xByGroup.get(sample.groupId);
      return x != null && (!renderWindow || (x >= renderWindow.left && x <= renderWindow.right));
    })
    .sort((left, right) => (xByGroup.get(left.groupId) ?? 0) - (xByGroup.get(right.groupId) ?? 0));

  const marks = (["right", "left"] as const).flatMap((hand) => {
    const handSamples = visibleByHand(hand);
    const band = bands[hand];
    const paths: string[] = [];
    const heights: number[] = [];
    const widths: number[] = [];
    handSamples.forEach((sample) => {
      const x = xByGroup.get(sample.groupId);
      if (x == null || sample.intensity == null || sample.durationRatio == null) return;
      const maximumHeight = Math.max(6, band.bottom - band.top - 3);
      const scaledIntensity = scaleDynamicsIntensity(sample.intensity, scale);
      const height = 4 + scaledIntensity * (maximumHeight - 4);
      const width = 2 + clamp(sample.durationRatio, 0.2, 2) * 6;
      const y = hand === "right" ? band.bottom - height : band.top;
      paths.push(rectPath(x - width / 2, y, width, height));
      heights.push(height);
      widths.push(width);
    });
    return paths.length > 0 ? [{ hand, paths, heights, widths }] : [];
  });

  return (
    <>
      <line
        x1="0"
        y1={bands.right.bottom}
        x2="100%"
        y2={bands.right.bottom}
        className="expression-baseline right"
      />
      <line
        x1="0"
        y1={bands.left.top}
        x2="100%"
        y2={bands.left.top}
        className="expression-baseline left"
      />
      {marks.map((mark) => (
        <path
          key={mark.hand}
          d={mark.paths.join(" ")}
          className={`expression-mark expression-bars ${mark.hand}`}
          data-mark-count={mark.paths.length}
          data-max-bar-height={Math.max(...mark.heights)}
          data-min-bar-height={Math.min(...mark.heights)}
          data-max-bar-width={Math.max(...mark.widths)}
          data-min-bar-width={Math.min(...mark.widths)}
        />
      ))}
    </>
  );
}

function PedalOverlay({
  visualization,
  band,
  xAtTick,
}: {
  visualization: ReferencePerformanceVisualization;
  band: OverlayBand;
  xAtTick: (tick: number) => number;
}) {
  const samples = visualization.pedal;
  if (samples.length === 0) return null;
  const y = (value: number) => band.bottom
    - clamp(value, 0, 1) * (band.bottom - band.top);
  let line = `M ${xAtTick(samples[0].tick)} ${y(samples[0].value)}`;
  for (let index = 1; index < samples.length; index += 1) {
    const sample = samples[index];
    line += ` H ${xAtTick(sample.tick)} V ${y(sample.value)}`;
  }
  const transitions = samples.slice(1, -1).map((sample) => circlePath(xAtTick(sample.tick), y(sample.value), 2.25));
  return (
    <>
      <path d={line} className="pedal-line" />
      <line
        x1="0"
        y1={band.bottom}
        x2="100%"
        y2={band.bottom}
        className="performance-overlay-baseline"
      />
      {transitions.length > 0 ? (
        <path d={transitions.join(" ")} className="pedal-transition" data-mark-count={transitions.length} />
      ) : null}
    </>
  );
}

function tempoHoverTargets(
  score: ScoreData,
  tempo: TempoSample[],
  xAtTick: (tick: number) => number,
  band: OverlayBand,
  hiddenRanges: TickRange[],
): OverlayHoverTarget[] {
  return tempo.flatMap((sample, index) => {
    const tick = scorePositionToTick(score, sample.scorePosition);
    if (tickInRanges(tick, hiddenRanges)) return [];
    const nextTick = tempo[index + 1]
      ? scorePositionToTick(score, tempo[index + 1].scorePosition)
      : score.totalTicks;
    const startX = xAtTick(tick);
    const endX = xAtTick(Math.max(tick, nextTick));
    const left = Math.min(startX, endX);
    const right = Math.max(startX, endX);
    const measure = formatMeasureLabel(score, sample.scorePosition.measureIndex);
    const bpmLabel = sample.quarterBpm == null ? "速度未标定" : `${formatQuarterBpm(sample.quarterBpm)} BPM`;
    const label = sample.tempoMode === "free-time" || sample.normalizedTempoRatio == null
      ? `${measure} · 自由速度`
      : `${measure} · ${bpmLabel} · 相对全曲 ${formatTempoDelta(sample.normalizedTempoRatio)}`;
    return [{
      x: (left + right) / 2,
      y: band.middle,
      width: Math.max(18, right - left),
      height: band.bottom - band.top + 8,
      tick,
      label,
      tooltipTop: Math.max(4, band.top - 32),
    }];
  });
}

function dynamicsHoverTargets(
  score: ScoreData,
  visualization: ReferencePerformanceVisualization | null,
  xByGroup: Map<string, number>,
  bands: { right: OverlayBand; left: OverlayBand },
): OverlayHoverTarget[] {
  if (!visualization) return [];
  return visualization.groups.flatMap((sample) => {
    const x = xByGroup.get(sample.groupId);
    if (x == null || sample.intensity == null) return [];
    const band = bands[sample.hand];
    const y = band.middle;
    const height = band.bottom - band.top + 8;
    return [{
      x,
      y,
      width: 30,
      height,
      tick: sample.tick,
      label: `${formatMeasureLabel(score, sample.measureIndex)} · ${sample.hand === "right" ? "右手" : "左手"}力度 ${(sample.intensity * 100).toFixed(0)}%`,
      tooltipTop: Math.max(
        4,
        band.top - 32,
      ),
    }];
  });
}

function articulationHoverTargets(
  score: ScoreData,
  visualization: ReferencePerformanceVisualization | null,
  xByGroup: Map<string, number>,
  bands: { right: OverlayBand; left: OverlayBand },
): OverlayHoverTarget[] {
  if (!visualization) return [];
  return visualization.groups.flatMap((sample) => {
    const x = xByGroup.get(sample.groupId);
    if (x == null || sample.durationRatio == null) return [];
    const band = bands[sample.hand];
    const y = band.middle;
    return [{
      x,
      y,
      width: 42,
      height: 34,
      tick: sample.tick,
      label: `${formatMeasureLabel(score, sample.measureIndex)} · ${sample.hand === "right" ? "右手" : "左手"}触键时值 ${(sample.durationRatio * 100).toFixed(0)}%`,
      tooltipTop: Math.max(4, band.top - 32),
    }];
  });
}

function expressionHoverTargets(
  score: ScoreData,
  visualization: ReferencePerformanceVisualization | null,
  xByGroup: Map<string, number>,
  bands: { right: OverlayBand; left: OverlayBand },
): OverlayHoverTarget[] {
  if (!visualization) return [];
  return visualization.groups.flatMap((sample) => {
    const x = xByGroup.get(sample.groupId);
    if (x == null || sample.intensity == null || sample.durationRatio == null) return [];
    const band = bands[sample.hand];
    return [{
      x,
      y: band.middle,
      width: 38,
      height: band.bottom - band.top + 8,
      tick: sample.tick,
      label: `${formatMeasureLabel(score, sample.measureIndex)} · ${sample.hand === "right" ? "右手" : "左手"}力度 ${(sample.intensity * 100).toFixed(0)}% · 触键时值 ${sample.durationRatio.toFixed(2)}×`,
      tooltipTop: Math.max(4, band.top - 32),
    }];
  });
}

function measureIndexAtTick(score: ScoreData, tick: number): number {
  let low = 0;
  let high = score.measureStarts.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (score.measureStarts[middle] <= tick) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}

function pedalHoverTargets(
  score: ScoreData,
  visualization: ReferencePerformanceVisualization | null,
  xAtTick: (tick: number) => number,
  band: OverlayBand,
): OverlayHoverTarget[] {
  const samples = visualization?.pedal ?? [];
  if (samples.length === 0) return [];
  return samples.slice(0, -1).map((sample, index) => {
    const next = samples[index + 1];
    const startX = xAtTick(sample.tick);
    const endX = xAtTick(next?.tick ?? score.totalTicks);
    const left = Math.min(startX, endX);
    const right = Math.max(startX, endX);
    const depth = clamp(sample.value, 0, 1);
    const state = depth >= 0.5 ? "踩下" : "抬起";
    return {
      x: (left + right) / 2,
      y: band.middle,
      width: Math.max(18, right - left),
      height: band.bottom - band.top + 8,
      tick: sample.tick,
      label: `${formatMeasureLabel(score, measureIndexAtTick(score, sample.tick))} · 延音踏板${state} · 深度 ${(depth * 100).toFixed(0)}%`,
      tooltipTop: Math.max(4, band.top - 32),
    };
  });
}

export default function PerformanceScoreOverlay({
  score,
  layouts,
  staffGeometry,
  scoreFrame,
  surfaceWidth,
  surfaceHeight,
  capabilities,
  dynamicsScaleMode,
  tempo,
  sections,
  visualization,
}: PerformanceScoreOverlayProps) {
  const overlayRootRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLOutputElement | null>(null);
  const touchLaneSessionRef = useRef<TouchLaneSession | null>(null);
  const [viewport, setViewport] = useState<DynamicsViewport>({ left: 0, width: 0 });
  const xAtTick = useMemo(
    () => buildTickMapper(score, layouts, surfaceWidth),
    [layouts, score, surfaceWidth],
  );
  const xByGroup = useMemo(
    () => new Map(layouts.map((layout) => [layout.groupId, layout.timeX])),
    [layouts],
  );
  const dynamicsScale = useMemo(
    () => buildDynamicsDisplayScale(visualization?.groups ?? [], xByGroup, viewport, dynamicsScaleMode),
    [dynamicsScaleMode, viewport, visualization, xByGroup],
  );
  const dynamicsRenderWindow = useMemo<OverlayRenderWindow | null>(() => viewport.width > 0 ? {
    left: Math.max(0, viewport.left - viewport.width),
    right: Math.min(surfaceWidth, viewport.left + viewport.width * 2),
  } : null, [surfaceWidth, viewport]);
  const geometry = useMemo(
    () => buildOverlayGeometry(staffGeometry, scoreFrame, surfaceHeight),
    [scoreFrame, staffGeometry, surfaceHeight],
  );
  const hiddenTempoRanges = useMemo(
    () => pickupTickRanges(score, sections),
    [score, sections],
  );
  const overviewExpressionBands = useMemo(() => ({
    right: geometry.overview.rightExpression,
    left: geometry.overview.leftExpression,
  }), [geometry]);
  const hoverTargets = useMemo(() => [
    ...(capabilities.sectionTempo
      ? tempoHoverTargets(score, tempo, xAtTick, geometry.overview.tempo, hiddenTempoRanges)
      : []),
    ...(capabilities.dynamics && capabilities.articulation
      ? expressionHoverTargets(score, visualization, xByGroup, overviewExpressionBands)
      : capabilities.dynamics
        ? dynamicsHoverTargets(score, visualization, xByGroup, overviewExpressionBands)
        : capabilities.articulation
          ? articulationHoverTargets(score, visualization, xByGroup, overviewExpressionBands)
          : []),
    ...(capabilities.pedal
      ? pedalHoverTargets(score, visualization, xAtTick, geometry.overview.pedal)
      : []),
  ], [capabilities, geometry, hiddenTempoRanges, overviewExpressionBands, score, tempo, visualization, xAtTick, xByGroup]);
  const hoverLanes = useMemo(() => buildHoverLanes(hoverTargets), [hoverTargets]);
  const ariaLabel = "在谱面上综合标注速度、力度、触键时值与踏板";

  useLayoutEffect(() => {
    const root = overlayRootRef.current;
    if (!root) return;
    const scroll = root.closest<HTMLElement>(".score-scroll");
    let frameId: number | null = null;
    const publishViewport = () => {
      frameId = null;
      const next = {
        left: scroll?.scrollLeft ?? 0,
        width: scroll?.clientWidth || surfaceWidth,
      };
      setViewport((current) => current.left === next.left && current.width === next.width ? current : next);
    };
    const scheduleViewport = () => {
      if (frameId != null) return;
      frameId = window.requestAnimationFrame(publishViewport);
    };
    publishViewport();
    scroll?.addEventListener("scroll", scheduleViewport, { passive: true });
    window.addEventListener("resize", scheduleViewport);
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleViewport);
    if (scroll) resizeObserver?.observe(scroll);
    return () => {
      scroll?.removeEventListener("scroll", scheduleViewport);
      window.removeEventListener("resize", scheduleViewport);
      resizeObserver?.disconnect();
      if (frameId != null) window.cancelAnimationFrame(frameId);
    };
  }, [surfaceWidth]);

  useEffect(() => {
    const tooltip = tooltipRef.current;
    if (tooltip) {
      tooltip.hidden = true;
      tooltip.textContent = "";
    }
  }, [tempo, visualization]);

  function showDataTarget(target: OverlayHoverTarget) {
    const tooltip = tooltipRef.current;
    if (!tooltip || (tooltip.textContent === target.label && !tooltip.hidden)) return;
    tooltip.textContent = target.label;
    tooltip.style.left = `${clamp(target.x, 96, surfaceWidth - 96)}px`;
    tooltip.style.top = `${target.tooltipTop}px`;
    tooltip.hidden = false;
  }

  function clearDataTarget() {
    const tooltip = tooltipRef.current;
    if (!tooltip || tooltip.hidden) return;
    tooltip.hidden = true;
    tooltip.textContent = "";
  }

  function activateLaneTarget(element: HTMLElement, lane: OverlayHoverLane, requestedIndex: number) {
    const index = clamp(requestedIndex, 0, lane.targets.length - 1);
    const target = lane.targets[index];
    if (!target) return;
    element.dataset.targetIndex = String(index);
    element.setAttribute("aria-valuenow", String(index + 1));
    element.setAttribute("aria-valuetext", target.label);
    element.setAttribute("aria-label", `${ariaLabel}，数据点 ${index + 1}/${lane.targets.length}`);
    showDataTarget(target);
  }

  function activateLaneTargetAtPointer(
    element: HTMLElement,
    lane: OverlayHoverLane,
    clientX: number,
    clientY: number,
  ) {
    const target = hoverTargetAtX(lane.targets, laneContentX(element, clientX, clientY));
    if (target) {
      activateLaneTarget(element, lane, lane.targets.indexOf(target));
    } else {
      clearDataTarget();
    }
  }

  const visualizationLayer = useMemo(() => (
    <>
      {capabilities.sectionTempo ? (
        <TempoOverlay
          score={score}
          tempo={tempo}
          band={geometry.overview.tempo}
          xAtTick={xAtTick}
          hiddenRanges={hiddenTempoRanges}
        />
      ) : null}
      {visualization ? (
        <>
          {capabilities.dynamics && capabilities.articulation ? (
            <ExpressionOverlay
              samples={visualization.groups}
              xByGroup={xByGroup}
              bands={overviewExpressionBands}
              scale={dynamicsScale}
              renderWindow={dynamicsRenderWindow}
            />
          ) : capabilities.dynamics ? (
            <DynamicsOverlay
              samples={visualization.groups}
              xByGroup={xByGroup}
              bands={overviewExpressionBands}
              scale={dynamicsScale}
              renderWindow={dynamicsRenderWindow}
            />
          ) : capabilities.articulation ? (
            <ArticulationOverlay samples={visualization.groups} xByGroup={xByGroup} bands={overviewExpressionBands} />
          ) : null}
          {capabilities.pedal ? (
            <PedalOverlay
              visualization={visualization}
              band={geometry.overview.pedal}
              xAtTick={xAtTick}
            />
          ) : null}
        </>
      ) : null}
    </>
  ), [
    capabilities,
    dynamicsRenderWindow,
    dynamicsScale,
    geometry,
    hiddenTempoRanges,
    overviewExpressionBands,
    score,
    tempo,
    visualization,
    xAtTick,
    xByGroup,
  ]);

  return (
    <div
      ref={overlayRootRef}
      className="performance-score-overlay overview"
      style={{ width: surfaceWidth, height: surfaceHeight }}
      data-performance-view="overview"
      data-dynamics-scale-mode={dynamicsScale.mode}
      data-dynamics-scale-low={dynamicsScale.low}
      data-dynamics-scale-high={dynamicsScale.high}
    >
      <svg width={surfaceWidth} height={surfaceHeight} role="img" aria-label={ariaLabel}>
        <title>{ariaLabel}</title>
        <desc>所有标记使用乐谱本身的位置坐标；悬停标记可查看当前位置数据。</desc>
        {visualizationLayer}
      </svg>

      {hoverLanes.map((lane, index) => (
        <span
          key={`${lane.y}-${index}`}
          className="performance-overlay-hover-lane overview"
          tabIndex={0}
          style={{
            left: 0,
            top: lane.y - lane.height / 2,
            width: surfaceWidth,
            height: lane.height,
          }}
          onPointerMove={(event) => {
            const session = touchLaneSessionRef.current;
            const isTouchPointer = event.pointerType === "touch" || event.pointerType === "pen";
            if (isTouchPointer && session && session.pointerId === event.pointerId) {
              const pointerX = logicalPointerX(event.currentTarget, event.clientX, event.clientY);
              const deltaX = pointerX - session.startPointerX;
              session.moved = session.moved || Math.abs(deltaX) > TOUCH_PAN_THRESHOLD;
              if (session.moved) {
                const scroll = event.currentTarget.closest<HTMLElement>(".score-scroll");
                if (scroll) scroll.scrollLeft = session.startScrollLeft - deltaX;
                clearDataTarget();
              }
              return;
            }

            activateLaneTargetAtPointer(event.currentTarget, lane, event.clientX, event.clientY);
          }}
          onPointerLeave={clearDataTarget}
          onFocus={(event) => activateLaneTarget(
            event.currentTarget,
            lane,
            Number(event.currentTarget.dataset.targetIndex ?? 0),
          )}
          onBlur={clearDataTarget}
          onKeyDown={(event) => {
            const currentIndex = Number(event.currentTarget.dataset.targetIndex ?? 0);
            const nextIndex = event.key === "ArrowLeft"
              ? currentIndex - 1
              : event.key === "ArrowRight"
                ? currentIndex + 1
                : event.key === "Home"
                  ? 0
                  : event.key === "End" ? lane.targets.length - 1 : null;
            if (nextIndex == null) return;
            event.preventDefault();
            event.stopPropagation();
            activateLaneTarget(event.currentTarget, lane, nextIndex);
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
            if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
            const scroll = event.currentTarget.closest<HTMLElement>(".score-scroll");
            event.currentTarget.setPointerCapture(event.pointerId);
            touchLaneSessionRef.current = {
              pointerId: event.pointerId,
              startPointerX: logicalPointerX(event.currentTarget, event.clientX, event.clientY),
              startScrollLeft: scroll?.scrollLeft ?? 0,
              moved: false,
            };
          }}
          onPointerUp={(event) => {
            event.stopPropagation();
            const session = touchLaneSessionRef.current;
            if (!session || session.pointerId !== event.pointerId) return;
            touchLaneSessionRef.current = null;
            if (!session.moved) {
              activateLaneTargetAtPointer(event.currentTarget, lane, event.clientX, event.clientY);
            }
          }}
          onPointerCancel={(event) => {
            event.stopPropagation();
            const session = touchLaneSessionRef.current;
            if (session && session.pointerId === event.pointerId) {
              touchLaneSessionRef.current = null;
            }
            clearDataTarget();
          }}
          role="slider"
          aria-label={`${ariaLabel}，数据点 1/${lane.targets.length}`}
          aria-valuemin={1}
          aria-valuemax={lane.targets.length}
          aria-valuenow={1}
          aria-valuetext={lane.targets[0]?.label}
        />
      ))}

      <output
        ref={tooltipRef}
        className="performance-overlay-tooltip"
        hidden
        aria-live="polite"
      />
    </div>
  );
}
