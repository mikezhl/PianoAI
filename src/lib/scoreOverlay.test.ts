import { describe, expect, it } from "vitest";
import type { Hand } from "../types";
import {
  buildContiguousTrackSegments,
  getBoxSelectedGroupIds,
  buildMeasureLayouts,
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
