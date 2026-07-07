import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAYBACK_BPM,
  MAX_PLAYBACK_BPM,
  MIN_PLAYBACK_BPM,
  clampPlaybackBpm,
  ticksToMilliseconds,
} from "./playbackTiming";
import { TICKS_PER_QUARTER } from "../types";

describe("playbackTiming", () => {
  it("converts score ticks to elapsed time without quantizing short notes", () => {
    expect(ticksToMilliseconds(TICKS_PER_QUARTER, 120)).toBe(500);
    expect(ticksToMilliseconds(TICKS_PER_QUARTER / 2, 120)).toBe(250);
    expect(ticksToMilliseconds(TICKS_PER_QUARTER / 4, 120)).toBe(125);
  });

  it("keeps playback bpm inside the supported UI range", () => {
    expect(clampPlaybackBpm(0)).toBe(MIN_PLAYBACK_BPM);
    expect(clampPlaybackBpm(300)).toBe(MAX_PLAYBACK_BPM);
    expect(clampPlaybackBpm(Number.NaN)).toBe(DEFAULT_PLAYBACK_BPM);
  });
});
