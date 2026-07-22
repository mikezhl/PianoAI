import { act, createElement, Profiler } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AnalysisSection } from "../../analysis/types";
import type { ScoreGroupLayout, ScoreStaffGeometry } from "../../lib/scoreOverlay";
import type { ReferencePerformanceVisualization } from "../../performance/referenceVisualization";
import type { ScoreData } from "../../types";
import PerformanceScoreOverlay, { formatMeasureLabel } from "./PerformanceScoreOverlay";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const score: ScoreData = {
  title: "test",
  xml: "",
  noteGroups: [
    { id: "right", hand: "right", measureIndex: 0, startTick: 0, absoluteTick: 0, durationTicks: 480, notes: [], playbackEvents: [] },
    { id: "left", hand: "left", measureIndex: 0, startTick: 480, absoluteTick: 480, durationTicks: 480, notes: [], playbackEvents: [] },
  ],
  measureStarts: [0],
  measureDurations: [960],
  measureTimeSignatures: [{ beats: 2, beatType: 4 }],
  totalTicks: 960,
  canSeparateHands: true,
  hasLeftHand: true,
  hasRightHand: true,
};

function layout(groupId: string, hand: "right" | "left", x: number, tick: number): ScoreGroupLayout {
  return {
    groupId,
    hand,
    measureIndex: 0,
    startTick: tick,
    x,
    y: hand === "right" ? 70 : 190,
    width: 24,
    height: 80,
    measureX: 70,
    measureRight: 520,
    glyphX: x,
    glyphY: hand === "right" ? 90 : 210,
    glyphWidth: 10,
    glyphHeight: 10,
    centerX: x,
    timeX: x,
    segmentX: x,
    segmentWidth: 20,
    frameX: x,
    frameY: hand === "right" ? 70 : 190,
    frameWidth: 20,
    frameHeight: 80,
  };
}

const layouts = [layout("right", "right", 100, 0), layout("left", "left", 300, 480)];
const staffGeometry: ScoreStaffGeometry = {
  right: {
    hand: "right",
    lines: [150, 160, 170, 180, 190],
    spacing: 10,
    top: 150,
    bottom: 190,
    noteTop: 135,
    noteBottom: 205,
    notationTop: 130,
    notationBottom: 205,
  },
  left: {
    hand: "left",
    lines: [260, 270, 280, 290, 300],
    spacing: 10,
    top: 260,
    bottom: 300,
    noteTop: 245,
    noteBottom: 315,
    notationTop: 245,
    notationBottom: 320,
  },
};
const visualization: ReferencePerformanceVisualization = {
  groups: [
    { groupId: "right", tick: 0, measureIndex: 0, hand: "right", intensity: 0.8, durationRatio: 0.5, confidence: 0.9 },
    { groupId: "left", tick: 480, measureIndex: 0, hand: "left", intensity: 0.4, durationRatio: 1, confidence: 0.9 },
  ],
  pedal: [{ tick: 0, value: 0 }, { tick: 120, value: 1 }, { tick: 720, value: 0 }, { tick: 960, value: 0 }],
};
const tempo = [
  {
    scorePosition: { measureIndex: 0, offsetQuarter: { numerator: 0, denominator: 1 } },
    quarterBpm: 60,
    normalizedTempoRatio: 0.8,
    metricalBeat: { numerator: 4, denominator: 4 },
    resolution: "measure" as const,
    confidence: 1,
    tempoMode: "metrical" as const,
  },
  {
    scorePosition: { measureIndex: 0, offsetQuarter: { numerator: 1, denominator: 1 } },
    quarterBpm: 90,
    normalizedTempoRatio: 1.2,
    metricalBeat: { numerator: 4, denominator: 4 },
    resolution: "measure" as const,
    confidence: 1,
    tempoMode: "metrical" as const,
  },
];
const pickupSections: AnalysisSection[] = [{
  id: "pickup",
  label: "弱起",
  kind: "pickup",
  range: {
    start: { measureIndex: 0, offsetQuarter: { numerator: 0, denominator: 1 } },
    end: { measureIndex: 0, offsetQuarter: { numerator: 1, denominator: 1 } },
  },
  summary: "",
  confidence: "high",
  layer: "structure",
  displayNumber: 0,
  tonality: "",
  understanding: "",
}];

let container: HTMLDivElement | null = null;

afterEach(() => {
  container?.remove();
  container = null;
});

async function renderOverview(
  tempoSamples = tempo,
  sections: AnalysisSection[] = [],
  visualizationData = visualization,
  layoutData = layouts,
  staffGeometryData = staffGeometry,
  surfaceHeightData = 500,
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let commitCount = 0;
  await act(async () => root.render(createElement(
    Profiler,
    { id: "performance-overlay", onRender: () => { commitCount += 1; } },
    createElement(PerformanceScoreOverlay, {
      score,
      layouts: layoutData,
      staffGeometry: staffGeometryData,
      scoreFrame: { top: 70, height: 200 },
      surfaceWidth: 600,
      surfaceHeight: surfaceHeightData,
      capabilities: {
        sectionTempo: true,
        dynamics: true,
        articulation: true,
        pedal: true,
      },
      tempo: tempoSamples,
      sections,
      visualization: visualizationData,
    }),
  )));
  return { root, element: container, getCommitCount: () => commitCount };
}

async function movePointer(element: Element, clientX: number) {
  await act(async () => element.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX })));
}

describe("PerformanceScoreOverlay", () => {
  it("positions interpretation lanes outside the rendered notation bounds", async () => {
    const rendered = await renderOverview();
    const baselines = rendered.element.querySelectorAll(".expression-baseline");
    const rightBaseline = Number(baselines[0].getAttribute("y1"));
    const leftBaseline = Number(baselines[1].getAttribute("y1"));
    expect(rightBaseline).toBeLessThan(staffGeometry.right!.notationTop);
    expect(leftBaseline).toBeGreaterThan(staffGeometry.left!.notationBottom);
    await act(async () => rendered.root.unmount());

    const shift = 25;
    const shiftedGeometry: ScoreStaffGeometry = {
      right: {
        ...staffGeometry.right!,
        lines: staffGeometry.right!.lines.map((line) => line + shift),
        top: staffGeometry.right!.top + shift,
        bottom: staffGeometry.right!.bottom + shift,
        noteTop: staffGeometry.right!.noteTop + shift,
        noteBottom: staffGeometry.right!.noteBottom + shift,
        notationTop: staffGeometry.right!.notationTop + shift,
        notationBottom: staffGeometry.right!.notationBottom + shift,
      },
      left: {
        ...staffGeometry.left!,
        lines: staffGeometry.left!.lines.map((line) => line + shift),
        top: staffGeometry.left!.top + shift,
        bottom: staffGeometry.left!.bottom + shift,
        noteTop: staffGeometry.left!.noteTop + shift,
        noteBottom: staffGeometry.left!.noteBottom + shift,
        notationTop: staffGeometry.left!.notationTop + shift,
        notationBottom: staffGeometry.left!.notationBottom + shift,
      },
    };
    const shifted = await renderOverview(tempo, [], visualization, layouts, shiftedGeometry);
    const shiftedBaselines = shifted.element.querySelectorAll(".expression-baseline");
    expect(Number(shiftedBaselines[0].getAttribute("y1"))).toBeGreaterThan(rightBaseline);
    expect(Number(shiftedBaselines[1].getAttribute("y1"))).toBeGreaterThan(leftBaseline);
    await act(async () => shifted.root.unmount());
  });

  it("compresses interpretation lanes into cramped whitespace without crossing the notation", async () => {
    const crampedGeometry: ScoreStaffGeometry = {
      right: {
        ...staffGeometry.right!,
        notationTop: 70,
        notationBottom: 145,
      },
      left: {
        ...staffGeometry.left!,
        notationTop: 195,
        notationBottom: 270,
      },
    };
    const rendered = await renderOverview(tempo, [], visualization, layouts, crampedGeometry, 360);
    const lanes = Array.from(rendered.element.querySelectorAll<HTMLElement>(".performance-overlay-hover-lane"));
    expect(lanes).toHaveLength(4);
    lanes.forEach((lane) => {
      const top = Number.parseFloat(lane.style.top);
      const height = Number.parseFloat(lane.style.height);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(top + height).toBeLessThanOrEqual(360);
    });
    await act(async () => rendered.root.unmount());
  });

  it("固定为综合视图，用竖柱高度表达力度并用粗细表达触键时值", async () => {
    const rendered = await renderOverview();
    expect(rendered.element.querySelector(".performance-score-overlay.overview")).not.toBeNull();
    expect(rendered.element.querySelectorAll(".tempo-change")).toHaveLength(2);
    expect(rendered.element.querySelectorAll(".expression-mark")).toHaveLength(2);
    const rightBar = rendered.element.querySelector(".expression-mark.right")!;
    const leftBar = rendered.element.querySelector(".expression-mark.left")!;
    const rightHeight = Number(rightBar.getAttribute("data-max-bar-height"));
    const leftHeight = Number(leftBar.getAttribute("data-max-bar-height"));
    const rightWidth = Number(rightBar.getAttribute("data-max-bar-width"));
    const leftWidth = Number(leftBar.getAttribute("data-max-bar-width"));
    expect(rightHeight).toBeGreaterThan(leftHeight);
    expect(rightHeight).toBeGreaterThan(26);
    expect(leftHeight).toBeGreaterThan(15);
    expect(leftWidth).toBeGreaterThan(rightWidth);
    expect(leftWidth / rightWidth).toBeGreaterThan(1.5);
    expect(Number(rendered.element.querySelector(".tempo-change")?.getAttribute("data-max-height"))).toBeGreaterThan(17);
    expect(rendered.element.querySelectorAll(".expression-baseline")).toHaveLength(2);
    expect(rendered.element.querySelector(".pedal-line")).not.toBeNull();
    expect(rendered.element.querySelectorAll(".performance-overlay-hover-lane.overview")).toHaveLength(4);
    await act(async () => rendered.root.unmount());
  });

  it("按 MusicXML 的印刷小节号显示弱起和重复编号段", () => {
    const numberedScore: ScoreData = {
      ...score,
      measureNumbers: ["0", "1", "32", "32", "33"],
    };

    expect(formatMeasureLabel(numberedScore, 0)).toBe("弱起");
    expect(formatMeasureLabel(numberedScore, 1)).toBe("第 1 小节");
    expect(formatMeasureLabel(numberedScore, 2)).toBe("第 32 小节（同号第 1 段）");
    expect(formatMeasureLabel(numberedScore, 3)).toBe("第 32 小节（同号第 2 段）");
  });

  it("极端速度在综合视图中按完整数据范围显示，不截断为箭头", async () => {
    const rendered = await renderOverview([
      { ...tempo[0], normalizedTempoRatio: 0.55 },
      { ...tempo[1], normalizedTempoRatio: 1.05 },
    ]);
    const extremeChange = rendered.element.querySelectorAll(".tempo-change")[0];
    expect(Number(extremeChange.getAttribute("data-max-height"))).toBeGreaterThan(20);
    expect(rendered.element.querySelector(".tempo-change-overflow")).toBeNull();
    await act(async () => rendered.root.unmount());
  });

  it("弱起区间不显示速度柱和悬停目标", async () => {
    const rendered = await renderOverview(tempo, pickupSections);
    expect(rendered.element.querySelectorAll(".tempo-change")).toHaveLength(1);
    const lanes = rendered.element.querySelectorAll(".performance-overlay-hover-lane.overview");
    expect(lanes).toHaveLength(4);
    await movePointer(lanes[0], 300);
    expect(rendered.element.querySelector(".performance-overlay-tooltip")?.textContent).toContain("90 BPM");
    await act(async () => rendered.root.unmount());
  });

  it("综合视图的悬停直接显示各维度当前位置数据且不会创建谱面选区", async () => {
    const rendered = await renderOverview();
    const lanes = rendered.element.querySelectorAll(".performance-overlay-hover-lane.overview");
    const tempoLane = lanes[0] as HTMLElement;
    expect(tempoLane).not.toBeNull();
    expect(rendered.element.querySelector(".performance-overlay-section-target")).toBeNull();
    const tooltip = rendered.element.querySelector(".performance-overlay-tooltip") as HTMLOutputElement;
    expect(tooltip.hidden).toBe(true);
    const commitCount = rendered.getCommitCount();
    await movePointer(tempoLane, 100);
    expect(rendered.element.querySelector(".performance-overlay-tooltip")).toBe(tooltip);
    expect(tooltip.hidden).toBe(false);
    expect(tooltip.textContent).toContain("60 BPM");
    expect(rendered.getCommitCount()).toBe(commitCount);
    expect(rendered.element.querySelector(".performance-overlay-focus")).toBeNull();
    await movePointer(lanes[1], 100);
    expect(tooltip.textContent).toContain("右手力度 80% · 触键时值 0.50×");
    await movePointer(lanes[3], 100);
    expect(tooltip.textContent).toContain("延音踏板抬起 · 深度 0%");
    await act(async () => tempoLane.click());
    await act(async () => tempoLane.dispatchEvent(new Event("pointerleave", { bubbles: true })));
    await act(async () => rendered.root.unmount());
  });

  it("聚焦悬停通道后可用方向键浏览全部数据点", async () => {
    const rendered = await renderOverview();
    const tempoLane = rendered.element.querySelectorAll(".performance-overlay-hover-lane.overview")[0] as HTMLElement;
    const tooltip = rendered.element.querySelector(".performance-overlay-tooltip") as HTMLOutputElement;

    await act(async () => tempoLane.focus());
    expect(tooltip.textContent).toContain("60 BPM");
    expect(tempoLane.getAttribute("aria-valuenow")).toBe("1");
    expect(tempoLane.getAttribute("aria-valuetext")).toContain("60 BPM");

    await act(async () => tempoLane.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(tooltip.textContent).toContain("90 BPM");
    expect(tempoLane.getAttribute("aria-valuenow")).toBe("2");
    expect(tempoLane.getAttribute("aria-valuetext")).toContain("90 BPM");

    await act(async () => tempoLane.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(tempoLane.getAttribute("aria-valuenow")).toBe("1");
    await act(async () => rendered.root.unmount());
  });
});
