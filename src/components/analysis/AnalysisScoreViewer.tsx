import { useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisViewItem, ScoreRange } from "../../analysis/types";
import { prepareMusicXmlForAnalysisDisplay } from "../../lib/displayXml";
import {
  normalizeMeasureLayoutsBySystem,
  playbackCursorAtTick,
  splitRangeBySystems,
  type AnalysisMeasureLayout,
} from "../../lib/analysis/layout";
import type { ScoreData } from "../../types";
import { TICKS_PER_QUARTER } from "../../types";

interface AnalysisScoreViewerProps {
  score: ScoreData | null;
  scoreZoom: number;
  overlayItems: AnalysisViewItem[];
  selectedId: string | null;
  selectedRangeIndex: number;
  playbackTick: number | null;
  onSelect: (id: string, rangeIndex: number) => void;
}

interface GraphicalMeasureLike {
  PositionAndShape: {
    AbsolutePosition: { x: number; y: number };
    Size: { width: number; height: number };
    BorderTop?: number;
    BorderBottom?: number;
  };
  ParentMusicSystem?: object;
  parentSourceMeasure?: { measureListIndex?: number };
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

function parseSvgDimension(value: string | null): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
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
): AnalysisMeasureLayout[] {
  const stageRect = stage.getBoundingClientRect();
  const svgRect = svg.getBoundingClientRect();
  const viewBoxWidth = svg.viewBox?.baseVal?.width || parseSvgDimension(svg.getAttribute("width"));
  const rawMeasures = osmd.GraphicSheet.MeasureList.flat().filter(
    (measure): measure is GraphicalMeasureLike => measure != null,
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
    const measures = measureList.filter((measure): measure is GraphicalMeasureLike => measure != null);
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
      y: offsetY + top * unitToCss - 7,
      width: Math.max(1, (right - left) * unitToCss),
      height: Math.max(28, (bottom - top) * unitToCss + 14),
      leftStaffY: offsetY + leftTop * unitToCss - 7,
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

export default function AnalysisScoreViewer({
  score,
  scoreZoom,
  overlayItems,
  selectedId,
  selectedRangeIndex,
  playbackTick,
  onSelect,
}: AnalysisScoreViewerProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const osmdRef = useRef<OsmdLike | null>(null);
  const renderFrameRef = useRef<number | null>(null);
  const lastWidthRef = useRef(0);
  const lastPlaybackSystemRef = useRef<number | null>(null);
  const scoreZoomRef = useRef(scoreZoom);
  const [measureLayouts, setMeasureLayouts] = useState<AnalysisMeasureLayout[]>([]);
  const [renderState, setRenderState] = useState<"idle" | "loading" | "ready" | "error">("idle");
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

  useEffect(() => {
    scoreZoomRef.current = scoreZoom;
    const osmd = osmdRef.current;
    const host = hostRef.current;
    if (!osmd || !host) {
      return;
    }

    osmd.Zoom = (host.clientWidth < 620 ? 0.68 : host.clientWidth < 1000 ? 0.78 : 0.88) * scoreZoom;
    osmd.render();
    if (renderFrameRef.current != null) {
      cancelAnimationFrame(renderFrameRef.current);
    }
    renderFrameRef.current = requestAnimationFrame(() => {
      const stage = stageRef.current;
      const svg = host.querySelector("svg") as SVGSVGElement | null;
      if (stage && svg) {
        setMeasureLayouts(buildMeasureLayouts(stage, svg, osmd));
      }
    });
  }, [scoreZoom]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    host.replaceChildren();
    osmdRef.current = null;
    setMeasureLayouts([]);
    setRenderState(score ? "loading" : "idle");

    if (!score) {
      return;
    }

    const scoreData = score;
    void import("opensheetmusicdisplay")
      .then(async ({ OpenSheetMusicDisplay }) => {
        const renderHost = document.createElement("div");
        renderHost.className = "analysis-osmd-render-host";
        host.replaceChildren(renderHost);
        const osmd = new OpenSheetMusicDisplay(renderHost, {
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
          drawingParameters: "compacttight",
          followCursor: false,
          disableCursor: true,
          pageBackgroundColor: "#ffffff",
          pageFormat: "Endless",
          renderSingleHorizontalStaffline: false,
        }) as unknown as OsmdLike & { load: (xml: string, title: string) => Promise<void> };

        await osmd.load(prepareMusicXmlForAnalysisDisplay(scoreData.xml), scoreData.title);
        if (disposed) {
          return;
        }

        osmdRef.current = osmd;
        const renderAndMeasure = () => {
          if (disposed) {
            return;
          }
          const width = host.clientWidth;
          lastWidthRef.current = width;
          osmd.Zoom = (width < 620 ? 0.68 : width < 1000 ? 0.78 : 0.88) * scoreZoomRef.current;
          osmd.render();
          if (renderFrameRef.current != null) {
            cancelAnimationFrame(renderFrameRef.current);
          }
          renderFrameRef.current = requestAnimationFrame(() => {
            const stage = stageRef.current;
            const svg = renderHost.querySelector("svg") as SVGSVGElement | null;
            if (!stage || !svg || disposed) {
              return;
            }
            svg.style.display = "block";
            svg.style.maxWidth = "none";
            setMeasureLayouts(buildMeasureLayouts(stage, svg, osmd));
            setRenderState("ready");
          });
        };

        renderAndMeasure();
        resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
          const width = Math.round(host.clientWidth);
          if (width > 0 && Math.abs(width - lastWidthRef.current) > 1) {
            renderAndMeasure();
          }
        });
        resizeObserver?.observe(host);
      })
      .catch(() => {
        if (!disposed) {
          setRenderState("error");
        }
      });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      if (renderFrameRef.current != null) {
        cancelAnimationFrame(renderFrameRef.current);
      }
      host.replaceChildren();
      osmdRef.current = null;
    };
  }, [score]);

  useEffect(() => {
    if (!selectedId || renderState !== "ready") {
      return;
    }
    const target = overlaySegments.find(
      (segment) => segment.item.id === selectedId && segment.rangeIndex === selectedRangeIndex,
    );
    const scroll = scrollRef.current;
    if (!target || !scroll) {
      return;
    }
    scroll.scrollTop = Math.max(0, target.y - scroll.clientHeight * 0.24);
  }, [overlaySegments, renderState, selectedId, selectedRangeIndex]);

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
          <div ref={hostRef} className="analysis-osmd-host" />
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
