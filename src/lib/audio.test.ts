import { describe, expect, it } from "vitest";
import type { NoteGroup } from "../types";
import { buildScoreRangePlaybackEvents } from "./audio";

function noteGroup(overrides: Partial<NoteGroup>): NoteGroup {
  return {
    id: "group-1",
    hand: "right",
    measureIndex: 0,
    startTick: 480,
    absoluteTick: 480,
    durationTicks: 240,
    notes: [{
      id: "note-1",
      midi: 60,
      name: "C4",
      hand: "right",
      staff: 1,
      measureIndex: 0,
      startTick: 480,
      absoluteTick: 480,
      durationTicks: 240,
      playbackEvents: [],
    }],
    playbackEvents: [],
    ...overrides,
  };
}

describe("buildScoreRangePlaybackEvents", () => {
  it("preserves leading silence relative to the selected score range", () => {
    expect(buildScoreRangePlaybackEvents([noteGroup({})], 0, 1920)).toEqual([{
      midis: [60],
      offsetTicks: 480,
      durationTicks: 240,
    }]);
  });

  it("adds note-level playback offsets to the group position", () => {
    const group = noteGroup({
      absoluteTick: 960,
      playbackEvents: [{ midis: [62], offsetTicks: 120, durationTicks: 180 }],
    });

    expect(buildScoreRangePlaybackEvents([group], 480, 1920)).toEqual([{
      midis: [62],
      offsetTicks: 600,
      durationTicks: 180,
    }]);
  });

  it("replays and clips a note that is already sounding at the range start", () => {
    const group = noteGroup({
      absoluteTick: 0,
      durationTicks: 1440,
      notes: [{
        ...noteGroup({}).notes[0],
        absoluteTick: 0,
        startTick: 0,
        durationTicks: 1440,
      }],
    });

    expect(buildScoreRangePlaybackEvents([group], 720, 1080)).toEqual([{
      midis: [60],
      offsetTicks: 0,
      durationTicks: 360,
    }]);
  });

  it("drops playback events that do not intersect the selected range", () => {
    expect(buildScoreRangePlaybackEvents([noteGroup({})], 0, 240)).toEqual([]);
  });
});
