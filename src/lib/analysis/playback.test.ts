import { describe, expect, it } from "vitest";
import type { Hand, NoteGroup, ScoreData } from "../../types";
import { analysisPlaybackGroups } from "./playback";

function group(id: string, hand: Hand, absoluteTick: number, durationTicks = 480): NoteGroup {
  return {
    id,
    hand,
    measureIndex: 0,
    startTick: absoluteTick,
    absoluteTick,
    durationTicks,
    notes: [],
    playbackEvents: [],
  };
}

const score: ScoreData = {
  title: "fixture",
  xml: "",
  noteGroups: [
    group("right-inside", "right", 0),
    group("left-inside", "left", 0),
    group("left-overlap", "left", -240, 480),
    group("left-after", "left", 480),
  ],
  measureStarts: [0],
  measureDurations: [960],
  measureTimeSignatures: [{ beats: 4, beatType: 4 }],
  totalTicks: 960,
  canSeparateHands: true,
  hasLeftHand: true,
  hasRightHand: true,
};

describe("analysis playback groups", () => {
  it("plays both hands for structural ranges", () => {
    expect(analysisPlaybackGroups(score, 0, 480, "section").map((item) => item.id)).toEqual([
      "right-inside",
      "left-inside",
      "left-overlap",
    ]);
  });

  it.each(["chord", "texture"] as const)("plays only the left hand for %s items", (kind) => {
    expect(analysisPlaybackGroups(score, 0, 480, kind).map((item) => item.id)).toEqual([
      "left-inside",
      "left-overlap",
    ]);
  });
});
