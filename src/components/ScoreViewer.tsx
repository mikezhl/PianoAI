import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, X } from "lucide-react";
import type { GroupLayout, Hand, NoteGroup, ScoreData } from "../types";
import { prepareMusicXmlForPracticeDisplay } from "../lib/displayXml";
import { installHorizontalPedalLayoutFix } from "../lib/osmdHorizontalPedals";
import { MAX_SCORE_ZOOM, MIN_SCORE_ZOOM } from "../lib/scoreZoom";
import {
  buildScoreHitIndex,
  buildScoreOverlayLayout,
  buildSelectedFrames,
  frameFromLayouts,
  getBoxSelectedGroupIds,
  getScoreGroupAtPoint,
} from "../lib/scoreOverlay";
import { buildMidiScoreMarkers } from "../lib/staffNotation";
import type { ScoreGroupLayout, ScoreHitIndex, ScoreStaffGeometry } from "../lib/scoreOverlay";
import {
  HORIZONTAL_LAYOUT_ZOOM,
  HORIZONTAL_RENDER_BATCH_MEASURES,
  HORIZONTAL_SVG_WIDTH_BUDGET,
  calculateHorizontalDisplayGeometry,
} from "../lib/scoreRender";
import PerformanceScoreOverlay, {
  type PerformanceScoreOverlayConfig,
} from "./performance/PerformanceScoreOverlay";

interface ScoreViewerProps {
  score: ScoreData | null;
  scoreZoom: number;
  showScrollProgress?: boolean;
  progressCurrentTime?: string;
  progressTotalTime?: string;
  onScoreZoomLimitChange: (maxZoom: number) => void;
  allowBoxSelect: boolean;
  activeGroups: NoteGroup[];
  followActive: boolean;
  showActiveCursor?: boolean;
  performanceOverlay?: PerformanceScoreOverlayConfig | null;
  selectedIds: string[];
  hoveredId?: string | null;
  loopGroupIds: string[];
  pressedNotes: number[];
  onGroupHover?: (groupId: string | null) => void;
  onGroupSelect: (groupId: string, extend: boolean) => void;
  onBoxSelect: (groupIds: string[]) => void;
  onExpandSelectionToBothHands: () => void;
  onShrinkSelectionToHand: (hand: Hand) => void;
  onResizeSelectionBoundary: (edge: SelectionResizeEdge, tick: number) => void;
  onClearSelection: () => void;
  onDismissSelection: () => void;
}

type SelectionResizeEdge = "start" | "end";

interface PointerSession {
  mode: "select" | "pan" | "pan-pending" | "resize-selection";
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  scrollLeft: number;
  moved: boolean;
  pointerType: string;
  startGroupId: string | null;
  extend: boolean;
  resizeEdge?: SelectionResizeEdge;
  lastResizeTick?: number;
}

const EMPTY_STAFF_GEOMETRY: ScoreStaffGeometry = { right: null, left: null };
const HANDS: Hand[] = ["right", "left"];
const POINTER_MOVE_THRESHOLD_MOUSE = 6;
const POINTER_MOVE_THRESHOLD_TOUCH = 12;
const SELECTION_ACTION_TOP_OFFSET = 50;
const SELECTION_ACTION_BOTTOM_OFFSET = 6;
const SELECTION_ACTION_SIZE = 44;
const SELECTION_ACTION_VIEWPORT_PAD = 8;

interface SelectionAction {
  key: string;
  x: number;
  y: number;
  label: string;
  icon: "up" | "down" | "clear";
  align?: "center" | "right";
  onClick: () => void;
}

interface SelectionResizeTarget {
  tick: number;
  x: number;
}

function boundsFromLayouts(layouts: ScoreGroupLayout[]): GroupLayout | null {
  if (layouts.length === 0) {
    return null;
  }

  const x = Math.min(...layouts.map((layout) => layout.frameX));
  const y = Math.min(...layouts.map((layout) => layout.frameY));
  const right = Math.max(...layouts.map((layout) => layout.frameX + layout.frameWidth));
  const bottom = Math.max(...layouts.map((layout) => layout.frameY + layout.frameHeight));

  return {
    groupId: "selection-action",
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

function boundsFromBoxes(groupId: string, boxes: GroupLayout[]): GroupLayout | null {
  if (boxes.length === 0) {
    return null;
  }

  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));

  return {
    groupId,
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

function medianNumber(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

function getLayoutOffsetWithinAncestor(element: HTMLElement, ancestor: HTMLElement): { x: number; y: number } {
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

function renderableSvgElements(element: Element): Element[] {
  const children = Array.from(element.querySelectorAll("path, rect, text"));
  return element.matches("path, rect, text") ? [element, ...children] : children;
}

function applySvgHighlight(element: Element) {
  const svgElement = element as SVGElement;
  const fill = svgElement.getAttribute("fill");
  const stroke = svgElement.getAttribute("stroke");
  if (fill !== "none") {
    svgElement.style.fill = "#2563eb";
  }
  if (stroke !== "none") {
    svgElement.style.stroke = "#2563eb";
  }
}

function resetSvgHighlight(element: Element) {
  for (const target of renderableSvgElements(element)) {
    const svgElement = target as SVGElement;
    svgElement.style.fill = "";
    svgElement.style.stroke = "";
  }
}

function ScoreViewer({
  score,
  scoreZoom,
  showScrollProgress = true,
  progressCurrentTime = "0:00",
  progressTotalTime = "0:00",
  onScoreZoomLimitChange,
  allowBoxSelect,
  activeGroups,
  followActive,
  showActiveCursor = followActive,
  performanceOverlay = null,
  selectedIds,
  hoveredId = null,
  loopGroupIds,
  pressedNotes,
  onGroupHover,
  onGroupSelect,
  onBoxSelect,
  onExpandSelectionToBothHands,
  onShrinkSelectionToHand,
  onResizeSelectionBoundary,
  onClearSelection,
  onDismissSelection,
}: ScoreViewerProps) {
  const osmdHostRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const pointerRef = useRef<PointerSession | null>(null);
  const scrollProgressPointerRef = useRef<number | null>(null);
  const scoreZoomRef = useRef(scoreZoom);
  const onScoreZoomLimitChangeRef = useRef(onScoreZoomLimitChange);
  const lastPublishedScoreZoomLimitRef = useRef<number | null>(null);
  const scheduleMeasureRef = useRef<(() => void) | null>(null);
  const ensureMeasureRenderedRef = useRef<(measureIndex: number) => void>(() => undefined);
  const seekScoreTickRef = useRef<(tick: number) => void>(() => undefined);
  const followedMeasureRef = useRef<number | null>(null);
  const hoveredHitGroupRef = useRef<string | null>(null);
  const svgTargetsByGroupRef = useRef<Map<string, Element[]>>(new Map());
  const coloredElementsRef = useRef<Set<Element>>(new Set());
  const [layouts, setLayouts] = useState<ScoreGroupLayout[]>([]);
  const [surfaceSize, setSurfaceSize] = useState({ width: 1600, height: 360 });
  const [scoreViewportHeight, setScoreViewportHeight] = useState(360);
  const [scoreFrame, setScoreFrame] = useState({ top: 0, height: 260 });
  const [staffGeometry, setStaffGeometry] = useState<ScoreStaffGeometry>(EMPTY_STAFF_GEOMETRY);
  const [selectionBox, setSelectionBox] = useState<GroupLayout | null>(null);
  const [scrollProgress, setScrollProgress] = useState(1);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [activeResizeEdge, setActiveResizeEdge] = useState<SelectionResizeEdge | null>(null);
  const layoutById = useMemo(() => new Map(layouts.map((layout) => [layout.groupId, layout])), [layouts]);
  const hitIndex = useMemo<ScoreHitIndex>(() => buildScoreHitIndex(layouts), [layouts]);
  const groupById = useMemo(
    () => new Map((score?.noteGroups ?? []).map((group) => [group.id, group])),
    [score],
  );
  const scoreLayoutReady = layouts.length > 0;
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedGroups = useMemo(() => {
    return selectedIds
      .map((groupId) => groupById.get(groupId))
      .filter((group): group is NoteGroup => group != null);
  }, [groupById, selectedIds]);
  const selectedHands = useMemo(
    () => HANDS.filter((hand) => selectedGroups.some((group) => group.hand === hand)),
    [selectedGroups],
  );
  const selectionResizeTargets = useMemo<SelectionResizeTarget[]>(() => {
    if (!score || selectedHands.length === 0) {
      return [];
    }

    const handSet = new Set(selectedHands);
    return score.noteGroups
      .filter((group) => handSet.has(group.hand))
      .map((group) => {
        const layout = layoutById.get(group.id);
        return layout ? { tick: group.absoluteTick, x: layout.timeX } : null;
      })
      .filter((target): target is SelectionResizeTarget => target != null)
      .sort((a, b) => a.x - b.x);
  }, [layoutById, score, selectedHands]);
  const selectedVisualFrames = useMemo(
    () => buildSelectedFrames(layouts, selectedIds, selectedHands.length > 1),
    [layouts, selectedHands.length, selectedIds],
  );
  const selectedResizeFrame = useMemo(
    () => boundsFromBoxes("selected-resize", selectedVisualFrames),
    [selectedVisualFrames],
  );
  const selectionActions = useMemo<SelectionAction[]>(() => {
    if (!score || selectedGroups.length === 0 || layouts.length === 0) {
      return [];
    }

    const selectedLayouts = layouts.filter((layout) => selectedIdSet.has(layout.groupId));
    if (selectedLayouts.length === 0) {
      return [];
    }

    const startTick = Math.min(...selectedGroups.map((group) => group.absoluteTick));
    const endTick = Math.max(...selectedGroups.map((group) => group.absoluteTick));
    if (startTick === endTick) {
      return [];
    }

    const hasHandInRange = (hand: Hand) =>
      score.noteGroups.some(
        (group) => group.hand === hand && group.absoluteTick >= startTick && group.absoluteTick <= endTick,
      );
    const allBounds = boundsFromLayouts(selectedLayouts);
    if (!allBounds) {
      return [];
    }

    const centerX = allBounds.x + allBounds.width * 0.5;
    const rightBounds = boundsFromLayouts(selectedLayouts.filter((layout) => layout.hand === "right"));
    const leftBounds = boundsFromLayouts(selectedLayouts.filter((layout) => layout.hand === "left"));
    const actions: SelectionAction[] = [];
    const minActionY = SELECTION_ACTION_VIEWPORT_PAD;
    const maxActionY = Math.max(
      minActionY,
      scoreViewportHeight - SELECTION_ACTION_SIZE - SELECTION_ACTION_VIEWPORT_PAD,
    );
    const clampActionY = (y: number) => clampNumber(y, minActionY, maxActionY);

    if (selectedHands.length === 1 && selectedHands[0] === "right" && hasHandInRange("left") && rightBounds) {
      actions.push({
        key: "expand-down",
        x: centerX,
        y: clampActionY(rightBounds.y + rightBounds.height + SELECTION_ACTION_BOTTOM_OFFSET),
        label: "扩选到左右手",
        icon: "down",
        onClick: onExpandSelectionToBothHands,
      });
    }

    if (selectedHands.length === 1 && selectedHands[0] === "left" && hasHandInRange("right") && leftBounds) {
      actions.push({
        key: "expand-up",
        x: centerX,
        y: clampActionY(leftBounds.y - SELECTION_ACTION_TOP_OFFSET),
        label: "扩选到左右手",
        icon: "up",
        onClick: onExpandSelectionToBothHands,
      });
    }

    if (selectedHands.length === 2) {
      if (rightBounds) {
        actions.push({
          key: "shrink-left",
          x: centerX,
          y: clampActionY(rightBounds.y - SELECTION_ACTION_TOP_OFFSET),
          label: "仅保留低音",
          icon: "down",
          onClick: () => onShrinkSelectionToHand("left"),
        });
      }

      if (leftBounds) {
        actions.push({
          key: "shrink-right",
          x: centerX,
          y: clampActionY(leftBounds.y + leftBounds.height + SELECTION_ACTION_BOTTOM_OFFSET),
          label: "仅保留高音",
          icon: "up",
          onClick: () => onShrinkSelectionToHand("right"),
        });
      }
    }

    return actions;
  }, [
    layouts,
    onExpandSelectionToBothHands,
    onShrinkSelectionToHand,
    score,
    scoreViewportHeight,
    selectedGroups,
    selectedHands,
    selectedIdSet,
  ]);
  const selectionControls = useMemo<SelectionAction[]>(() => {
    if (selectedGroups.length <= 1 || !selectedResizeFrame) {
      return selectionActions;
    }

    const maxActionY = Math.max(
      SELECTION_ACTION_VIEWPORT_PAD,
      scoreViewportHeight - SELECTION_ACTION_SIZE - SELECTION_ACTION_VIEWPORT_PAD,
    );
    const clearAction: SelectionAction = {
      key: "clear-selection",
      x: selectedResizeFrame.x + selectedResizeFrame.width,
      y: clampNumber(
        selectedResizeFrame.y - SELECTION_ACTION_TOP_OFFSET,
        SELECTION_ACTION_VIEWPORT_PAD,
        maxActionY,
      ),
      label: "清除多选",
      icon: "clear",
      align: "right",
      onClick: onDismissSelection,
    };

    return [...selectionActions, clearAction];
  }, [onDismissSelection, scoreViewportHeight, selectedGroups.length, selectedResizeFrame, selectionActions]);

  const progressX = useMemo(() => {
    return medianNumber(
      activeGroups
        .map((group) => layoutById.get(group.id)?.timeX)
        .filter((x): x is number => x != null),
    );
  }, [activeGroups, layoutById]);
  const activeMeasureIndex = activeGroups[0]?.measureIndex ?? null;
  const activeMeasureX = useMemo(() => {
    if (activeMeasureIndex == null) {
      return null;
    }

    return medianNumber(
      activeGroups
        .filter((group) => group.measureIndex === activeMeasureIndex)
        .map((group) => layoutById.get(group.id)?.measureX)
        .filter((x): x is number => x != null),
    );
  }, [activeGroups, activeMeasureIndex, layoutById]);

  function publishScoreZoomLimit(maxZoom: number) {
    const normalized = Math.max(MIN_SCORE_ZOOM, Math.min(MAX_SCORE_ZOOM, maxZoom));
    if (
      lastPublishedScoreZoomLimitRef.current != null
      && Math.abs(lastPublishedScoreZoomLimitRef.current - normalized) < 0.5
    ) {
      return;
    }

    lastPublishedScoreZoomLimitRef.current = normalized;
    onScoreZoomLimitChangeRef.current(normalized);
  }

  useEffect(() => {
    onScoreZoomLimitChangeRef.current = onScoreZoomLimitChange;
  }, [onScoreZoomLimitChange]);

  useEffect(() => {
    scoreZoomRef.current = scoreZoom;
    scheduleMeasureRef.current?.();
  }, [scoreZoom]);

  useEffect(() => {
    let disposed = false;
    let animationFrameId: number | null = null;
    let renderFrameId: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let handleViewportChange: (() => void) | null = null;
    let handleScrollRender: (() => void) | null = null;
    const host = osmdHostRef.current;
    if (!host) {
      return;
    }
    const hostElement = host;

    lastPublishedScoreZoomLimitRef.current = null;
    hostElement.replaceChildren();
    svgTargetsByGroupRef.current = new Map();
    setLayouts([]);
    setSurfaceSize({ width: 1600, height: 360 });
    setScoreViewportHeight(360);
    setScoreFrame({ top: 0, height: 260 });
    setStaffGeometry(EMPTY_STAFF_GEOMETRY);
    setScrollProgress(0);
    setRenderError(null);

    if (!score) {
      publishScoreZoomLimit(MAX_SCORE_ZOOM);
      return;
    }
    const scoreData = score;

    const failCurrentRender = () => {
      if (disposed) {
        return;
      }

      hostElement.replaceChildren();
      resizeObserver?.disconnect();
      svgTargetsByGroupRef.current = new Map();
      setLayouts([]);
      setRenderError("谱面渲染失败");
    };

    void import("opensheetmusicdisplay")
      .then(async ({ OpenSheetMusicDisplay, VexFlowMusicSheetCalculator }) => {
        installHorizontalPedalLayoutFix(VexFlowMusicSheetCalculator);
        const osmd = new OpenSheetMusicDisplay(hostElement, {
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
          drawMeasureNumbersOnlyAtSystemStart: false,
          measureNumberInterval: 1,
          useXMLMeasureNumbers: true,
          drawMetronomeMarks: false,
          drawFingerings: false,
          drawLyrics: false,
          drawTimeSignatures: false,
          drawingParameters: "compacttight",
          followCursor: false,
          disableCursor: true,
          pageBackgroundColor: "#ffffff",
          renderSingleHorizontalStaffline: true,
        });

        await osmd.load(prepareMusicXmlForPracticeDisplay(scoreData.xml), scoreData.title);
        if (disposed) {
          return;
        }

        osmd.EngravingRules.SheetMaximumWidth = HORIZONTAL_SVG_WIDTH_BUDGET;
        osmd.Zoom = HORIZONTAL_LAYOUT_ZOOM;
        const initialProgress = osmd.renderNext({ measures: HORIZONTAL_RENDER_BATCH_MEASURES });
        let incrementalComplete = initialProgress.done;
        let renderedMeasureIndex = Math.max(
          -1,
          ...initialProgress.lastRenderedMeasure.map((measure) => measure.parentSourceMeasure.measureListIndex),
        );
        let pendingMeasureIndex = -1;
        let pendingScrollTick: number | null = null;
        let renderingBatch = false;

        function scheduleMeasure() {
          if (disposed) {
            return;
          }

          if (animationFrameId != null) {
            cancelAnimationFrame(animationFrameId);
          }
          animationFrameId = requestAnimationFrame(measureAndPlace);
        }

        function applyDisplaySize(svg: SVGSVGElement, viewportWidth: number, viewportHeight: number): boolean {
          const nativeWidth = Number.parseFloat(svg.getAttribute("width") ?? "");
          const nativeHeight = Number.parseFloat(svg.getAttribute("height") ?? "");
          const geometry = calculateHorizontalDisplayGeometry({
            nativeWidth,
            nativeHeight,
            viewportWidth,
            viewportHeight,
            requestedUserZoom: scoreZoomRef.current,
          });
          if (!geometry) {
            return false;
          }

          publishScoreZoomLimit(geometry.maxUserZoomPercent);
          svg.style.width = `${geometry.width}px`;
          svg.style.height = `${geometry.height}px`;
          return true;
        }

        function measureAndPlace() {
          animationFrameId = null;
          if (disposed) {
            return;
          }

          try {
            const svg = hostElement.querySelector("svg") as SVGSVGElement | null;
            const overlay = overlayRef.current;
            if (!svg || !overlay) {
              return;
            }

            svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
            svg.style.display = "block";

            withUntransformedApp(hostElement, () => {
              const viewport = scrollRef.current;
              const viewportWidth = viewport?.clientWidth ?? hostElement.clientWidth;
              const viewportHeight = viewport?.clientHeight ?? hostElement.clientHeight;
              setScoreViewportHeight(viewportHeight);
              if (!applyDisplaySize(svg, viewportWidth, viewportHeight)) {
                return;
              }

              const overlayLayout = buildScoreOverlayLayout(
                hostElement,
                overlay,
                svg,
                osmd,
                scoreData,
                viewportHeight,
                renderedMeasureIndex,
              );
              svgTargetsByGroupRef.current = overlayLayout.svgTargets;
              setLayouts(overlayLayout.layouts);
              setScoreFrame(overlayLayout.scoreFrame);
              setStaffGeometry(overlayLayout.staffGeometry);
              setSurfaceSize(overlayLayout.surfaceSize);

              if (pendingScrollTick != null) {
                const targetGroup = scoreData.noteGroups.reduce<NoteGroup | null>((nearest, group) => {
                  if (!nearest) return group;
                  return Math.abs(group.absoluteTick - pendingScrollTick!)
                    < Math.abs(nearest.absoluteTick - pendingScrollTick!) ? group : nearest;
                }, null);
                const targetLayout = targetGroup
                  ? overlayLayout.layouts.find((layout) => layout.groupId === targetGroup.id)
                  : null;
                if (targetLayout && scrollRef.current) {
                  scrollRef.current.scrollLeft = Math.max(0, targetLayout.timeX - 24);
                  pendingScrollTick = null;
                }
              }
            });

            if (!incrementalComplete && pendingMeasureIndex > renderedMeasureIndex) {
              scheduleRenderBatch();
            } else if (pendingMeasureIndex <= renderedMeasureIndex) {
              pendingMeasureIndex = -1;
            }
            maybeRenderMore();
          } catch {
            failCurrentRender();
          }
        }

        function renderNextBatch() {
          renderFrameId = null;
          const scroll = scrollRef.current;
          if (disposed || incrementalComplete || renderingBatch || !scroll) {
            return;
          }

          renderingBatch = true;
          try {
            const progress = osmd.renderNext({ measures: HORIZONTAL_RENDER_BATCH_MEASURES });
            incrementalComplete = progress.done;
            renderedMeasureIndex = Math.max(
              renderedMeasureIndex,
              ...progress.lastRenderedMeasure.map((measure) => measure.parentSourceMeasure.measureListIndex),
            );
            const svg = hostElement.querySelector("svg") as SVGSVGElement | null;
            if (svg) {
              svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
              svg.style.display = "block";
              withUntransformedApp(hostElement, () => {
                const viewportWidth = scroll.clientWidth || hostElement.clientWidth;
                const viewportHeight = scroll.clientHeight || hostElement.clientHeight;
                applyDisplaySize(svg, viewportWidth, viewportHeight);
              });
            }
            scheduleMeasure();
          } catch {
            failCurrentRender();
            return;
          } finally {
            renderingBatch = false;
          }

        }

        function scheduleRenderBatch() {
          if (disposed || incrementalComplete || renderFrameId != null) {
            return;
          }
          renderFrameId = requestAnimationFrame(renderNextBatch);
        }

        function maybeRenderMore() {
          const scroll = scrollRef.current;
          const svg = hostElement.querySelector("svg") as SVGSVGElement | null;
          if (disposed || incrementalComplete || !scroll || !svg) {
            return;
          }

          const scrollRect = scroll.getBoundingClientRect();
          const svgRect = svg.getBoundingClientRect();
          const renderedRight = svgRect.right - scrollRect.left + scroll.scrollLeft;
          const visibleRight = scroll.scrollLeft + scroll.clientWidth;
          if (visibleRight >= renderedRight - scroll.clientWidth * 1.5) {
            scheduleRenderBatch();
          }
        }

        const ensureMeasureRendered = (measureIndex: number) => {
          if (measureIndex <= renderedMeasureIndex || incrementalComplete) return;
          pendingMeasureIndex = Math.max(pendingMeasureIndex, measureIndex);
          scheduleRenderBatch();
        };

        const seekScoreTick = (tick: number) => {
          const targetTick = clampNumber(tick, 0, scoreData.totalTicks);
          let measureIndex = scoreData.measureStarts.length - 1;
          while (measureIndex > 0 && scoreData.measureStarts[measureIndex] > targetTick) {
            measureIndex -= 1;
          }
          pendingScrollTick = targetTick;
          pendingMeasureIndex = Math.max(pendingMeasureIndex, measureIndex);
          if (measureIndex <= renderedMeasureIndex || incrementalComplete) {
            scheduleMeasure();
          } else {
            scheduleRenderBatch();
          }
        };

        scheduleMeasureRef.current = scheduleMeasure;
        ensureMeasureRenderedRef.current = ensureMeasureRendered;
        seekScoreTickRef.current = seekScoreTick;
        resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasure);
        if (scrollRef.current) {
          resizeObserver?.observe(scrollRef.current);
          handleScrollRender = maybeRenderMore;
          scrollRef.current.addEventListener("scroll", handleScrollRender, { passive: true });
        }

        handleViewportChange = scheduleMeasure;
        window.addEventListener("resize", handleViewportChange);
        window.addEventListener("orientationchange", handleViewportChange);
        scheduleMeasure();
      })
      .catch(() => {
        failCurrentRender();
      });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      if (handleViewportChange) {
        window.removeEventListener("resize", handleViewportChange);
        window.removeEventListener("orientationchange", handleViewportChange);
      }
      if (handleScrollRender && scrollRef.current) {
        scrollRef.current.removeEventListener("scroll", handleScrollRender);
      }
      if (animationFrameId != null) {
        cancelAnimationFrame(animationFrameId);
      }
      if (renderFrameId != null) {
        cancelAnimationFrame(renderFrameId);
      }
      ensureMeasureRenderedRef.current = () => undefined;
      seekScoreTickRef.current = () => undefined;
      if (scheduleMeasureRef.current === handleViewportChange) {
        scheduleMeasureRef.current = null;
      }
    };
  }, [score]);

  useEffect(() => {
    if (!followActive) {
      followedMeasureRef.current = null;
      return;
    }

    if (activeMeasureIndex != null) {
      ensureMeasureRenderedRef.current(activeMeasureIndex);
    }

    if (
      activeMeasureIndex == null
      || activeMeasureX == null
      || followedMeasureRef.current === activeMeasureIndex
      || !scrollRef.current
    ) {
      return;
    }

    const scroll = scrollRef.current;
    followedMeasureRef.current = activeMeasureIndex;
    const targetLeft = Math.max(0, activeMeasureX - scroll.clientWidth * 0.38);
    scroll.scrollTo({ left: targetLeft, behavior: "smooth" });
  }, [activeMeasureIndex, activeMeasureX, followActive]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) {
      return;
    }

    const updateProgress = () => {
      if (!score || layouts.length === 0 || score.totalTicks <= 0) {
        setScrollProgress(0);
        return;
      }
      const probeX = scroll.scrollLeft + Math.min(80, scroll.clientWidth * 0.1);
      const nearest = layouts.reduce<ScoreGroupLayout | null>((current, layout) => {
        if (!current) return layout;
        return Math.abs(layout.timeX - probeX) < Math.abs(current.timeX - probeX) ? layout : current;
      }, null);
      const tick = nearest ? groupById.get(nearest.groupId)?.absoluteTick ?? 0 : 0;
      setScrollProgress(clampNumber(tick / score.totalTicks, 0, 1));
    };

    updateProgress();
    scroll.addEventListener("scroll", updateProgress, { passive: true });
    window.addEventListener("resize", updateProgress);
    return () => {
      scroll.removeEventListener("scroll", updateProgress);
      window.removeEventListener("resize", updateProgress);
    };
  }, [groupById, layouts, score, surfaceSize.width]);

  function seekScrollProgress(progress: number) {
    if (!score) {
      return;
    }

    const nextProgress = clampNumber(progress, 0, 1);
    setScrollProgress(nextProgress);
    seekScoreTickRef.current(nextProgress * score.totalTicks);
  }

  function seekScrollProgressAtPointer(element: HTMLDivElement, clientX: number, clientY: number) {
    const appShell = element.closest<HTMLElement>(".app-shell");
    let localX: number;

    if (appShell?.dataset.layoutMode === "rotated-long-edge") {
      const transform = window.getComputedStyle(appShell).transform;
      if (transform && transform !== "none") {
        const appPoint = new DOMPoint(clientX, clientY).matrixTransform(new DOMMatrixReadOnly(transform).inverse());
        const elementOffset = getLayoutOffsetWithinAncestor(element, appShell);
        localX = appPoint.x - elementOffset.x;
      } else {
        localX = clientX - element.getBoundingClientRect().left;
      }
    } else {
      localX = clientX - element.getBoundingClientRect().left;
    }

    seekScrollProgress(localX / Math.max(1, element.offsetWidth));
  }

  function handleScrollProgressPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    scrollProgressPointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    seekScrollProgressAtPointer(event.currentTarget, event.clientX, event.clientY);
  }

  function handleScrollProgressPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (scrollProgressPointerRef.current !== event.pointerId) {
      return;
    }

    seekScrollProgressAtPointer(event.currentTarget, event.clientX, event.clientY);
  }

  function handleScrollProgressPointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (scrollProgressPointerRef.current === event.pointerId) {
      scrollProgressPointerRef.current = null;
    }
  }

  function handleScrollProgressKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    let nextProgress: number | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      nextProgress = scrollProgress - 0.02;
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      nextProgress = scrollProgress + 0.02;
    } else if (event.key === "Home") {
      nextProgress = 0;
    } else if (event.key === "End") {
      nextProgress = 1;
    }

    if (nextProgress == null) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    seekScrollProgress(nextProgress);
  }

  useEffect(() => {
    for (const element of coloredElementsRef.current) {
      resetSvgHighlight(element);
    }
    coloredElementsRef.current.clear();

    const activeIds = new Set(activeGroups.map((group) => group.id));
    const idsToColor = new Set([...selectedIds, ...activeIds]);
    if (hoveredId) {
      idsToColor.add(hoveredId);
    }
    for (const loopGroupId of loopGroupIds) {
      idsToColor.add(loopGroupId);
    }

    for (const groupId of idsToColor) {
      for (const element of svgTargetsByGroupRef.current.get(groupId) ?? []) {
        renderableSvgElements(element).forEach((child) => {
          applySvgHighlight(child);
          coloredElementsRef.current.add(child);
        });
      }
    }
  }, [activeGroups, hoveredId, layouts, loopGroupIds, selectedIds]);

  const visualFrames = useMemo(() => {
    const frames = [...selectedVisualFrames];
    const selected = new Set(selectedIds);
    const hoveredLayout = hoveredId ? layoutById.get(hoveredId) : null;
    if (hoveredLayout && !selected.has(hoveredLayout.groupId)) {
      const frame = frameFromLayouts(`hover-${hoveredLayout.groupId}`, "hovered", [hoveredLayout]);
      if (frame) {
        frames.push(frame);
      }
    }

    const loopLayouts = loopGroupIds
      .filter((loopGroupId) => !selected.has(loopGroupId))
      .map((loopGroupId) => layoutById.get(loopGroupId))
      .filter((layout): layout is ScoreGroupLayout => layout != null);
    if (loopLayouts.length > 0) {
      const frame = frameFromLayouts(`loop-${loopGroupIds.join("-")}`, "loop-active", loopLayouts);
      if (frame) {
        frames.push(frame);
      }
    }

    return frames;
  }, [hoveredId, layoutById, loopGroupIds, selectedIds, selectedVisualFrames]);

  const midiScoreMarkers = useMemo(() => {
    if (!score || !scoreLayoutReady || pressedNotes.length === 0 || progressX == null) {
      return [];
    }

    return buildMidiScoreMarkers({
      pressedNotes,
      score,
      activeGroups,
      layouts,
      staffGeometry,
      progressX,
    });
  }, [activeGroups, layouts, pressedNotes, progressX, score, scoreLayoutReady, staffGeometry]);

  function getLocalPoint(event: React.PointerEvent<HTMLDivElement>) {
    const overlay = overlayRef.current;
    if (!overlay) {
      return { x: 0, y: 0 };
    }

    const appShell = overlay.closest<HTMLElement>(".app-shell");
    if (appShell?.dataset.layoutMode === "rotated-long-edge") {
      const transform = window.getComputedStyle(appShell).transform;
      if (transform && transform !== "none") {
        const appPoint = new DOMPoint(event.clientX, event.clientY).matrixTransform(
          new DOMMatrixReadOnly(transform).inverse(),
        );
        const overlayOffset = getLayoutOffsetWithinAncestor(overlay, appShell);
        const scrollLeft = scrollRef.current?.scrollLeft ?? 0;
        return {
          x: appPoint.x - overlayOffset.x + scrollLeft,
          y: appPoint.y - overlayOffset.y,
        };
      }
    }

    const rect = overlay.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function updateHoveredGroup(point: { x: number; y: number }, eventTarget?: EventTarget | null) {
    if (!onGroupHover) {
      return;
    }
    const target = eventTarget instanceof Element ? eventTarget : null;
    const groupId = target?.closest(".performance-score-overlay")
      ? null
      : getScoreGroupAtPoint(hitIndex, point.x, point.y)?.groupId ?? null;
    if (hoveredHitGroupRef.current === groupId) {
      return;
    }

    hoveredHitGroupRef.current = groupId;
    onGroupHover(groupId);
  }

  function clearHoveredGroup() {
    if (!onGroupHover || hoveredHitGroupRef.current == null) {
      return;
    }
    hoveredHitGroupRef.current = null;
    onGroupHover(null);
  }

  function getResizeTickAtX(x: number): number | null {
    let closest: SelectionResizeTarget | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const target of selectionResizeTargets) {
      const distance = Math.abs(target.x - x);
      if (distance < closestDistance) {
        closest = target;
        closestDistance = distance;
      }
    }

    return closest?.tick ?? null;
  }

  function updateSelectionResize(session: PointerSession) {
    if (!session.resizeEdge) {
      return;
    }

    const tick = getResizeTickAtX(session.currentX);
    if (tick == null || tick === session.lastResizeTick) {
      return;
    }

    session.lastResizeTick = tick;
    onResizeSelectionBoundary(session.resizeEdge, tick);
  }

  function updateSelectionBox(session: PointerSession) {
    const x = Math.min(session.startX, session.currentX);
    const y = Math.min(session.startY, session.currentY);
    setSelectionBox({
      groupId: "selection",
      x,
      y,
      width: Math.abs(session.currentX - session.startX),
      height: Math.abs(session.currentY - session.startY),
    });
  }

  function finishSelection(session: PointerSession) {
    const box = {
      groupId: "selection",
      x: Math.min(session.startX, session.currentX),
      y: Math.min(session.startY, session.currentY),
      width: Math.abs(session.currentX - session.startX),
      height: Math.abs(session.currentY - session.startY),
    };

    setSelectionBox(null);
    if (box.width < 8 || box.height < 8) {
      if (session.startGroupId) {
        onGroupSelect(session.startGroupId, session.extend);
      } else {
        onClearSelection();
      }
      return;
    }

    const selected = getBoxSelectedGroupIds(layouts, box);
    onBoxSelect(selected);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const resizeEdge = target.closest<HTMLElement>("[data-selection-resize-edge]")?.dataset.selectionResizeEdge;
    const point = getLocalPoint(event);
    const targetGroupId = getScoreGroupAtPoint(hitIndex, point.x, point.y)?.groupId ?? null;
    event.currentTarget.setPointerCapture(event.pointerId);

    if (resizeEdge === "start" || resizeEdge === "end") {
      event.preventDefault();
      setActiveResizeEdge(resizeEdge);
      pointerRef.current = {
        mode: "resize-selection",
        pointerId: event.pointerId,
        startX: point.x,
        startY: point.y,
        currentX: point.x,
        currentY: point.y,
        scrollLeft: scrollRef.current?.scrollLeft ?? 0,
        moved: false,
        pointerType: event.pointerType,
        startGroupId: null,
        extend: false,
        resizeEdge,
      };
      updateSelectionResize(pointerRef.current);
      return;
    }

    if (event.pointerType !== "mouse" || !allowBoxSelect) {
      const session: PointerSession = {
        mode: "pan-pending",
        pointerId: event.pointerId,
        startX: point.x,
        startY: point.y,
        currentX: point.x,
        currentY: point.y,
        scrollLeft: scrollRef.current?.scrollLeft ?? 0,
        moved: false,
        pointerType: event.pointerType,
        startGroupId: targetGroupId,
        extend: event.shiftKey,
      };
      pointerRef.current = session;
      return;
    }

    pointerRef.current = {
      mode: "select",
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
      scrollLeft: scrollRef.current?.scrollLeft ?? 0,
      moved: false,
      pointerType: event.pointerType,
      startGroupId: targetGroupId,
      extend: event.shiftKey,
    };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const session = pointerRef.current;
    if (!session) {
      updateHoveredGroup(getLocalPoint(event), event.target);
      return;
    }
    if (session.pointerId !== event.pointerId) {
      return;
    }

    const point = getLocalPoint(event);
    const dx = point.x - session.startX;
    const dy = point.y - session.startY;
    session.currentX = point.x;
    session.currentY = point.y;
    const moveThreshold =
      session.pointerType === "mouse" ? POINTER_MOVE_THRESHOLD_MOUSE : POINTER_MOVE_THRESHOLD_TOUCH;
    session.moved = session.moved || Math.abs(dx) > moveThreshold || Math.abs(dy) > moveThreshold;

    if (session.mode === "resize-selection") {
      updateSelectionResize(session);
      return;
    }

    if (session.mode === "pan-pending" && session.moved) {
      session.mode = "pan";
    }

    if (session.mode === "pan") {
      if (scrollRef.current) {
        scrollRef.current.scrollLeft = session.scrollLeft - dx;
      }
      return;
    }

    if (session.mode === "select" && session.moved) {
      updateSelectionBox(session);
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const session = pointerRef.current;
    pointerRef.current = null;

    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    if (session.mode === "resize-selection") {
      setActiveResizeEdge(null);
      return;
    }

    if (session.mode === "pan-pending" && !session.moved) {
      if (session.startGroupId) {
        onGroupSelect(session.startGroupId, session.extend);
      } else {
        onClearSelection();
      }
      return;
    }

    if (session.mode === "select") {
      finishSelection(session);
    }
  }

  function handlePointerCancel(event: React.PointerEvent<HTMLDivElement>) {
    const session = pointerRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    pointerRef.current = null;
    setSelectionBox(null);
    setActiveResizeEdge(null);
  }

  return (
    <section
      className={`score-panel ${showScrollProgress ? "" : "without-scroll-progress"}`}
      aria-label="乐谱"
    >
      {!score ? <div className="empty-score-hint">点击右上角打开曲库或导入曲目</div> : null}
      <div
        className="score-scroll"
        ref={scrollRef}
        onWheel={(event) => {
          if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
            event.preventDefault();
            event.currentTarget.scrollLeft += event.deltaY;
          }
        }}
      >
        <div
          className={`score-surface ${performanceOverlay ? "with-performance-overlay performance-overlay-overview" : ""}`}
          style={{ width: surfaceSize.width }}
        >
          <div ref={osmdHostRef} className="osmd-host" />
          {renderError ? <div className="score-render-error">{renderError}</div> : null}
          <div
            ref={overlayRef}
            className={`score-overlay ${activeResizeEdge ? "resizing-selection" : ""}`}
            style={{ width: surfaceSize.width }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onPointerLeave={clearHoveredGroup}
          >
            {score && scoreLayoutReady && showActiveCursor && activeGroups.length > 0 && progressX != null ? (
              <div
                className="progress-line"
                style={{ left: progressX, top: scoreFrame.top, height: scoreFrame.height }}
              />
            ) : null}

            {score && performanceOverlay && scoreLayoutReady ? (
              <PerformanceScoreOverlay
                score={score}
                layouts={layouts}
                staffGeometry={staffGeometry}
                scoreFrame={scoreFrame}
                surfaceWidth={surfaceSize.width}
                surfaceHeight={surfaceSize.height}
                {...performanceOverlay}
              />
            ) : null}

            {visualFrames.map((frame) => (
              <div
                key={frame.key}
                className={`score-frame ${frame.className}`}
                style={{
                  left: frame.x,
                  top: frame.y,
                  width: frame.width,
                  height: frame.height,
                }}
              />
            ))}

            {!selectionBox && selectedResizeFrame ? (
              <>
                <button
                  type="button"
                  className="selection-resize-handle selection-resize-handle-start"
                  data-selection-resize-edge="start"
                  style={{
                    left: selectedResizeFrame.x,
                    top: selectedResizeFrame.y,
                    height: selectedResizeFrame.height,
                  }}
                  aria-label="拖拽左边界调整选区"
                  title="拖拽左边界调整选区"
                >
                  <ChevronLeft size={18} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="selection-resize-handle selection-resize-handle-end"
                  data-selection-resize-edge="end"
                  style={{
                    left: selectedResizeFrame.x + selectedResizeFrame.width,
                    top: selectedResizeFrame.y,
                    height: selectedResizeFrame.height,
                  }}
                  aria-label="拖拽右边界调整选区"
                  title="拖拽右边界调整选区"
                >
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              </>
            ) : null}

            {!selectionBox && selectionControls.map((action) => (
              <button
                type="button"
                key={action.key}
                className={`selection-action-button ${action.align === "right" ? "selection-action-button-align-right" : ""}`}
                style={{
                  left: action.x,
                  top: action.y,
                }}
                aria-label={action.label}
                title={action.label}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  action.onClick();
                }}
              >
                {action.icon === "up" ? (
                  <ChevronUp size={18} aria-hidden="true" />
                ) : action.icon === "down" ? (
                  <ChevronDown size={18} aria-hidden="true" />
                ) : (
                  <X size={18} aria-hidden="true" />
                )}
              </button>
            ))}

            {selectionBox ? (
              <div
                className="selection-box"
                style={{
                  left: selectionBox.x,
                  top: selectionBox.y,
                  width: selectionBox.width,
                  height: selectionBox.height,
                }}
              />
            ) : null}

            {midiScoreMarkers.length > 0 ? (
              <div className="midi-note-layer" aria-hidden="true">
                {midiScoreMarkers.map((marker) => (
                  <div
                    key={`${marker.hand}-${marker.midi}`}
                    className="midi-score-note"
                    style={{ left: marker.x, top: marker.y }}
                  >
                    {marker.ledgerLines.map((lineY) => (
                      <span
                        key={lineY}
                        className="midi-ledger-line"
                        style={{ top: lineY - marker.y }}
                      />
                    ))}
                    <span className="midi-notehead" />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {scoreLayoutReady && showScrollProgress ? (
        <div className="playback-progress-row">
          <time className="playback-progress-time" aria-label={`当前时间 ${progressCurrentTime}`}>
            {progressCurrentTime}
          </time>
          <div
            className="score-scroll-progress"
            role="slider"
            tabIndex={0}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(scrollProgress * 100)}
            aria-label="谱面位置"
            aria-valuetext={`${Math.round(scrollProgress * 100)}%`}
            title="点击或拖拽跳转谱面"
            onPointerDown={handleScrollProgressPointerDown}
            onPointerMove={handleScrollProgressPointerMove}
            onPointerUp={handleScrollProgressPointerEnd}
            onPointerCancel={handleScrollProgressPointerEnd}
            onKeyDown={handleScrollProgressKeyDown}
          >
            <span className="score-scroll-progress-track" aria-hidden="true">
              <span className="score-scroll-progress-fill" style={{ width: `${scrollProgress * 100}%` }} />
              <span className="score-scroll-progress-thumb" style={{ left: `${scrollProgress * 100}%` }} />
            </span>
          </div>
          <time className="playback-progress-time" aria-label={`总时长 ${progressTotalTime}`}>
            {progressTotalTime}
          </time>
        </div>
      ) : null}
    </section>
  );
}

export default memo(ScoreViewer);
