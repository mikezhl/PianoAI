import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import type { GroupLayout, Hand, NoteGroup, ScoreData } from "../types";
import { prepareMusicXmlForPracticeDisplay } from "../lib/displayXml";
import {
  HIT_GAP,
  buildScoreOverlayLayout,
  buildSelectedFrames,
  frameFromLayouts,
  rectsIntersect,
} from "../lib/scoreOverlay";
import { buildMidiScoreMarkers } from "../lib/staffNotation";
import type { ScoreGroupLayout, ScoreStaffGeometry } from "../lib/scoreOverlay";

interface ScoreViewerProps {
  score: ScoreData | null;
  activeGroups: NoteGroup[];
  followActive: boolean;
  selectedIds: string[];
  hoveredId: string | null;
  loopGroupIds: string[];
  pressedNotes: number[];
  onGroupHover: (groupId: string | null) => void;
  onGroupSelect: (groupId: string, extend: boolean) => void;
  onBoxSelect: (groupIds: string[]) => void;
  onExpandSelectionToBothHands: () => void;
  onShrinkSelectionToHand: (hand: Hand) => void;
  onResizeSelectionBoundary: (edge: SelectionResizeEdge, tick: number) => void;
  onClearSelection: () => void;
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
  startGroupId: string | null;
  extend: boolean;
  resizeEdge?: SelectionResizeEdge;
  lastResizeTick?: number;
}

const EMPTY_STAFF_GEOMETRY: ScoreStaffGeometry = { right: null, left: null };
const HANDS: Hand[] = ["right", "left"];
const SELECTION_ACTION_TOP_OFFSET = 28;
const SELECTION_ACTION_BOTTOM_OFFSET = 4;

interface SelectionAction {
  key: string;
  x: number;
  y: number;
  label: string;
  icon: "up" | "down";
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

export default function ScoreViewer({
  score,
  activeGroups,
  followActive,
  selectedIds,
  hoveredId,
  loopGroupIds,
  pressedNotes,
  onGroupHover,
  onGroupSelect,
  onBoxSelect,
  onExpandSelectionToBothHands,
  onShrinkSelectionToHand,
  onResizeSelectionBoundary,
  onClearSelection,
}: ScoreViewerProps) {
  const osmdHostRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const pointerRef = useRef<PointerSession | null>(null);
  const longPressRef = useRef<number | null>(null);
  const svgTargetsByGroupRef = useRef<Map<string, Element[]>>(new Map());
  const coloredElementsRef = useRef<Set<Element>>(new Set());
  const [layouts, setLayouts] = useState<ScoreGroupLayout[]>([]);
  const [surfaceSize, setSurfaceSize] = useState({ width: 1600, height: 360 });
  const [scoreFrame, setScoreFrame] = useState({ top: 0, height: 260 });
  const [staffGeometry, setStaffGeometry] = useState<ScoreStaffGeometry>(EMPTY_STAFF_GEOMETRY);
  const [selectionBox, setSelectionBox] = useState<GroupLayout | null>(null);
  const [scrollProgress, setScrollProgress] = useState(1);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [activeResizeEdge, setActiveResizeEdge] = useState<SelectionResizeEdge | null>(null);
  const layoutById = useMemo(() => new Map(layouts.map((layout) => [layout.groupId, layout])), [layouts]);
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

    if (selectedHands.length === 1 && selectedHands[0] === "right" && hasHandInRange("left") && rightBounds) {
      actions.push({
        key: "expand-down",
        x: centerX,
        y: rightBounds.y + rightBounds.height + SELECTION_ACTION_BOTTOM_OFFSET,
        label: "扩选到左右手",
        icon: "down",
        onClick: onExpandSelectionToBothHands,
      });
    }

    if (selectedHands.length === 1 && selectedHands[0] === "left" && hasHandInRange("right") && leftBounds) {
      actions.push({
        key: "expand-up",
        x: centerX,
        y: Math.max(4, leftBounds.y - SELECTION_ACTION_TOP_OFFSET),
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
          y: Math.max(4, rightBounds.y - SELECTION_ACTION_TOP_OFFSET),
          label: "仅保留低音",
          icon: "down",
          onClick: () => onShrinkSelectionToHand("left"),
        });
      }

      if (leftBounds) {
        actions.push({
          key: "shrink-right",
          x: centerX,
          y: leftBounds.y + leftBounds.height + SELECTION_ACTION_BOTTOM_OFFSET,
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
    selectedGroups,
    selectedHands,
    selectedIdSet,
  ]);

  const progressX = useMemo(() => {
    return medianNumber(
      activeGroups
        .map((group) => layoutById.get(group.id)?.timeX)
        .filter((x): x is number => x != null),
    );
  }, [activeGroups, layoutById]);

  useEffect(() => {
    let disposed = false;
    let animationFrameId: number | null = null;
    const host = osmdHostRef.current;
    if (!host) {
      return;
    }

    host.replaceChildren();
    svgTargetsByGroupRef.current = new Map();
    setLayouts([]);
    setSurfaceSize({ width: 1600, height: 360 });
    setScoreFrame({ top: 0, height: 260 });
    setStaffGeometry(EMPTY_STAFF_GEOMETRY);
    setScrollProgress(1);
    setRenderError(null);

    if (!score) {
      return;
    }

    const failCurrentRender = () => {
      if (disposed) {
        return;
      }

      host.replaceChildren();
      svgTargetsByGroupRef.current = new Map();
      setLayouts([]);
      setRenderError("谱面渲染失败");
    };

    void import("opensheetmusicdisplay")
      .then(async ({ OpenSheetMusicDisplay }) => {
        const osmd = new OpenSheetMusicDisplay(host, {
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

        await osmd.load(prepareMusicXmlForPracticeDisplay(score.xml), score.title);
        if (disposed) {
          return;
        }

        osmd.Zoom = 1.05;
        osmd.render();

        const measureAndPlace = () => {
          if (disposed) {
            return;
          }

          try {
            const svg = host.querySelector("svg") as SVGSVGElement | null;
            const overlay = overlayRef.current;
            if (!svg || !overlay) {
              return;
            }

            svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
            svg.style.display = "block";

            const rect = svg.getBoundingClientRect();
            const hostRect = host.getBoundingClientRect();
            const viewportHeight = scrollRef.current?.clientHeight ?? hostRect.height;
            const desiredWidth = hostRect.width * 0.68;
            if (rect.width > 0 && rect.width < desiredWidth && osmd.Zoom < 2.3) {
              osmd.Zoom = Math.min(2.3, osmd.Zoom * (desiredWidth / rect.width));
              osmd.render();
              animationFrameId = requestAnimationFrame(measureAndPlace);
              return;
            }

            const overlayLayout = buildScoreOverlayLayout(host, overlay, svg, osmd, score, viewportHeight);
            svgTargetsByGroupRef.current = overlayLayout.svgTargets;
            setLayouts(overlayLayout.layouts);
            setScoreFrame(overlayLayout.scoreFrame);
            setStaffGeometry(overlayLayout.staffGeometry);
            setSurfaceSize(overlayLayout.surfaceSize);
          } catch {
            failCurrentRender();
          }
        };

        animationFrameId = requestAnimationFrame(measureAndPlace);
      })
      .catch(() => {
        failCurrentRender();
      });

    return () => {
      disposed = true;
      if (animationFrameId != null) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [score]);

  useEffect(() => {
    if (!followActive || !activeGroups.length || progressX == null || !scrollRef.current) {
      return;
    }

    const scroll = scrollRef.current;
    const targetLeft = Math.max(0, progressX - scroll.clientWidth * 0.38);
    scroll.scrollTo({ left: targetLeft, behavior: "smooth" });
  }, [activeGroups.length, followActive, progressX]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) {
      return;
    }

    const updateProgress = () => {
      const total = scroll.scrollWidth;
      const viewport = scroll.clientWidth;
      if (total <= viewport) {
        setScrollProgress(1);
        return;
      }

      setScrollProgress(Math.max(0, Math.min(1, scroll.scrollLeft / (total - viewport))));
    };

    updateProgress();
    scroll.addEventListener("scroll", updateProgress, { passive: true });
    window.addEventListener("resize", updateProgress);
    return () => {
      scroll.removeEventListener("scroll", updateProgress);
      window.removeEventListener("resize", updateProgress);
    };
  }, [surfaceSize.width]);

  useEffect(() => {
    for (const element of coloredElementsRef.current) {
      element.querySelectorAll("path, rect, text").forEach((child) => {
        (child as SVGElement).style.fill = "";
        (child as SVGElement).style.stroke = "";
      });
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
        element.querySelectorAll("path, rect, text").forEach((child) => {
          const svgChild = child as SVGElement;
          const fill = svgChild.getAttribute("fill");
          const stroke = svgChild.getAttribute("stroke");
          if (fill !== "none") {
            svgChild.style.fill = "#2563eb";
          }
          if (stroke !== "none") {
            svgChild.style.stroke = "#2563eb";
          }
        });
        coloredElementsRef.current.add(element);
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

    const rect = overlay.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
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

  function clearLongPress() {
    if (longPressRef.current != null) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
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

    const selected = layouts.filter((layout) => rectsIntersect(box, layout)).map((layout) => layout.groupId);
    onBoxSelect(selected);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const resizeEdge = target.closest<HTMLElement>("[data-selection-resize-edge]")?.dataset.selectionResizeEdge;
    const targetGroupId = target.closest<HTMLElement>("[data-group-id]")?.dataset.groupId ?? null;
    const point = getLocalPoint(event);
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
        startGroupId: null,
        extend: false,
        resizeEdge,
      };
      updateSelectionResize(pointerRef.current);
      return;
    }

    if (event.pointerType === "touch") {
      const session: PointerSession = {
        mode: "pan-pending",
        pointerId: event.pointerId,
        startX: point.x,
        startY: point.y,
        currentX: point.x,
        currentY: point.y,
        scrollLeft: scrollRef.current?.scrollLeft ?? 0,
        moved: false,
        startGroupId: targetGroupId,
        extend: event.shiftKey,
      };
      pointerRef.current = session;
      longPressRef.current = window.setTimeout(() => {
        if (pointerRef.current?.pointerId === event.pointerId) {
          pointerRef.current.mode = "select";
          updateSelectionBox(pointerRef.current);
        }
      }, 520);
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
      startGroupId: targetGroupId,
      extend: event.shiftKey,
    };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const session = pointerRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    const point = getLocalPoint(event);
    const dx = point.x - session.startX;
    const dy = point.y - session.startY;
    session.currentX = point.x;
    session.currentY = point.y;
    session.moved = session.moved || Math.abs(dx) > 6 || Math.abs(dy) > 6;

    if (session.mode === "resize-selection") {
      updateSelectionResize(session);
      return;
    }

    if (session.mode === "pan-pending" && session.moved) {
      clearLongPress();
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
    clearLongPress();
    pointerRef.current = null;

    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    if (session.mode === "resize-selection") {
      setActiveResizeEdge(null);
      return;
    }

    if (session.mode === "pan-pending" && !session.moved && session.startGroupId) {
      onGroupSelect(session.startGroupId, session.extend);
      return;
    }

    if (session.mode === "select") {
      finishSelection(session);
    }
  }

  return (
    <section className="score-panel" aria-label="乐谱">
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
        <div className="score-surface" style={{ width: surfaceSize.width }}>
          <div ref={osmdHostRef} className="osmd-host" />
          {renderError ? <div className="score-render-error">{renderError}</div> : null}
          <div
            ref={overlayRef}
            className={`score-overlay ${activeResizeEdge ? "resizing-selection" : ""}`}
            style={{ width: surfaceSize.width }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={() => onGroupHover(null)}
          >
            {score && scoreLayoutReady && followActive && activeGroups.length > 0 && progressX != null ? (
              <div
                className="progress-line"
                style={{ left: progressX, top: scoreFrame.top, height: scoreFrame.height }}
              />
            ) : null}

            {layouts.map((layout) => {
              const group = groupById.get(layout.groupId);
              if (!group) {
                return null;
              }

              return (
                <button
                  type="button"
                  data-group-id={group.id}
                  key={group.id}
                  className="note-hit-zone"
                  style={{
                    left: layout.x + HIT_GAP * 0.5,
                    top: layout.y,
                    width: Math.max(8, layout.width - HIT_GAP),
                    height: layout.height,
                  }}
                  onPointerEnter={() => onGroupHover(group.id)}
                  onPointerLeave={() => onGroupHover(null)}
                  aria-label={`${group.hand === "right" ? "右手" : "左手"} ${group.notes
                    .map((note) => note.name)
                    .join(" ")}`}
                />
              );
            })}

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

            {!selectionBox && selectionActions.map((action) => (
              <button
                type="button"
                key={action.key}
                className="selection-action-button"
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
                {action.icon === "up" ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
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
      {scoreLayoutReady ? (
        <div className="score-scroll-progress" aria-hidden="true">
          <div className="score-scroll-progress-bar" style={{ width: `${scrollProgress * 100}%` }} />
        </div>
      ) : null}
    </section>
  );
}
