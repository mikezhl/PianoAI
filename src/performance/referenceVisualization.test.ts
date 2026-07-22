import { describe, expect, it } from "vitest";
import type { ReferenceInterpretation } from "./types";
import type { ScoreData } from "../types";
import { buildReferencePerformanceVisualization, pedalValueAtTick } from "./referenceVisualization";

const score: ScoreData = {
  title: "test",
  xml: "<score-partwise />",
  measureStarts: [0],
  measureDurations: [960],
  measureTimeSignatures: [{ beats: 2, beatType: 4 }],
  totalTicks: 960,
  canSeparateHands: true,
  hasLeftHand: true,
  hasRightHand: true,
  noteGroups: [
    {
      id: "right-chord",
      hand: "right",
      measureIndex: 0,
      startTick: 0,
      absoluteTick: 0,
      durationTicks: 480,
      playbackEvents: [],
      notes: [60, 64].map((midi, ordinalAtPosition) => ({
        id: `right-${midi}`,
        scoreRef: {
          partId: "P1",
          measureIndex: 0,
          offsetQuarter: { numerator: 0, denominator: 1 },
          staff: 1,
          voice: "1",
          writtenPitch: midi === 60 ? "C4" : "E4",
          ordinalAtPosition,
        },
        midi,
        name: midi === 60 ? "C4" : "E4",
        hand: "right" as const,
        staff: 1,
        measureIndex: 0,
        startTick: 0,
        absoluteTick: 0,
        durationTicks: 480,
        playbackEvents: [],
      })),
    },
    {
      id: "left-note",
      hand: "left",
      measureIndex: 0,
      startTick: 0,
      absoluteTick: 0,
      durationTicks: 480,
      playbackEvents: [],
      notes: [{
        id: "left-48",
        scoreRef: {
          partId: "P1",
          measureIndex: 0,
          offsetQuarter: { numerator: 0, denominator: 1 },
          staff: 2,
          voice: "5",
          writtenPitch: "C3",
          ordinalAtPosition: 0,
        },
        midi: 48,
        name: "C3",
        hand: "left",
        staff: 2,
        measureIndex: 0,
        startTick: 0,
        absoluteTick: 0,
        durationTicks: 480,
        playbackEvents: [],
      }],
    },
  ],
};

const reference: ReferenceInterpretation = {
  schemaVersion: "2.1.0",
  interpretationId: "test",
  performerId: "test",
  performerName: "Test",
  evidenceId: "test",
  score: { scoreId: "test", sourceHash: "hash", identitySource: "canonical-xml" },
  source: { title: "test", url: "test", kind: "original-recording" },
  audio: { url: "test", fileName: "test.wav", objectKey: `reference-audio/${"a".repeat(64)}.wav`, sha256: "hash", durationUs: 2_000_000, format: "audio/wav", sampleRate: 44_100, channels: 2, storage: "cloudflare-r2" },
  timeMap: [
    { scorePosition: { measureIndex: 0, offsetQuarter: { numerator: 0, denominator: 1 } }, timeUs: 0, confidence: 1 },
    { scorePosition: { measureIndex: 1, offsetQuarter: { numerator: 0, denominator: 1 } }, timeUs: 2_000_000, confidence: 1 },
  ],
  noteExpressions: score.noteGroups.flatMap((group) => group.notes).map((note, index) => ({
    kind: "performed" as const,
    scoreNoteRef: note.scoreRef,
    onsetUs: index * 20_000,
    releaseUs: index === 0 ? 800_000 : 900_000,
    intensity: index === 0 ? 0.8 : index === 1 ? 0.6 : 0.2,
    confidence: 0.9,
  })),
  pedals: { sustain: [{ timeUs: 250_000, value: 1 }, { timeUs: 1_250_000, value: 0 }] },
  generation: {
    status: "automatically-validated",
    algorithmVersion: "test",
    validationPolicyVersion: "test",
    models: ["test"],
    evaluationId: "test",
    evaluationSha256: `sha256:${"A".repeat(64)}`,
    dimensions: { dynamics: 1, "note-offset": 1, pedal: 1 },
    coverage: { scoreNotes: 3, matchedNotes: 3, ornamentGestures: 0, uncertainNotes: 0, extraEvents: 0, scoreCoverage: 1, performanceCoverage: 1 },
  },
};

describe("buildReferencePerformanceVisualization", () => {
  it("builds score-aligned note and pedal detail", () => {
    const result = buildReferencePerformanceVisualization(score, reference);
    expect(result.groups).toHaveLength(2);
    expect(result.groups.find((group) => group.groupId === "right-chord")?.intensity).toBeCloseTo(0.7);
    expect(result.groups.find((group) => group.groupId === "right-chord")?.durationRatio).toBeGreaterThan(0.7);
    expect(pedalValueAtTick(result.pedal, 200)).toBe(1);
    expect(pedalValueAtTick(result.pedal, 700)).toBe(0);
  });
});
