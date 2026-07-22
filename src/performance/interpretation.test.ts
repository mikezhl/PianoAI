import { describe, expect, it } from "vitest";
import type { ScoreAnalysis } from "../analysis/types";
import type { ScoreData } from "../types";
import {
  buildTempoProfile,
  interpolatePerformanceTime,
  interpolateScoreTickAtPerformanceTime,
  interpretationRangeTickBounds,
} from "./interpretation";

const score: ScoreData = {
  title: "fixture",
  xml: "",
  noteGroups: [],
  measureStarts: [0, 480],
  measureDurations: [480, 480],
  measureTimeSignatures: [{ beats: 4, beatType: 4 }, { beats: 12, beatType: 8 }],
  totalTicks: 960,
  canSeparateHands: true,
  hasLeftHand: true,
  hasRightHand: true,
};

const analysis = {
  sections: [{
    id: "free",
    kind: "cadenza",
    range: {
      start: { measureIndex: 1, offsetQuarter: { numerator: 0, denominator: 1 } },
      end: { measureIndex: 2, offsetQuarter: { numerator: 0, denominator: 1 } },
    },
  }],
} as unknown as ScoreAnalysis;

describe("professional interpretation tempo", () => {
  it("maps score time and playback time in both directions", () => {
    const timeMap = [
      { scorePosition: { measureIndex: 0, offsetQuarter: { numerator: 0, denominator: 1 } }, timeUs: 100_000, confidence: 0.9 },
      { scorePosition: { measureIndex: 1, offsetQuarter: { numerator: 0, denominator: 1 } }, timeUs: 1_100_000, confidence: 0.8 },
    ];
    expect(interpolatePerformanceTime(score, timeMap, 240)?.timeUs).toBe(600_000);
    expect(interpolateScoreTickAtPerformanceTime(score, timeMap, 600_000)).toBe(240);
  });

  it("keeps metrical absolute tempo and does not invent BPM inside free time", () => {
    const profile = buildTempoProfile(score, [
      { scorePosition: { measureIndex: 0, offsetQuarter: { numerator: 0, denominator: 1 } }, timeUs: 0, confidence: 0.9 },
      { scorePosition: { measureIndex: 1, offsetQuarter: { numerator: 0, denominator: 1 } }, timeUs: 500_000, confidence: 0.9 },
      { scorePosition: { measureIndex: 2, offsetQuarter: { numerator: 0, denominator: 1 } }, timeUs: 1_500_000, confidence: 0.8 },
    ], analysis);
    expect(profile[0]).toMatchObject({ quarterBpm: 120, metricalBeatBpm: 120, tempoMode: "metrical" });
    expect(profile[1]).toMatchObject({ tempoMode: "free-time", metricalBeat: { numerator: 3, denominator: 2 } });
    expect(profile[1]).not.toHaveProperty("quarterBpm");
  });

  it("keeps repeated score occurrences distinct on the unfolded timeline", () => {
    const repeatedScore: ScoreData = {
      ...score,
      measureStarts: [0, 480, 960, 1440],
      measureDurations: [480, 480, 480, 480],
      measureTimeSignatures: Array.from({ length: 4 }, () => ({ beats: 4, beatType: 4 })),
      totalTicks: 1920,
      timelineTotalTicks: 2880,
      measurePlaybackOrder: [
        { measureIndex: 0, playbackOccurrence: 0, timelineStartTick: 0, durationTicks: 480 },
        { measureIndex: 1, playbackOccurrence: 0, timelineStartTick: 480, durationTicks: 480 },
        { measureIndex: 2, playbackOccurrence: 0, timelineStartTick: 960, durationTicks: 480 },
        { measureIndex: 1, playbackOccurrence: 1, timelineStartTick: 1440, durationTicks: 480 },
        { measureIndex: 2, playbackOccurrence: 1, timelineStartTick: 1920, durationTicks: 480 },
        { measureIndex: 3, playbackOccurrence: 0, timelineStartTick: 2400, durationTicks: 480 },
      ],
    };
    const positions = [
      { measureIndex: 0, offsetQuarter: { numerator: 0, denominator: 1 }, playbackOccurrence: 0 },
      { measureIndex: 1, offsetQuarter: { numerator: 0, denominator: 1 }, playbackOccurrence: 0 },
      { measureIndex: 2, offsetQuarter: { numerator: 0, denominator: 1 }, playbackOccurrence: 0 },
      { measureIndex: 1, offsetQuarter: { numerator: 0, denominator: 1 }, playbackOccurrence: 1 },
      { measureIndex: 2, offsetQuarter: { numerator: 0, denominator: 1 }, playbackOccurrence: 1 },
      { measureIndex: 3, offsetQuarter: { numerator: 0, denominator: 1 }, playbackOccurrence: 0 },
      { measureIndex: 3, offsetQuarter: { numerator: 1, denominator: 1 }, playbackOccurrence: 0 },
    ];
    const profile = buildTempoProfile(repeatedScore, positions.map((scorePosition, index) => ({
      scorePosition,
      timeUs: index * 1_000_000,
      confidence: 1,
    })), null);
    expect(profile.map((sample) => [sample.scorePosition.measureIndex, sample.scorePosition.playbackOccurrence])).toEqual([
      [0, 0], [1, 0], [2, 0], [1, 1], [2, 1], [3, 0],
    ]);
    const interpretation = {
      schemaVersion: "2.1.0",
      interpretationId: "repeat",
      score: { scoreId: "score", sourceHash: "hash", identitySource: "library-source" },
      timeMap: positions.map((scorePosition, index) => ({
        scorePosition,
        timeUs: index * 1_000_000,
        confidence: 1,
      })),
      noteExpressions: [],
      pedals: { sustain: [] },
      generation: {
        status: "automated-candidate",
        algorithmVersion: "test",
        validationPolicyVersion: "test",
        models: ["test"],
        evaluationId: "repeat",
        evaluationSha256: `sha256:${"A".repeat(64)}`,
        dimensions: {},
        coverage: {
          scoreNotes: 0,
          matchedNotes: 0,
          ornamentGestures: 0,
          uncertainNotes: 0,
          extraEvents: 0,
          scoreCoverage: 0,
          performanceCoverage: 0,
        },
      },
    } satisfies import("./types").ScoreInterpretation;
    expect(interpretationRangeTickBounds(repeatedScore, {
      start: { measureIndex: 0, offsetQuarter: { numerator: 0, denominator: 1 } },
      end: { measureIndex: 4, offsetQuarter: { numerator: 0, denominator: 1 } },
    }, interpretation)).toEqual({ startTick: 0, endTick: 2880 });
  });
});
