import { describe, expect, it } from "vitest";
import type { Hand, ScoreData } from "../types";
import {
  buildContiguousTrackSegments,
  buildScoreHitIndex,
  getBoxSelectedGroupIds,
  getScoreGroupAtPoint,
  buildMeasureLayouts,
  buildScoreOverlayLayout,
  buildSelectedFrames,
  type ScoreGroupLayout,
} from "./scoreOverlay";

function expectContiguous(segments: Array<{ x: number; width: number }>, trackLeft: number, trackRight: number) {
  expect(segments[0].x).toBe(trackLeft);

  for (let index = 1; index < segments.length; index += 1) {
    expect(segments[index].x).toBeCloseTo(segments[index - 1].x + segments[index - 1].width, 5);
  }

  const last = segments[segments.length - 1];
  expect(last.x + last.width).toBeCloseTo(trackRight, 5);
}

function layout(
  groupId: string,
  hand: Hand,
  measureIndex: number,
  x: number,
  width: number,
): ScoreGroupLayout {
  const y = hand === "right" ? 20 : 120;

  return {
    groupId,
    hand,
    measureIndex,
    measureX: measureIndex * 100,
    measureRight: measureIndex * 100 + 100,
    startTick: x,
    glyphX: x,
    glyphY: y,
    glyphWidth: width,
    glyphHeight: 80,
    centerX: x + width / 2,
    timeX: x + width / 2,
    x,
    y,
    width,
    height: 80,
    segmentX: x,
    segmentWidth: width,
    frameX: x,
    frameY: y,
    frameWidth: width,
    frameHeight: 80,
  };
}

function mockRect(
  element: Element,
  { left, top, width, height }: { left: number; top: number; width: number; height: number },
) {
  Object.defineProperty(element, "getBoundingClientRect", {
    value: () => ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
    }),
  });
}

function appendStaff(
  svg: SVGSVGElement,
  lineYs: number[],
  measureLeft: number,
  measureWidth: number,
  notationTop = lineYs[0],
  notationBottom = lineYs.at(-1)!,
) {
  const staffLine = document.createElementNS("http://www.w3.org/2000/svg", "g");
  staffLine.classList.add("staffline");
  const measure = document.createElementNS("http://www.w3.org/2000/svg", "g");
  measure.classList.add("vf-measure");
  mockRect(measure, {
    left: measureLeft,
    top: notationTop,
    width: measureWidth,
    height: notationBottom - notationTop,
  });
  lineYs.forEach((top) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    mockRect(path, { left: measureLeft, top, width: measureWidth, height: 0 });
    measure.appendChild(path);
  });
  staffLine.appendChild(measure);
  svg.appendChild(staffLine);
  return measure;
}

describe("buildContiguousTrackSegments", () => {
  it("fills a track from start to end without gaps", () => {
    const segments = buildContiguousTrackSegments([
      { groupId: "a", startTick: 0, anchorX: 120, trackLeft: 100, trackRight: 500 },
      { groupId: "b", startTick: 480, anchorX: 260, trackLeft: 100, trackRight: 500 },
      { groupId: "c", startTick: 960, anchorX: 430, trackLeft: 100, trackRight: 500 },
    ]);

    expect(segments.map((segment) => segment.groupId)).toEqual(["a", "b", "c"]);
    expect(segments).toEqual([
      { groupId: "a", x: 100, width: 90 },
      { groupId: "b", x: 190, width: 155 },
      { groupId: "c", x: 345, width: 155 },
    ]);
    expectContiguous(segments, 100, 500);
  });

  it("gives a single note the whole measure track", () => {
    const segments = buildContiguousTrackSegments([
      { groupId: "only", startTick: 0, anchorX: 180, trackLeft: 40, trackRight: 260 },
    ]);

    expect(segments).toEqual([{ groupId: "only", x: 40, width: 220 }]);
  });

  it("orders segments by music time rather than anchor position", () => {
    const segments = buildContiguousTrackSegments([
      { groupId: "late", startTick: 480, anchorX: 140, trackLeft: 0, trackRight: 300 },
      { groupId: "early", startTick: 0, anchorX: 220, trackLeft: 0, trackRight: 300 },
    ]);

    expect(segments.map((segment) => segment.groupId)).toEqual(["early", "late"]);
    expectContiguous(segments, 0, 300);
    expect(segments.every((segment) => segment.width >= 0)).toBe(true);
  });

  it("keeps repeated anchor positions clickable without leaving the measure", () => {
    const segments = buildContiguousTrackSegments([
      { groupId: "a", startTick: 0, anchorX: 120, trackLeft: 100, trackRight: 180 },
      { groupId: "b", startTick: 240, anchorX: 160, trackLeft: 100, trackRight: 180 },
      { groupId: "c", startTick: 480, anchorX: 160, trackLeft: 100, trackRight: 180 },
    ]);

    expectContiguous(segments, 100, 180);
    expect(segments.every((segment) => segment.width >= 1)).toBe(true);
  });
});

describe("buildSelectedFrames", () => {
  it("merges single-hand selected frames across measure boundaries", () => {
    const layouts = [
      layout("r0", "right", 0, 0, 50),
      layout("r1", "right", 0, 50, 50),
      layout("r2", "right", 1, 100, 50),
    ];

    const frames = buildSelectedFrames(layouts, ["r0", "r1", "r2"]);

    expect(frames.map((frame) => ({ x: frame.x, width: frame.width }))).toEqual([
      { x: 0, width: 150 },
    ]);
  });

  it("merges two-hand selected frames across measure boundaries", () => {
    const layouts = [
      layout("r0", "right", 0, 0, 50),
      layout("l0", "left", 0, 0, 50),
      layout("r1", "right", 1, 100, 50),
      layout("l1", "left", 1, 100, 50),
    ];

    const frames = buildSelectedFrames(layouts, ["r0", "l0", "r1", "l1"], true);

    expect(frames.map((frame) => ({ x: frame.x, y: frame.y, width: frame.width, height: frame.height }))).toEqual([
      { x: 0, y: 20, width: 150, height: 180 },
    ]);
  });
});

describe("getBoxSelectedGroupIds", () => {
  it("does not select a neighboring track unless its rendered glyph intersects the box", () => {
    const layouts = [
      layout("r", "right", 0, 0, 100),
      layout("l", "left", 0, 0, 100),
    ];

    layouts[0].y = 20;
    layouts[0].height = 100;
    layouts[1].y = 120;
    layouts[1].height = 100;

    expect(getBoxSelectedGroupIds(layouts, { groupId: "box", x: 10, y: 119, width: 80, height: 40 })).toEqual(["l"]);
  });

  it("selects both hand tracks when the box covers both track centers", () => {
    const layouts = [
      layout("r", "right", 0, 0, 100),
      layout("l", "left", 0, 0, 100),
    ];

    layouts[0].y = 20;
    layouts[0].height = 100;
    layouts[1].y = 120;
    layouts[1].height = 100;

    expect(getBoxSelectedGroupIds(layouts, { groupId: "box", x: 10, y: 60, width: 80, height: 120 })).toEqual(["r", "l"]);
  });

  it("selects by rendered glyph bounds rather than the time segment box", () => {
    const layouts = [layout("r", "right", 0, 100, 20)];
    layouts[0].glyphX = 140;
    layouts[0].glyphY = 40;
    layouts[0].glyphWidth = 12;
    layouts[0].glyphHeight = 12;

    expect(getBoxSelectedGroupIds(layouts, { groupId: "box", x: 139, y: 39, width: 6, height: 14 })).toEqual(["r"]);
  });

  it("selects the lane time anchor when the notehead sits outside the drag box", () => {
    const layouts = [layout("low", "left", 0, 100, 40)];
    layouts[0].y = 245;
    layouts[0].height = 135;
    layouts[0].timeX = 120;
    layouts[0].glyphY = 420;
    layouts[0].glyphHeight = 12;

    expect(getBoxSelectedGroupIds(layouts, { groupId: "box", x: 110, y: 300, width: 20, height: 40 })).toEqual(["low"]);
  });

  it("does not select the next segment when the box only crosses the shared boundary", () => {
    const layouts = [
      layout("current", "left", 0, 100, 50),
      layout("next", "left", 0, 150, 50),
    ];
    layouts[1].timeX = 175;
    layouts[1].glyphX = 170;

    expect(getBoxSelectedGroupIds(layouts, { groupId: "box", x: 100, y: 140, width: 50.2, height: 40 })).toEqual([
      "current",
    ]);
  });
});

describe("score hit index", () => {
  it("finds a group without creating a DOM hit target for every note group", () => {
    const layouts = [
      layout("right", "right", 0, 0, 100),
      layout("left", "left", 0, 0, 100),
      layout("next", "right", 1, 100, 100),
    ];
    const index = buildScoreHitIndex(layouts, 64);

    expect(getScoreGroupAtPoint(index, 50, 40)?.groupId).toBe("right");
    expect(getScoreGroupAtPoint(index, 50, 160)?.groupId).toBe("left");
    expect(getScoreGroupAtPoint(index, 150, 40)?.groupId).toBe("next");
    expect(getScoreGroupAtPoint(index, 250, 40)).toBeNull();
  });

  it("chooses the glyph nearest to the pointer when hand bands overlap", () => {
    const upper = layout("upper", "right", 0, 0, 100);
    const lower = layout("lower", "left", 0, 0, 100);
    upper.y = 20;
    upper.height = 180;
    lower.y = 20;
    lower.height = 180;
    upper.glyphY = 50;
    lower.glyphY = 150;
    const index = buildScoreHitIndex([upper, lower]);

    expect(getScoreGroupAtPoint(index, 50, 155)?.groupId).toBe("lower");
  });
});

describe("buildMeasureLayouts", () => {
  it("uses the first rendered glyph as the shared boundary when no barline is matched", () => {
    const layouts = buildMeasureLayouts(
      [
        { x: 100, right: 200, begin: 0 },
        { x: 200, right: 320, begin: 0 },
      ],
      new Map([[1, 194]]),
    );

    expect(layouts[0]).toMatchObject({ x: 100, right: 194 });
    expect(layouts[1]).toMatchObject({ x: 194, right: 320 });
    expect(layouts[0].right).toBe(layouts[1].x);
  });

  it("uses a matched barline as the shared boundary even when the first glyph starts after it", () => {
    const layouts = buildMeasureLayouts(
      [
        { x: 100, right: 200, begin: 0 },
        { x: 205, right: 320, begin: 0 },
      ],
      new Map([[1, 205]]),
      [100, 194],
    );

    expect(layouts[0]).toMatchObject({ x: 100, right: 194 });
    expect(layouts[1]).toMatchObject({ x: 194, right: 320 });
    expect(layouts[0].right).toBe(layouts[1].x);
  });

  it("does not let a first glyph pull a barline-backed boundary to the left", () => {
    const layouts = buildMeasureLayouts(
      [
        { x: 100, right: 200, begin: 0 },
        { x: 205, right: 320, begin: 0 },
      ],
      new Map([[1, 190]]),
      [100, 194],
    );

    expect(layouts[0]).toMatchObject({ x: 100, right: 194 });
    expect(layouts[1]).toMatchObject({ x: 194, right: 320 });
    expect(layouts[0].right).toBe(layouts[1].x);
  });
});

describe("buildScoreOverlayLayout incremental boundary", () => {
  it("uses final SVG noteheads and staff lines instead of OSMD internal bounding boxes", () => {
    const host = document.createElement("div");
    const overlay = document.createElement("div");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    host.appendChild(svg);
    mockRect(host, { left: 10, top: 20, width: 500, height: 500 });
    mockRect(overlay, { left: 10, top: 20, width: 500, height: 500 });
    mockRect(svg, { left: 10, top: 20, width: 300, height: 400 });

    const rightMeasure = appendStaff(svg, [220, 230, 240, 250, 260], 60, 200, 180, 280);
    const leftMeasure = appendStaff(svg, [340, 350, 360, 370, 380], 60, 200, 300, 440);
    const direction = document.createElementNS("http://www.w3.org/2000/svg", "g");
    direction.classList.add("vf-text");
    mockRect(direction, { left: 60, top: 150, width: 80, height: 20 });
    rightMeasure.parentElement!.appendChild(direction);
    const pedalMark = document.createElementNS("http://www.w3.org/2000/svg", "g");
    pedalMark.classList.add("vf-text");
    mockRect(pedalMark, { left: 60, top: 450, width: 80, height: 10 });
    leftMeasure.parentElement!.appendChild(pedalMark);
    const note = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const notehead = document.createElementNS("http://www.w3.org/2000/svg", "g");
    notehead.classList.add("vf-notehead");
    const noteheadPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    mockRect(noteheadPath, { left: 130, top: 245, width: 12, height: 10 });
    notehead.appendChild(noteheadPath);
    note.appendChild(notehead);
    rightMeasure.appendChild(note);

    const score: ScoreData = {
      title: "svg coordinates",
      xml: "",
      noteGroups: [
        { id: "right", hand: "right", measureIndex: 0, startTick: 0, absoluteTick: 0, durationTicks: 480, notes: [], playbackEvents: [] },
      ],
      measureStarts: [0],
      measureDurations: [480],
      measureTimeSignatures: [{ beats: 4, beatType: 4 }],
      totalTicks: 480,
      canSeparateHands: true,
      hasLeftHand: true,
      hasRightHand: true,
    };
    const deliberatelyWrongShape = {
      AbsolutePosition: { x: 900, y: 900 },
      Size: { width: 90, height: 90 },
    };
    const entry = {
      PositionAndShape: deliberatelyWrongShape,
      relInMeasureTimestamp: { RealValue: 0 },
      graphicalVoiceEntries: [{
        notes: [{
          PositionAndShape: deliberatelyWrongShape,
          getVFNoteSVG: () => note,
        }],
      }],
    };
    const graphicalMeasure = (staffEntries: unknown[]) => ({
      PositionAndShape: deliberatelyWrongShape,
      parentSourceMeasure: { measureListIndex: 0, WasRendered: true },
      ParentStaffLine: { StaffHeight: 90 },
      staffEntries,
    });

    const result = buildScoreOverlayLayout(host, overlay, svg, {
      Zoom: 7,
      GraphicSheet: { MeasureList: [[graphicalMeasure([entry]), graphicalMeasure([])]] },
    }, score, 500, 0);
    const rendered = result.layouts[0];

    expect(rendered).toMatchObject({
      glyphX: 120,
      glyphY: 225,
      glyphWidth: 12,
      glyphHeight: 10,
      measureX: 50,
      measureRight: 250,
      frameY: 154,
      frameHeight: 126,
    });
    expect(result.staffGeometry.right?.lines).toEqual([200, 210, 220, 230, 240]);
    expect(result.staffGeometry.left?.lines).toEqual([320, 330, 340, 350, 360]);
    expect(result.staffGeometry.right).toMatchObject({
      noteTop: 160,
      noteBottom: 260,
      notationTop: 130,
      notationBottom: 260,
    });
    expect(result.staffGeometry.left).toMatchObject({
      noteTop: 280,
      noteBottom: 420,
      notationTop: 280,
      notationBottom: 440,
    });
    expect(result.scoreFrame).toEqual({ top: 154, height: 272 });
  });

  it("maps measures from every incrementally appended staff-line batch", () => {
    const host = document.createElement("div");
    const overlay = document.createElement("div");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    host.appendChild(svg);
    mockRect(host, { left: 0, top: 0, width: 500, height: 300 });
    mockRect(overlay, { left: 0, top: 0, width: 500, height: 300 });
    mockRect(svg, { left: 0, top: 0, width: 220, height: 220 });
    appendStaff(svg, [40, 50, 60, 70, 80], 0, 100);
    appendStaff(svg, [140, 150, 160, 170, 180], 0, 100);
    appendStaff(svg, [40, 50, 60, 70, 80], 100, 120);
    appendStaff(svg, [140, 150, 160, 170, 180], 100, 120);

    const score: ScoreData = {
      title: "multiple batches",
      xml: "",
      noteGroups: [
        { id: "first", hand: "right", measureIndex: 0, startTick: 0, absoluteTick: 0, durationTicks: 480, notes: [], playbackEvents: [] },
        { id: "second", hand: "right", measureIndex: 1, startTick: 0, absoluteTick: 480, durationTicks: 480, notes: [], playbackEvents: [] },
      ],
      measureStarts: [0, 480],
      measureDurations: [480, 480],
      measureTimeSignatures: [{ beats: 4, beatType: 4 }, { beats: 4, beatType: 4 }],
      totalTicks: 960,
      canSeparateHands: true,
      hasLeftHand: true,
      hasRightHand: true,
    };
    const graphicalMeasure = (measureIndex: number) => ({
      parentSourceMeasure: { measureListIndex: measureIndex, WasRendered: true },
      staffEntries: [],
    });

    const result = buildScoreOverlayLayout(host, overlay, svg, {
      GraphicSheet: {
        MeasureList: [
          [graphicalMeasure(0), graphicalMeasure(0)],
          [graphicalMeasure(1), graphicalMeasure(1)],
        ],
      },
    }, score, 300, 1);

    expect(result.layouts.map((item) => item.groupId)).toEqual(["first", "second"]);
    expect(result.layouts[0]).toMatchObject({ measureX: 0, measureRight: 100 });
    expect(result.layouts[1]).toMatchObject({ measureX: 100, measureRight: 220 });
  });

  it("excludes measures and groups that OSMD has not drawn yet", () => {
    const host = document.createElement("div");
    const overlay = document.createElement("div");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    host.appendChild(svg);
    svg.setAttribute("width", "100");
    Object.defineProperty(host, "getBoundingClientRect", { value: () => ({ left: 0, top: 0, width: 500, height: 300 }) });
    Object.defineProperty(overlay, "getBoundingClientRect", { value: () => ({ left: 0, top: 0, width: 500, height: 300 }) });
    Object.defineProperty(svg, "getBoundingClientRect", { value: () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }) });
    appendStaff(svg, [40, 50, 60, 70, 80], 0, 100);
    appendStaff(svg, [140, 150, 160, 170, 180], 0, 100);

    const shape = (x: number, y: number) => ({
      AbsolutePosition: { x, y },
      Size: { width: 10, height: 4 },
    });
    const graphicalMeasure = (measureIndex: number, rendered: boolean, y: number) => ({
      PositionAndShape: shape(measureIndex * 10, y),
      parentSourceMeasure: { measureListIndex: measureIndex, WasRendered: rendered },
      ParentStaffLine: { StaffHeight: 4 },
      staffEntries: [],
    });
    const score: ScoreData = {
      title: "incremental",
      xml: "",
      noteGroups: [
        { id: "drawn", hand: "right", measureIndex: 0, startTick: 0, absoluteTick: 0, durationTicks: 480, notes: [], playbackEvents: [] },
        { id: "pending", hand: "right", measureIndex: 1, startTick: 0, absoluteTick: 480, durationTicks: 480, notes: [], playbackEvents: [] },
      ],
      measureStarts: [0, 480],
      measureDurations: [480, 480],
      measureTimeSignatures: [{ beats: 4, beatType: 4 }, { beats: 4, beatType: 4 }],
      totalTicks: 960,
      canSeparateHands: true,
      hasLeftHand: true,
      hasRightHand: true,
    };

    const result = buildScoreOverlayLayout(host, overlay, svg, {
      Zoom: 1,
      GraphicSheet: {
        MeasureList: [
          [graphicalMeasure(0, true, 5), graphicalMeasure(0, true, 15)],
          [graphicalMeasure(1, false, 5), graphicalMeasure(1, false, 15)],
        ],
      },
    }, score, 300, 0);

    expect(result.layouts.map((item) => item.groupId)).toEqual(["drawn"]);
    expect(result.surfaceSize.width).toBe(500);
    expect(result.svgTargets.has("pending")).toBe(false);
  });
});
