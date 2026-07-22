import { describe, expect, it } from "vitest";
import type { ScoreData } from "../types";
import {
  scoreNoteRefId,
  scorePositionToTimelineTick,
  scorePositionToTick,
  scoreRangeToTickBounds,
  tickBoundsToScoreRange,
  tickToScorePosition,
  timelineTickToScorePosition,
  ticksToQuarterRational,
} from "./scoreIdentity";

const score = {
  title: "fixture",
  xml: "",
  noteGroups: [],
  measureStarts: [0, 480, 1920],
  measureDurations: [480, 1440, 960],
  measureTimeSignatures: [
    { beats: 3, beatType: 4 },
    { beats: 3, beatType: 4 },
    { beats: 2, beatType: 4 },
  ],
  totalTicks: 2880,
  canSeparateHands: true,
  hasLeftHand: true,
  hasRightHand: true,
} satisfies ScoreData;

describe("score identity", () => {
  it("stores score offsets as reduced rational quarter values", () => {
    expect(ticksToQuarterRational(720)).toEqual({ numerator: 3, denominator: 2 });
  });

  it("maps absolute ticks back to internal measure positions", () => {
    expect(tickToScorePosition(score, 1200)).toEqual({
      measureIndex: 1,
      offsetQuarter: { numerator: 3, denominator: 2 },
    });
    expect(tickBoundsToScoreRange(score, 480, 2880)).toEqual({
      start: { measureIndex: 1, offsetQuarter: { numerator: 0, denominator: 1 } },
      end: { measureIndex: 3, offsetQuarter: { numerator: 0, denominator: 1 } },
    });
    expect(scorePositionToTick(score, {
      measureIndex: 1,
      offsetQuarter: { numerator: 3, denominator: 2 },
    })).toBe(1200);
    expect(scoreRangeToTickBounds(score, {
      start: { measureIndex: 3, offsetQuarter: { numerator: 0, denominator: 1 } },
      end: { measureIndex: 1, offsetQuarter: { numerator: 0, denominator: 1 } },
    })).toEqual({ startTick: 480, endTick: 2880 });
  });

  it("builds deterministic note ids from stable score coordinates", () => {
    const ref = {
      partId: "P1",
      measureIndex: 3,
      offsetQuarter: { numerator: 1, denominator: 2 },
      staff: 1,
      voice: "1",
      writtenPitch: "Eb5",
      ordinalAtPosition: 0,
    };
    expect(scoreNoteRefId(ref)).toBe(scoreNoteRefId({ ...ref }));
    expect(scoreNoteRefId({ ...ref, writtenPitch: "D#5" })).not.toBe(scoreNoteRefId(ref));
    expect(scoreNoteRefId({ ...ref, playbackOccurrence: 1 })).not.toBe(scoreNoteRefId(ref));
    expect(scoreNoteRefId({ ...ref, partId: "P:1" })).not.toBe(scoreNoteRefId({ ...ref, partId: "P_3A1" }));
  });

  it("maps repeated written measures to distinct unfolded timeline positions", () => {
    const repeatedScore: ScoreData = {
      ...score,
      measurePlaybackOrder: [
        { measureIndex: 0, playbackOccurrence: 0, timelineStartTick: 0, durationTicks: 480 },
        { measureIndex: 1, playbackOccurrence: 0, timelineStartTick: 480, durationTicks: 1440 },
        { measureIndex: 1, playbackOccurrence: 1, timelineStartTick: 1920, durationTicks: 1440 },
        { measureIndex: 2, playbackOccurrence: 0, timelineStartTick: 3360, durationTicks: 960 },
      ],
      timelineTotalTicks: 4320,
    };
    expect(scorePositionToTimelineTick(repeatedScore, {
      measureIndex: 1,
      offsetQuarter: { numerator: 1, denominator: 1 },
      playbackOccurrence: 1,
    })).toBe(2400);
    expect(timelineTickToScorePosition(repeatedScore, 2400)).toEqual({
      measureIndex: 1,
      offsetQuarter: { numerator: 1, denominator: 1 },
      playbackOccurrence: 1,
    });
    expect(scorePositionToTick(
      repeatedScore,
      timelineTickToScorePosition(repeatedScore, 2400),
    )).toBe(960);
    expect(scorePositionToTimelineTick(repeatedScore, {
      ...tickToScorePosition(repeatedScore, 2160),
      playbackOccurrence: 0,
    })).toBe(3600);
  });
});
