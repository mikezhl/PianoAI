import { describe, expect, it } from "vitest";
import type { ScoreRange } from "../../analysis/types";
import type { ScoreData } from "../../types";
import {
  normalizeMeasureLayoutsBySystem,
  playbackCursorAtTick,
  splitRangeBySystems,
  type AnalysisMeasureLayout,
} from "./layout";

function position(measureIndex: number, numerator = 0, denominator = 1) {
  return { measureIndex, offsetQuarter: { numerator, denominator } };
}

const layouts: AnalysisMeasureLayout[] = [
  { measureIndex: 1, systemIndex: 0, x: 20, y: 20, width: 100, height: 120 },
  { measureIndex: 2, systemIndex: 0, x: 120, y: 20, width: 100, height: 120 },
  { measureIndex: 3, systemIndex: 1, x: 20, y: 180, width: 100, height: 120 },
  { measureIndex: 4, systemIndex: 1, x: 120, y: 180, width: 100, height: 120 },
];

describe("analysis range layout", () => {
  it("normalizes every measure in one system to the same vertical bounds", () => {
    const normalized = normalizeMeasureLayoutsBySystem([
      { measureIndex: 1, systemIndex: 0, x: 20, y: 18, width: 100, height: 126, leftStaffY: 82, leftStaffHeight: 62 },
      { measureIndex: 2, systemIndex: 0, x: 120, y: 24, width: 100, height: 112, leftStaffY: 88, leftStaffHeight: 48 },
    ]);
    expect(normalized.map(({ y, height }) => ({ y, height }))).toEqual([
      { y: 18, height: 126 },
      { y: 18, height: 126 },
    ]);
    expect(normalized.map(({ leftStaffY, leftStaffHeight }) => ({ leftStaffY, leftStaffHeight }))).toEqual([
      { leftStaffY: 82, leftStaffHeight: 62 },
      { leftStaffY: 82, leftStaffHeight: 62 },
    ]);
  });

  it("uses one stable height across systems", () => {
    const normalized = normalizeMeasureLayoutsBySystem([
      { measureIndex: 1, systemIndex: 0, x: 20, y: 20, width: 100, height: 100, leftStaffY: 70, leftStaffHeight: 50 },
      { measureIndex: 2, systemIndex: 1, x: 20, y: 180, width: 100, height: 140, leftStaffY: 250, leftStaffHeight: 70 },
    ]);
    expect(normalized.map((layout) => layout.height)).toEqual([120, 120]);
    expect(normalized.map((layout) => layout.leftStaffHeight)).toEqual([60, 60]);
  });

  it("splits a range at system boundaries", () => {
    const range: ScoreRange = { start: position(1), end: position(5) };
    expect(splitRangeBySystems(range, layouts)).toEqual([
      expect.objectContaining({ systemIndex: 0, startMeasureIndex: 1, endMeasureIndex: 2, x: 20, width: 200 }),
      expect.objectContaining({ systemIndex: 1, startMeasureIndex: 3, endMeasureIndex: 4, x: 20, width: 200 }),
    ]);
  });

  it("uses quarter offsets for partial-measure ranges", () => {
    const range: ScoreRange = { start: position(1, 3, 1), end: position(2, 3, 1) };
    const [segment] = splitRangeBySystems(range, layouts, [6, 6, 6, 6, 6]);
    expect(segment.x).toBe(70);
    expect(segment.width).toBe(100);
  });

  it("uses engraved left-staff positions for chord boundaries", () => {
    const anchoredLayouts: AnalysisMeasureLayout[] = [{
      measureIndex: 1,
      systemIndex: 0,
      x: 20,
      y: 20,
      width: 180,
      height: 120,
      leftStaffAnchors: [
        { offsetQuarter: 0, x: 40 },
        { offsetQuarter: 1, x: 60 },
        { offsetQuarter: 2, x: 100 },
        { offsetQuarter: 3, x: 150 },
        { offsetQuarter: 4, x: 165 },
        { offsetQuarter: 5, x: 180 },
      ],
    }];
    const firstBeat: ScoreRange = { start: position(1), end: position(1, 3, 1) };
    const secondHalf: ScoreRange = { start: position(1, 3, 1), end: position(2) };

    expect(splitRangeBySystems(firstBeat, anchoredLayouts, [0, 6], "left-staff")[0]).toMatchObject({
      x: 30,
      width: 95,
    });
    expect(splitRangeBySystems(secondHalf, anchoredLayouts, [0, 6], "left-staff")[0]).toMatchObject({
      x: 125,
      width: 75,
    });
  });

  it("keeps beat ranges distinct after the final engraved anchor", () => {
    const anchoredLayouts: AnalysisMeasureLayout[] = [{
      measureIndex: 1,
      systemIndex: 0,
      x: 20,
      y: 20,
      width: 180,
      height: 120,
      leftStaffAnchors: [
        { offsetQuarter: 0, x: 40 },
        { offsetQuarter: 1, x: 80 },
      ],
    }];

    const secondBeat: ScoreRange = { start: position(1, 1), end: position(1, 2) };
    const thirdBeat: ScoreRange = { start: position(1, 2), end: position(1, 3) };
    const fourthBeat: ScoreRange = { start: position(1, 3), end: position(2) };
    const segments = [secondBeat, thirdBeat, fourthBeat].map((range) => (
      splitRangeBySystems(range, anchoredLayouts, [0, 4], "left-staff")[0]
    ));

    expect(segments.every((segment) => segment.width > 20)).toBe(true);
    expect(segments[0].x).toBeLessThan(segments[1].x);
    expect(segments[1].x).toBeLessThan(segments[2].x);
  });

  it("moves through a leading rest before the first engraved anchor", () => {
    const leadingRestLayout: AnalysisMeasureLayout[] = [{
      measureIndex: 1,
      systemIndex: 0,
      x: 20,
      y: 20,
      width: 180,
      height: 120,
      leftStaffAnchors: [
        { offsetQuarter: 1, x: 80 },
        { offsetQuarter: 2, x: 120 },
      ],
    }];
    const firstHalf: ScoreRange = { start: position(1), end: position(1, 1, 2) };
    const secondHalf: ScoreRange = { start: position(1, 1, 2), end: position(1, 1) };
    const first = splitRangeBySystems(firstHalf, leadingRestLayout, [0, 4], "left-staff")[0];
    const second = splitRangeBySystems(secondHalf, leadingRestLayout, [0, 4], "left-staff")[0];

    expect(first.width).toBeGreaterThan(1);
    expect(second.width).toBeGreaterThan(1);
    expect(first.x).toBeLessThan(second.x);
  });

  it("moves the playback cursor horizontally with score ticks", () => {
    const score: ScoreData = {
      title: "fixture",
      xml: "",
      noteGroups: [],
      measureStarts: [0, 2880],
      measureDurations: [2880, 2880],
      measureTimeSignatures: [
        { beats: 6, beatType: 8 },
        { beats: 6, beatType: 8 },
      ],
      totalTicks: 5760,
      canSeparateHands: true,
      hasLeftHand: true,
      hasRightHand: true,
    };
    const cursorLayouts: AnalysisMeasureLayout[] = [
      { measureIndex: 0, systemIndex: 0, x: 20, y: 30, width: 120, height: 100 },
      { measureIndex: 1, systemIndex: 1, x: 20, y: 180, width: 120, height: 100 },
    ];
    expect(playbackCursorAtTick(score, cursorLayouts, 0)?.x).toBe(20);
    expect(playbackCursorAtTick(score, cursorLayouts, 1440)?.x).toBe(80);
    expect(playbackCursorAtTick(score, cursorLayouts, 2880)).toMatchObject({ systemIndex: 1, x: 20 });
  });

  it("uses engraved time anchors for the playback cursor", () => {
    const score: ScoreData = {
      title: "fixture",
      xml: "",
      noteGroups: [],
      measureStarts: [0],
      measureDurations: [1920],
      measureTimeSignatures: [{ beats: 4, beatType: 4 }],
      totalTicks: 1920,
      canSeparateHands: true,
      hasLeftHand: true,
      hasRightHand: true,
    };
    const anchoredLayouts: AnalysisMeasureLayout[] = [{
      measureIndex: 0,
      systemIndex: 0,
      x: 20,
      y: 30,
      width: 180,
      height: 100,
      leftStaffAnchors: [
        { offsetQuarter: 0, x: 40 },
        { offsetQuarter: 1, x: 60 },
        { offsetQuarter: 2, x: 110 },
        { offsetQuarter: 3, x: 170 },
      ],
    }];

    expect(playbackCursorAtTick(score, anchoredLayouts, 480)?.x).toBe(60);
    expect(playbackCursorAtTick(score, anchoredLayouts, 1440)?.x).toBe(170);
  });
});
