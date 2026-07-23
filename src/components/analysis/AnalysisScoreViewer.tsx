import { useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisViewItem, ScoreRange } from "../../analysis/types";
import { prepareMusicXmlForAnalysisDisplay } from "../../lib/displayXml";
import {
  normalizeMeasureLayoutsBySystem,
  playbackCursorAtTick,
  splitRangeBySystems,
  type AnalysisMeasureLayout,
} from "../../lib/analysis/layout";
import {
  buildAnalysisScoreChunks,
  musicXmlSystemStartMeasureIndexes,
  scoreChunkIndexesForRange,
  type AnalysisScoreChunk,
} from "../../lib/analysis/scoreChunks";
import type { ScoreData } from "../../types";
import { TICKS_PER_QUARTER } from "../../types";

interface AnalysisScoreViewerProps {
  score: ScoreData | null;
  scoreZoom: number;
  overlayItems: AnalysisViewItem[];
  selectedId: string | null;
  selectedRangeIndex: number;
  renderRange: ScoreRange | null;
  rangeKey: string | null;
  isPlaying: boolean;
  playbackTick: number | null;
  onSelect: (id: string, rangeIndex: number) => void;
  onRenderReady: (rangeKey: string | null) => void;
}

interface GraphicalMeasureLike {
  PositionAndShape: {
    AbsolutePosition: { x: number; y: number };
    Size: { width: number; height: number };
    BorderTop?: number;
    BorderBottom?: number;
  };
  ParentMusicSystem?: object;
  parentSourceMeasure?: { measureListIndex?: number; WasRendered?: boolean };
  staffEntries?: GraphicalStaffEntryLike[];
  isPianoLeftHand?: () => boolean;
}

interface GraphicalStaffEntryLike {
  relInMeasureTimestamp?: {
    RealValue?: number;
    Numerator?: number;
    Denominator?: number;
    WholeValue?: number;
  };
  PositionAndShape: {
    AbsolutePosition: { x: number; y: number };
  };
}

interface OsmdLike {
  Zoom: number;
  GraphicSheet: {
    MeasureList: Array<Array<GraphicalMeasureLike | null | undefined>>;
  };
  render: () => void;
  setOptions: (options: { drawFromMeasureNumber: number; drawUpToMeasureNumber: number }) => void;
}

export interface AnalysisRenderMeasureRange {
  startMeasureIndex: number;
  endMeasureIndex: number;
  drawFromMeasureNumber: number;
  drawUpToMeasureNumber: number;
}

function isMeasureStart(range: ScoreRange): boolean {
  return range.end.offsetQuarter.numerator === 0;
}

export function analysisRenderMeasureRange(range: ScoreRange): AnalysisRenderMeasureRange {
  const startMeasureIndex = range.start.measureIndex;
  const endMeasureIndex = isMeasureStart(range) && range.end.measureIndex > startMeasureIndex
    ? range.end.measureIndex - 1
    : range.end.measureIndex;
  return {
    startMeasureIndex,
    endMeasureIndex,
    drawFromMeasureNumber: startMeasureIndex + 1,
    drawUpToMeasureNumber: endMeasureIndex + 1,
  };
}

interface OverlaySegment {
  key: string;
  item: AnalysisViewItem;
  range: ScoreRange;
  rangeIndex: number;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

type ChunkRenderStatus = "idle" | "queued" | "rendering" | "ready" | "error";

interface ChunkRuntime {
  status: ChunkRenderStatus;
  height: number | null;
  localLayouts: AnalysisMeasureLayout[];
}

interface ChunkRenderController {
  setSelectedRange: (rangeKey: string | null, chunkIndexes: number[]) => void;
  updateVisibleChunks: () => void;
  invalidate: () => void;
  pause: () => void;
  resume: () => void;
}

function parseSvgDimension(value: string | null): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function withUntransformedApp<T>(element: HTMLElement, measure: () => T): T {
  const appShell = element.closest<HTMLElement>(".app-shell");
  if (!appShell || appShell.dataset.layoutMode !== "rotated-long-edge") {
    return measure();
  }

  const previousTransform = appShell.style.transform;
  appShell.style.transform = "none";
  appShell.getBoundingClientRect();

  try {
    return measure();
  } finally {
    appShell.style.transform = previousTransform;
  }
}

function finite(value: number | undefined, fallback: number): number {
  return value != null && Number.isFinite(value) ? value : fallback;
}

function fractionValue(value: GraphicalStaffEntryLike["relInMeasureTimestamp"]): number | null {
  if (!value) {
    return null;
  }
  if (value.RealValue != null && Number.isFinite(value.RealValue)) {
    return value.RealValue;
  }
  const numerator = value.Numerator ?? 0;
  const denominator = value.Denominator ?? 1;
  const whole = value.WholeValue ?? 0;
  return denominator > 0 ? whole + numerator / denominator : null;
}

function buildTimelineAnchors(
  measures: GraphicalMeasureLike[],
  offsetX: number,
  unitToCss: number,
) {
  const positionsByTimestamp = new Map<number, number[]>();
  for (const measure of measures) {
    for (const entry of measure.staffEntries ?? []) {
      const timestampWhole = fractionValue(entry.relInMeasureTimestamp);
      const rawX = entry.PositionAndShape?.AbsolutePosition?.x;
      if (timestampWhole == null || rawX == null || !Number.isFinite(rawX)) {
        continue;
      }
      const offsetQuarter = Math.round(timestampWhole * 4 * 1_000_000) / 1_000_000;
      const positions = positionsByTimestamp.get(offsetQuarter) ?? [];
      positions.push(offsetX + rawX * unitToCss);
      positionsByTimestamp.set(offsetQuarter, positions);
    }
  }

  return Array.from(positionsByTimestamp, ([offsetQuarter, positions]) => ({
    offsetQuarter,
    x: positions.reduce((sum, position) => sum + position, 0) / positions.length,
  })).sort((left, right) => left.offsetQuarter - right.offsetQuarter);
}

function buildMeasureLayouts(
  stage: HTMLElement,
  svg: SVGSVGElement,
  osmd: OsmdLike,
  renderedRange: AnalysisRenderMeasureRange,
): AnalysisMeasureLayout[] {
  const stageRect = stage.getBoundingClientRect();
  const svgRect = svg.getBoundingClientRect();
  const viewBoxWidth = svg.viewBox?.baseVal?.width || parseSvgDimension(svg.getAttribute("width"));
  const viewBoxY = svg.viewBox?.baseVal?.y ?? 0;
  const rawMeasures = osmd.GraphicSheet.MeasureList.flat().filter(
    (measure): measure is GraphicalMeasureLike =>
      measure != null
      && (measure.parentSourceMeasure?.measureListIndex ?? 0) >= renderedRange.startMeasureIndex
      && (measure.parentSourceMeasure?.measureListIndex ?? 0) <= renderedRange.endMeasureIndex,
  );
  const rawRight = rawMeasures.reduce(
    (maximum, measure) => Math.max(
      maximum,
      measure.PositionAndShape.AbsolutePosition.x + measure.PositionAndShape.Size.width,
    ),
    0,
  );
  const unitToCss = viewBoxWidth > 0
    ? (svgRect.width / viewBoxWidth) * 10
    : rawRight > 0
      ? svgRect.width / rawRight
      : 10;
  const offsetX = svgRect.left - stageRect.left;
  const offsetY = svgRect.top - stageRect.top;
  const systemIndices = new Map<object, number>();

  const layouts = osmd.GraphicSheet.MeasureList.map((measureList, fallbackMeasureIndex): AnalysisMeasureLayout | null => {
    const measures = measureList.filter(
      (measure): measure is GraphicalMeasureLike =>
        measure != null
        && (measure.parentSourceMeasure?.measureListIndex ?? fallbackMeasureIndex) >= renderedRange.startMeasureIndex
        && (measure.parentSourceMeasure?.measureListIndex ?? fallbackMeasureIndex) <= renderedRange.endMeasureIndex,
    );
    if (measures.length === 0) {
      return null;
    }

    const measureIndex = measures[0].parentSourceMeasure?.measureListIndex ?? fallbackMeasureIndex;
    const system = measures[0].ParentMusicSystem ?? measures[0];
    if (!systemIndices.has(system)) {
      systemIndices.set(system, systemIndices.size);
    }

    const left = Math.min(...measures.map((measure) => measure.PositionAndShape.AbsolutePosition.x));
    const right = Math.max(...measures.map((measure) => (
      measure.PositionAndShape.AbsolutePosition.x + measure.PositionAndShape.Size.width
    )));
    const top = Math.min(...measures.map((measure) => {
      const shape = measure.PositionAndShape;
      return shape.AbsolutePosition.y + finite(shape.BorderTop, -4.5);
    }));
    const bottom = Math.max(...measures.map((measure) => {
      const shape = measure.PositionAndShape;
      return shape.AbsolutePosition.y + finite(shape.BorderBottom, Math.max(4.5, shape.Size.height));
    }));
    const leftMeasure = measures.find((measure) => measure.isPianoLeftHand?.()) ?? measures[measures.length - 1];
    const leftShape = leftMeasure.PositionAndShape;
    const leftTop = leftShape.AbsolutePosition.y + finite(leftShape.BorderTop, -4.5);
    const leftBottom = leftShape.AbsolutePosition.y
      + finite(leftShape.BorderBottom, Math.max(4.5, leftShape.Size.height));

    return {
      measureIndex,
      systemIndex: systemIndices.get(system) ?? 0,
      x: offsetX + left * unitToCss,
      y: offsetY + (top - viewBoxY / 10) * unitToCss - 7,
      width: Math.max(1, (right - left) * unitToCss),
      height: Math.max(28, (bottom - top) * unitToCss + 14),
      leftStaffY: offsetY + (leftTop - viewBoxY / 10) * unitToCss - 7,
      leftStaffHeight: Math.max(24, (leftBottom - leftTop) * unitToCss + 14),
      leftStaffAnchors: buildTimelineAnchors(measures, offsetX, unitToCss),
    };
  }).filter((layout): layout is AnalysisMeasureLayout => layout != null);

  return normalizeMeasureLayoutsBySystem(layouts);
}

function rangeLabel(item: AnalysisViewItem, rangeIndex: number): string {
  if (item.kind === "motif") {
    return item.entity.occurrences[rangeIndex]?.label ?? item.label;
  }
  if (item.kind === "chord") {
    return item.entity.occurrences[rangeIndex]?.symbol ?? item.label;
  }
  if (item.kind === "texture") {
    return item.entity.occurrences[rangeIndex]?.label ?? item.label;
  }
  return item.label;
}

function chunkRenderRange(chunk: AnalysisScoreChunk): AnalysisRenderMeasureRange {
  return {
    startMeasureIndex: chunk.startMeasureIndex,
    endMeasureIndex: chunk.endMeasureIndex,
    drawFromMeasureNumber: chunk.startMeasureIndex + 1,
    drawUpToMeasureNumber: chunk.endMeasureIndex + 1,
  };
}

function chunkRenderContextRange(
  chunk: AnalysisScoreChunk,
  systemStartMeasureIndexes: number[],
): AnalysisRenderMeasureRange {
  const previousSystemStart = systemStartMeasureIndexes
    .filter((measureIndex) => measureIndex < chunk.startMeasureIndex)
    .at(-1);
  const startMeasureIndex = previousSystemStart ?? chunk.startMeasureIndex;
  return {
    startMeasureIndex,
    endMeasureIndex: chunk.endMeasureIndex,
    drawFromMeasureNumber: startMeasureIndex + 1,
    drawUpToMeasureNumber: chunk.endMeasureIndex + 1,
  };
}

function cropPreviousContextSystem(
  svg: SVGSVGElement,
  osmd: OsmdLike,
  targetStartMeasureIndex: number,
  renderedRange: AnalysisRenderMeasureRange,
): void {
  const viewBox = svg.viewBox?.baseVal;
  if (!viewBox || viewBox.width <= 0 || viewBox.height <= 0) {
    return;
  }

  const systems = new Map<object, {
    firstMeasureIndex: number;
    top: number;
    bottom: number;
  }>();
  for (const measure of osmd.GraphicSheet.MeasureList.flat()) {
    if (!measure) continue;
    const measureIndex = measure.parentSourceMeasure?.measureListIndex;
    if (
      measureIndex == null
      || measureIndex < renderedRange.startMeasureIndex
      || measureIndex > renderedRange.endMeasureIndex
    ) continue;
    const system = measure.ParentMusicSystem ?? measure;
    const shape = measure.PositionAndShape;
    const top = shape.AbsolutePosition.y + finite(shape.BorderTop, -4.5);
    const bottom = shape.AbsolutePosition.y
      + finite(shape.BorderBottom, Math.max(4.5, shape.Size.height));
    const current = systems.get(system);
    if (current) {
      current.firstMeasureIndex = Math.min(current.firstMeasureIndex, measureIndex);
      current.top = Math.min(current.top, top);
      current.bottom = Math.max(current.bottom, bottom);
    } else {
      systems.set(system, { firstMeasureIndex: measureIndex, top, bottom });
    }
  }

  const orderedSystems = [...systems.values()].sort((left, right) => left.top - right.top);
  const targetSystemIndex = orderedSystems.findIndex(
    (system) => system.firstMeasureIndex === targetStartMeasureIndex,
  );
  if (targetSystemIndex <= 0) {
    return;
  }

  const previousSystem = orderedSystems[targetSystemIndex - 1];
  const targetSystem = orderedSystems[targetSystemIndex];
  const cropY = Math.max(viewBox.y, ((previousSystem.bottom + targetSystem.top) / 2) * 10);
  const originalBottom = viewBox.y + viewBox.height;
  const croppedHeight = originalBottom - cropY;
  if (croppedHeight <= 0) {
    return;
  }

  const svgWidth = parseSvgDimension(svg.getAttribute("width")) || viewBox.width;
  svg.setAttribute("viewBox", `${viewBox.x} ${cropY} ${viewBox.width} ${croppedHeight}`);
  svg.setAttribute("height", String(croppedHeight * svgWidth / viewBox.width));
}

function removeCroppedSvgElements(svg: SVGSVGElement): void {
  const svgTop = svg.getBoundingClientRect().top;
  for (const child of Array.from(svg.children)) {
    const rect = child.getBoundingClientRect();
    if ((rect.width > 0 || rect.height > 0) && rect.bottom <= svgTop) {
      child.remove();
    }
  }
}

function estimatedChunkHeight(chunk: AnalysisScoreChunk, width: number, scoreZoom: number): number {
  const measureCount = chunk.endMeasureIndex - chunk.startMeasureIndex + 1;
  const heightPerMeasure = width < 620 ? 250 : width < 1000 ? 165 : 125;
  return Math.max(320, measureCount * heightPerMeasure * scoreZoom);
}

export default function AnalysisScoreViewer({
  score,
  scoreZoom,
  overlayItems,
  selectedId,
  selectedRangeIndex,
  renderRange,
  rangeKey,
  isPlaying,
  playbackTick,
  onSelect,
  onRenderReady,
}: AnalysisScoreViewerProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const renderHostRef = useRef<HTMLDivElement | null>(null);
  const chunkElementRefs = useRef(new Map<number, HTMLDivElement>());
  const chunkSvgHostRefs = useRef(new Map<number, HTMLDivElement>());
  const chunkRuntimeRef = useRef(new Map<number, ChunkRuntime>());
  const controllerRef = useRef<ChunkRenderController | null>(null);
  const renderFrameRef = useRef<number | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const lastWidthRef = useRef(0);
  const lastPlaybackSystemRef = useRef<number | null>(null);
  const lastScrolledRangeKeyRef = useRef<string | null>(null);
  const scoreZoomRef = useRef(scoreZoom);
  const renderTargetRef = useRef({ renderRange, rangeKey });
  const isPlayingRef = useRef(isPlaying);
  const onRenderReadyRef = useRef(onRenderReady);
  const deferredRenderRef = useRef(false);
  const [, setChunkRevision] = useState(0);
  const [measureLayouts, setMeasureLayouts] = useState<AnalysisMeasureLayout[]>([]);
  const [renderState, setRenderState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const systemStartMeasureIndexes = useMemo(
    () => score ? musicXmlSystemStartMeasureIndexes(score.xml) : [],
    [score],
  );
  const chunks = useMemo(
    () => buildAnalysisScoreChunks(
      score?.measureStarts.length ?? 0,
      undefined,
      systemStartMeasureIndexes,
    ),
    [score?.measureStarts.length, systemStartMeasureIndexes],
  );
  const renderingSystemStartMeasureIndexes = useMemo(
    () => [...new Set([
      ...systemStartMeasureIndexes,
      ...chunks.slice(1).map((chunk) => chunk.startMeasureIndex),
    ])].sort((left, right) => left - right),
    [chunks, systemStartMeasureIndexes],
  );
  const durationQuartersByMeasure = useMemo(
    () => score?.measureDurations.map((duration) => duration / TICKS_PER_QUARTER) ?? [],
    [score],
  );
  const overlaySegments = useMemo<OverlaySegment[]>(() => overlayItems.flatMap((item) => (
    item.ranges.flatMap((range, rangeIndex) => (
      splitRangeBySystems(
        range,
        measureLayouts,
        durationQuartersByMeasure,
        item.kind === "chord" || item.kind === "texture" ? "left-staff" : "measure",
      ).map((segment) => {
        const layout = measureLayouts.find((candidate) => candidate.measureIndex === segment.startMeasureIndex);
        const useLeftStaff = (item.kind === "chord" || item.kind === "texture")
          && layout?.leftStaffY != null
          && layout.leftStaffHeight != null;
        return {
          key: `${item.id}-${rangeIndex}-${segment.key}`,
          item,
          range,
          rangeIndex,
          label: rangeLabel(item, rangeIndex),
          x: segment.x,
          y: useLeftStaff ? layout.leftStaffY! : segment.y,
          width: segment.width,
          height: useLeftStaff ? layout.leftStaffHeight! : segment.height,
        };
      })
    ))
  )), [durationQuartersByMeasure, measureLayouts, overlayItems]);
  const playbackCursor = useMemo(() => {
    if (!score || playbackTick == null || measureLayouts.length === 0) {
      return null;
    }
    return playbackCursorAtTick(score, measureLayouts, playbackTick);
  }, [measureLayouts, playbackTick, score]);

  renderTargetRef.current = { renderRange, rangeKey };
  isPlayingRef.current = isPlaying;
  onRenderReadyRef.current = onRenderReady;

  useEffect(() => {
    scoreZoomRef.current = scoreZoom;
    controllerRef.current?.invalidate();
  }, [scoreZoom]);

  useEffect(() => {
    lastScrolledRangeKeyRef.current = null;
    const chunkIndexes = renderRange ? scoreChunkIndexesForRange(chunks, renderRange) : [];
    controllerRef.current?.setSelectedRange(rangeKey, chunkIndexes);
  }, [chunks, rangeKey, renderRange]);

  useEffect(() => {
    if (isPlaying) {
      controllerRef.current?.pause();
    } else {
      controllerRef.current?.resume();
    }
  }, [isPlaying]);

  useEffect(() => {
    const host = hostRef.current;
    const renderHost = renderHostRef.current;
    if (!host || !renderHost) {
      return;
    }
    const hostElement = host;
    const renderHostElement = renderHost;

    let disposed = false;
    let renderTimerId: number | null = null;
    let renderGeneration = 0;
    let renderingChunkIndex: number | null = null;
    let queue: Array<{ chunkIndex: number; priority: number }> = [];
    let selectedRangeKey: string | null = renderTargetRef.current.rangeKey;
    let selectedChunkIndexes = new Set<number>(
      renderTargetRef.current.renderRange
        ? scoreChunkIndexesForRange(chunks, renderTargetRef.current.renderRange)
        : [],
    );
    let visibleChunkIndexes = new Set<number>();
    let reportedRangeKey: string | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let hasReadyChunk = false;
    let osmd: (OsmdLike & { load: (xml: string, title: string) => Promise<void> }) | null = null;
    const runtimes = new Map<number, ChunkRuntime>(chunks.map((chunk) => [chunk.index, {
      status: "idle" as ChunkRenderStatus,
      height: null,
      localLayouts: [],
    }]));
    chunkRuntimeRef.current = runtimes;
    setChunkRevision((revision) => revision + 1);
    setMeasureLayouts([]);
    setRenderState(score ? "loading" : "idle");
    onRenderReadyRef.current(null);

    if (!score) {
      return;
    }

    const scoreData = score;
    const bumpChunkRevision = () => setChunkRevision((revision) => revision + 1);

    const refreshGlobalLayouts = () => {
      const hostOffsetX = hostElement.offsetLeft;
      const hostOffsetY = hostElement.offsetTop;
      const layouts = chunks.flatMap((chunk) => {
        const runtime = runtimes.get(chunk.index);
        const chunkElement = chunkElementRefs.current.get(chunk.index);
        if (!runtime || runtime.status !== "ready" || !chunkElement) {
          return [];
        }
        const offsetX = hostOffsetX + chunkElement.offsetLeft;
        const offsetY = hostOffsetY + chunkElement.offsetTop;
        return runtime.localLayouts.map((layout) => ({
          ...layout,
          systemIndex: chunk.index * 1_000 + layout.systemIndex,
          x: layout.x + offsetX,
          y: layout.y + offsetY,
          leftStaffY: layout.leftStaffY == null ? undefined : layout.leftStaffY + offsetY,
          leftStaffAnchors: layout.leftStaffAnchors?.map((anchor) => ({
            ...anchor,
            x: anchor.x + offsetX,
          })),
        }));
      });
      setMeasureLayouts(layouts);
    };

    const reportRangeReadiness = () => {
      const ready = selectedRangeKey != null
        && selectedChunkIndexes.size > 0
        && Array.from(selectedChunkIndexes).every((chunkIndex) => runtimes.get(chunkIndex)?.status === "ready");
      const nextReportedKey = ready ? selectedRangeKey : null;
      if (reportedRangeKey !== nextReportedKey) {
        reportedRangeKey = nextReportedKey;
        onRenderReadyRef.current(nextReportedKey);
      }
    };

    const scheduleNextChunk = () => {
      if (
        disposed
        || isPlayingRef.current
        || renderingChunkIndex != null
        || renderTimerId != null
        || queue.length === 0
      ) {
        return;
      }
      renderTimerId = window.setTimeout(renderNextChunk, 0);
    };

    const requestChunk = (chunkIndex: number, priority: number) => {
      if (isPlayingRef.current) {
        return;
      }
      const runtime = runtimes.get(chunkIndex);
      if (!runtime || runtime.status === "ready" || runtime.status === "rendering") {
        return;
      }
      const queued = queue.find((task) => task.chunkIndex === chunkIndex);
      if (queued) {
        queued.priority = Math.min(queued.priority, priority);
      } else {
        queue.push({ chunkIndex, priority });
        runtime.status = "queued";
        bumpChunkRevision();
      }
      queue.sort((left, right) => left.priority - right.priority || left.chunkIndex - right.chunkIndex);
      scheduleNextChunk();
    };

    const keepChunkIndexes = () => new Set([...selectedChunkIndexes, ...visibleChunkIndexes]);

    const pruneChunks = () => {
      if (isPlayingRef.current) {
        return;
      }
      const keep = keepChunkIndexes();
      queue = queue.filter((task) => {
        if (keep.has(task.chunkIndex)) return true;
        const runtime = runtimes.get(task.chunkIndex);
        if (runtime?.status === "queued") runtime.status = "idle";
        return false;
      });
      let changed = false;
      for (const chunk of chunks) {
        const runtime = runtimes.get(chunk.index);
        if (!runtime || keep.has(chunk.index) || runtime.status !== "ready") continue;
        chunkSvgHostRefs.current.get(chunk.index)?.replaceChildren();
        runtime.status = "idle";
        runtime.localLayouts = [];
        changed = true;
      }
      if (changed) {
        bumpChunkRevision();
        refreshGlobalLayouts();
      }
    };

    const updateVisibleChunks = () => {
      const scroll = scrollRef.current;
      if (isPlayingRef.current || !scroll || chunks.length === 0) {
        return;
      }
      const viewportHeight = scroll.clientHeight;
      const viewportTop = scroll.scrollTop;
      const viewportBottom = viewportTop + Math.max(1, viewportHeight);
      const margin = viewportHeight > 0 ? viewportHeight * 1.25 : 0;
      const visible = new Set<number>();
      let chunkTop = 0;
      for (const chunk of chunks) {
        const element = chunkElementRefs.current.get(chunk.index);
        const runtime = runtimes.get(chunk.index);
        const height = runtime?.height
          || element?.offsetHeight
          || estimatedChunkHeight(chunk, lastWidthRef.current, scoreZoomRef.current);
        if (chunkTop + height >= viewportTop - margin && chunkTop <= viewportBottom + margin) {
          visible.add(chunk.index);
          if (chunk.index > 0) visible.add(chunk.index - 1);
          if (chunk.index < chunks.length - 1) visible.add(chunk.index + 1);
        }
        chunkTop += height;
      }
      if (visible.size === 0) {
        visible.add(0);
      }
      visibleChunkIndexes = visible;
      for (const chunkIndex of visible) {
        requestChunk(chunkIndex, selectedChunkIndexes.has(chunkIndex) ? 0 : 1);
      }
      pruneChunks();
    };

    function renderNextChunk() {
      renderTimerId = null;
      if (disposed || isPlayingRef.current || renderingChunkIndex != null || !osmd) {
        return;
      }
      const task = queue.shift();
      if (!task) {
        return;
      }
      const chunk = chunks[task.chunkIndex];
      const runtime = runtimes.get(task.chunkIndex);
      const chunkElement = chunkElementRefs.current.get(task.chunkIndex);
      const svgHost = chunkSvgHostRefs.current.get(task.chunkIndex);
      if (!chunk || !runtime || !chunkElement || !svgHost) {
        if (runtime) runtime.status = "idle";
        scheduleNextChunk();
        return;
      }

      const generation = renderGeneration;
      renderingChunkIndex = task.chunkIndex;
      runtime.status = "rendering";
      bumpChunkRevision();
      const targetRange = chunkRenderRange(chunk);
      const renderedRange = chunkRenderContextRange(chunk, renderingSystemStartMeasureIndexes);
      try {
        const activeOsmd = osmd;
        if (!activeOsmd) {
          runtime.status = "idle";
          renderingChunkIndex = null;
          return;
        }
        const width = hostElement.clientWidth;
        lastWidthRef.current = width;
        activeOsmd.setOptions({
          drawFromMeasureNumber: renderedRange.drawFromMeasureNumber,
          drawUpToMeasureNumber: renderedRange.drawUpToMeasureNumber,
        });
        activeOsmd.Zoom = (width < 620 ? 0.68 : width < 1000 ? 0.78 : 0.88) * scoreZoomRef.current;
        activeOsmd.render();
        const sourceSvg = renderHostElement.querySelector("svg") as SVGSVGElement | null;
        if (!sourceSvg) {
          throw new Error("OSMD did not produce an SVG");
        }
        const clonedSvg = sourceSvg.cloneNode(true) as SVGSVGElement;
        cropPreviousContextSystem(clonedSvg, activeOsmd, targetRange.startMeasureIndex, renderedRange);
        clonedSvg.style.display = "block";
        clonedSvg.style.maxWidth = "none";
        svgHost.replaceChildren(clonedSvg);

        renderFrameRef.current = requestAnimationFrame(() => {
          renderFrameRef.current = null;
          if (disposed || generation !== renderGeneration || isPlayingRef.current) {
            svgHost.replaceChildren();
            runtime.status = "idle";
            renderingChunkIndex = null;
            bumpChunkRevision();
            return;
          }
          removeCroppedSvgElements(clonedSvg);
          const measurement = withUntransformedApp(chunkElement, () => ({
            layouts: buildMeasureLayouts(chunkElement, clonedSvg, activeOsmd, targetRange),
            height: clonedSvg.getBoundingClientRect().height
              || parseSvgDimension(clonedSvg.getAttribute("height")),
          }));
          runtime.localLayouts = measurement.layouts;
          const renderedHeight = measurement.height;
          runtime.height = Math.max(
            1,
            renderedHeight || estimatedChunkHeight(chunk, width, scoreZoomRef.current),
          );
          runtime.status = "ready";
          chunkElement.style.height = `${runtime.height}px`;
          renderingChunkIndex = null;
          hasReadyChunk = true;
          setRenderState("ready");
          bumpChunkRevision();
          refreshGlobalLayouts();
          reportRangeReadiness();
          scheduleNextChunk();
        });
      } catch {
        runtime.status = "error";
        renderingChunkIndex = null;
        bumpChunkRevision();
        reportRangeReadiness();
        if (!hasReadyChunk) {
          setRenderState("error");
        }
        scheduleNextChunk();
      }
    }

    const setSelectedRange = (nextRangeKey: string | null, chunkIndexes: number[]) => {
      selectedRangeKey = nextRangeKey;
      selectedChunkIndexes = new Set(chunkIndexes);
      reportedRangeKey = null;
      onRenderReadyRef.current(null);
      for (const chunkIndex of chunkIndexes) {
        requestChunk(chunkIndex, 0);
      }
      updateVisibleChunks();
      reportRangeReadiness();
    };

    const invalidate = () => {
      if (isPlayingRef.current) {
        deferredRenderRef.current = true;
        return;
      }
      deferredRenderRef.current = false;
      renderGeneration += 1;
      if (renderTimerId != null) {
        window.clearTimeout(renderTimerId);
        renderTimerId = null;
      }
      if (renderFrameRef.current != null) {
        cancelAnimationFrame(renderFrameRef.current);
        renderFrameRef.current = null;
      }
      queue = [];
      renderingChunkIndex = null;
      hasReadyChunk = false;
      reportedRangeKey = null;
      onRenderReadyRef.current(null);
      for (const chunk of chunks) {
        chunkSvgHostRefs.current.get(chunk.index)?.replaceChildren();
        const runtime = runtimes.get(chunk.index);
        if (!runtime) continue;
        runtime.status = "idle";
        runtime.height = null;
        runtime.localLayouts = [];
        const element = chunkElementRefs.current.get(chunk.index);
        if (element) element.style.height = "";
      }
      setMeasureLayouts([]);
      setRenderState("loading");
      bumpChunkRevision();
      for (const chunkIndex of selectedChunkIndexes) requestChunk(chunkIndex, 0);
      updateVisibleChunks();
    };

    const pause = () => {
      if (renderTimerId != null) {
        window.clearTimeout(renderTimerId);
        renderTimerId = null;
      }
      let changed = false;
      for (const task of queue) {
        const runtime = runtimes.get(task.chunkIndex);
        if (runtime?.status === "queued") {
          runtime.status = "idle";
          changed = true;
        }
      }
      queue = [];
      if (changed) {
        bumpChunkRevision();
      }
    };

    const resume = () => {
      if (deferredRenderRef.current) {
        invalidate();
      } else {
        for (const chunkIndex of selectedChunkIndexes) {
          requestChunk(chunkIndex, 0);
        }
        scheduleNextChunk();
        updateVisibleChunks();
      }
    };

    void import("opensheetmusicdisplay")
      .then(async ({ OpenSheetMusicDisplay }) => {
        osmd = new OpenSheetMusicDisplay(renderHostElement, {
          backend: "svg",
          autoResize: false,
          drawCredits: false,
          drawTitle: false,
          drawSubtitle: false,
          drawComposer: false,
          drawLyricist: false,
          drawPartNames: false,
          drawPartAbbreviations: false,
          drawMeasureNumbers: true,
          drawMeasureNumbersOnlyAtSystemStart: true,
          measureNumberInterval: 1,
          useXMLMeasureNumbers: true,
          drawMetronomeMarks: true,
          drawFingerings: true,
          drawLyrics: false,
          drawTimeSignatures: true,
          newSystemFromXML: true,
          newSystemFromNewPageInXML: true,
          drawingParameters: "compact",
          followCursor: false,
          disableCursor: true,
          pageBackgroundColor: "#ffffff",
          pageFormat: "Endless",
          renderSingleHorizontalStaffline: false,
        }) as unknown as OsmdLike & { load: (xml: string, title: string) => Promise<void> };

        await osmd.load(
          prepareMusicXmlForAnalysisDisplay(
            scoreData.xml,
            chunks.slice(1).map((chunk) => chunk.startMeasureIndex),
          ),
          scoreData.title,
        );
        if (disposed) {
          return;
        }
        controllerRef.current = {
          setSelectedRange,
          updateVisibleChunks,
          invalidate,
          pause,
          resume,
        };
        setSelectedRange(
          renderTargetRef.current.rangeKey,
          renderTargetRef.current.renderRange
            ? scoreChunkIndexesForRange(chunks, renderTargetRef.current.renderRange)
            : [],
        );
        updateVisibleChunks();
        resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
          const width = Math.round(hostElement.clientWidth);
          if (width > 0 && Math.abs(width - lastWidthRef.current) > 1) {
            invalidate();
          }
        });
        resizeObserver?.observe(hostElement);
      })
      .catch(() => {
        if (!disposed) {
          setRenderState("error");
        }
      });

    const handleScroll = () => {
      if (scrollFrameRef.current != null) return;
      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        controllerRef.current?.updateVisibleChunks();
      });
    };
    scrollRef.current?.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      scrollRef.current?.removeEventListener("scroll", handleScroll);
      controllerRef.current = null;
      if (renderFrameRef.current != null) {
        cancelAnimationFrame(renderFrameRef.current);
      }
      if (scrollFrameRef.current != null) {
        cancelAnimationFrame(scrollFrameRef.current);
      }
      if (renderTimerId != null) {
        window.clearTimeout(renderTimerId);
      }
      renderGeneration += 1;
      renderHostElement.replaceChildren();
      chunkSvgHostRefs.current.forEach((element) => element.replaceChildren());
    };
  }, [chunks, score]);

  useEffect(() => {
    if (!selectedId || !rangeKey || lastScrolledRangeKeyRef.current === rangeKey) {
      return;
    }
    const target = overlaySegments.find(
      (segment) => segment.item.id === selectedId && segment.rangeIndex === selectedRangeIndex,
    );
    const scroll = scrollRef.current;
    if (!target || !scroll) {
      return;
    }
    lastScrolledRangeKeyRef.current = rangeKey;
    scroll.scrollTop = Math.max(0, target.y - scroll.clientHeight * 0.24);
  }, [overlaySegments, rangeKey, selectedId, selectedRangeIndex]);

  useEffect(() => {
    if (!playbackCursor) {
      lastPlaybackSystemRef.current = null;
      return;
    }
    const scroll = scrollRef.current;
    if (!scroll || lastPlaybackSystemRef.current === playbackCursor.systemIndex) {
      return;
    }
    lastPlaybackSystemRef.current = playbackCursor.systemIndex;
    const visibleTop = scroll.scrollTop;
    const visibleBottom = visibleTop + scroll.clientHeight;
    if (playbackCursor.y < visibleTop + 40 || playbackCursor.y + playbackCursor.height > visibleBottom - 40) {
      scroll.scrollTop = Math.max(0, playbackCursor.y - scroll.clientHeight * 0.24);
    }
  }, [playbackCursor]);

  return (
    <section className="analysis-score-panel" aria-label="分析乐谱">
      {!score ? <div className="analysis-score-message">从曲库选择或导入谱子</div> : null}
      {renderState === "loading" ? <div className="analysis-score-message">正在排版乐谱</div> : null}
      {renderState === "error" ? <div className="analysis-score-message error">谱面渲染失败</div> : null}
      <div ref={scrollRef} className="analysis-score-scroll">
        <div ref={stageRef} className="analysis-score-stage">
          <div ref={hostRef} className="analysis-osmd-host" data-score-chunk-count={chunks.length}>
            <div ref={renderHostRef} className="analysis-osmd-render-host" aria-hidden="true" />
            {chunks.map((chunk) => {
              const runtime = chunkRuntimeRef.current.get(chunk.index);
              const status = runtime?.status ?? "idle";
              const height = runtime?.height
                ?? estimatedChunkHeight(chunk, lastWidthRef.current, scoreZoom);
              return (
                <div
                  key={chunk.index}
                  ref={(element) => {
                    if (element) chunkElementRefs.current.set(chunk.index, element);
                    else chunkElementRefs.current.delete(chunk.index);
                  }}
                  className={`analysis-score-chunk ${status}`}
                  data-score-chunk={chunk.index}
                  data-start-measure-index={chunk.startMeasureIndex}
                  data-end-measure-index={chunk.endMeasureIndex}
                  style={{ height }}
                >
                  <div
                    ref={(element) => {
                      if (element) chunkSvgHostRefs.current.set(chunk.index, element);
                      else chunkSvgHostRefs.current.delete(chunk.index);
                    }}
                    className="analysis-score-chunk-svg"
                  />
                  {status === "queued" || status === "rendering" ? (
                    <div className="analysis-score-chunk-status">正在排版乐谱</div>
                  ) : null}
                  {status === "error" ? (
                    <div className="analysis-score-chunk-status error">此段谱面渲染失败</div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="analysis-score-overlay" aria-label="谱面分析标注">
            {playbackCursor ? (
              <div
                className="analysis-playback-cursor"
                style={{
                  left: playbackCursor.x,
                  top: playbackCursor.y,
                  height: playbackCursor.height,
                }}
                aria-hidden="true"
              />
            ) : null}
            {overlaySegments.map((segment) => {
              const selectedFamily = segment.item.id === selectedId;
              const focused = selectedFamily && segment.rangeIndex === selectedRangeIndex;
              const selected = selectedFamily && !focused;
              return (
                <button
                  type="button"
                  key={segment.key}
                  className={`analysis-overlay-segment kind-${segment.item.kind} ${selected ? "selected" : ""} ${focused ? "focused" : ""}`}
                  style={{
                    left: segment.x,
                    top: segment.y,
                    width: segment.width,
                    height: segment.height,
                  }}
                  data-analysis-id={segment.item.id}
                  data-range-index={segment.rangeIndex}
                  onClick={() => onSelect(segment.item.id, segment.rangeIndex)}
                  aria-label={`${segment.label}，第 ${segment.rangeIndex + 1} 处`}
                >
                  {segment.width >= 66 && (segment.item.kind !== "chord" || focused) ? <span>{segment.label}</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
