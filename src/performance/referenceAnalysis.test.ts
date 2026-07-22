import { describe, expect, it } from "vitest";
import type { ScoreData } from "../types";
import {
  aggregateReferencePerformanceSummaries,
  buildReferencePerformanceSummary,
  getReferenceAnalysisCapabilities,
} from "./referenceAnalysis";
import type { ReferenceInterpretation } from "./types";

const range = {
  start: { measureIndex: 0, offsetQuarter: { numerator: 0, denominator: 1 } },
  end: { measureIndex: 1, offsetQuarter: { numerator: 0, denominator: 1 } },
};
const scoreRef = (staff: number, writtenPitch: string, ordinalAtPosition: number) => ({
  partId: "P1",
  measureIndex: 0,
  offsetQuarter: { numerator: 0, denominator: 1 },
  staff,
  voice: String(staff),
  writtenPitch,
  ordinalAtPosition,
});
const score = {
  title: "fixture",
  xml: "",
  noteGroups: [
    {
      id: "right",
      hand: "right" as const,
      measureIndex: 0,
      startTick: 0,
      absoluteTick: 0,
      durationTicks: 480,
      notes: [{
        id: "right-note",
        scoreRef: scoreRef(1, "C5", 0),
        midi: 72,
        name: "C5",
        hand: "right" as const,
        staff: 1,
        measureIndex: 0,
        startTick: 0,
        absoluteTick: 0,
        durationTicks: 480,
        playbackEvents: [],
      }],
      playbackEvents: [],
    },
    {
      id: "left",
      hand: "left" as const,
      measureIndex: 0,
      startTick: 0,
      absoluteTick: 0,
      durationTicks: 480,
      notes: [{
        id: "left-note",
        scoreRef: scoreRef(2, "C3", 0),
        midi: 48,
        name: "C3",
        hand: "left" as const,
        staff: 2,
        measureIndex: 0,
        startTick: 0,
        absoluteTick: 0,
        durationTicks: 480,
        playbackEvents: [],
      }],
      playbackEvents: [],
    },
  ],
  measureStarts: [0],
  measureDurations: [480],
  measureTimeSignatures: [{ beats: 4, beatType: 4 }],
  totalTicks: 480,
  canSeparateHands: true,
  hasLeftHand: true,
  hasRightHand: true,
} satisfies ScoreData;

function reference(): ReferenceInterpretation {
  return {
    schemaVersion: "2.1.0",
    interpretationId: "reference",
    score: { scoreId: "score", sourceHash: "hash", identitySource: "library-source" },
    performerId: "pianist",
    performerName: "Pianist",
    evidenceId: "audio",
    source: { title: "source", url: "https://example.com", kind: "original-recording" },
    audio: { url: "/audio.m4a", fileName: "reference.m4a", objectKey: `reference-audio/${"a".repeat(64)}.m4a`, sha256: "a", durationUs: 1_000_000, format: "audio/mp4", sampleRate: 48_000, channels: 2, storage: "cloudflare-r2" },
    generation: {
      status: "automatically-validated",
      algorithmVersion: "test",
      validationPolicyVersion: "test",
      models: ["model"],
      evaluationId: "reference",
      evaluationSha256: `sha256:${"A".repeat(64)}`,
      dimensions: { dynamics: 0.8, "note-offset": 0.8, pedal: 0.7 },
      coverage: { scoreNotes: 2, matchedNotes: 2, ornamentGestures: 0, uncertainNotes: 0, extraEvents: 0, scoreCoverage: 1, performanceCoverage: 1 },
    },
    timeMap: [
      { scorePosition: range.start, timeUs: 0, confidence: 1 },
      { scorePosition: range.end, timeUs: 1_000_000, confidence: 1 },
    ],
    noteExpressions: [
      {
        scoreNoteRef: scoreRef(1, "C5", 0),
        kind: "performed",
        onsetUs: 100_000,
        releaseUs: 900_000,
        intensity: 0.8,
        confidence: 0.95,
      },
      {
        scoreNoteRef: scoreRef(2, "C3", 0),
        kind: "performed",
        onsetUs: 120_000,
        releaseUs: 1_000_000,
        intensity: 0.4,
        confidence: 0.95,
      },
    ],
    pedals: { sustain: [
      { timeUs: 0, value: 1 },
      { timeUs: 500_000, value: 0 },
    ] },
  };
}

describe("professional reference analysis", () => {
  it("gates dimensions by automatic validation", () => {
    expect(getReferenceAnalysisCapabilities(reference())).toEqual({
      sectionTempo: true,
      dynamics: true,
      articulation: true,
      pedal: true,
    });
  });

  it("summarizes expression only inside the selected score range", () => {
    const summary = buildReferencePerformanceSummary(score, range, reference());
    expect(summary.intensityMedian).toBeCloseTo(0.6);
    expect(summary.upperStaffBalance).toBeCloseTo(0.4);
    expect(summary.durationRatioMedian).toBeCloseTo(0.84);
    expect(summary.pedalDownRatio).toBe(0.5);
  });

  it("aggregates multiple professional interpretations by median", () => {
    const summary = aggregateReferencePerformanceSummaries([
      { intensityMedian: 0.4, pedalDownRatio: 0.2 },
      { intensityMedian: 0.8, pedalDownRatio: 0.6 },
    ]);
    expect(summary.intensityMedian).toBeCloseTo(0.6);
    expect(summary.pedalDownRatio).toBeCloseTo(0.4);
  });
});
