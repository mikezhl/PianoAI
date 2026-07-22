import { describe, expect, it } from "vitest";
import {
  assertAutomatedPerformanceValidationConsistency,
  deriveAutomatedPerformanceValidation,
  type AutomatedPerformanceEvidence,
} from "./automated-performance-validation";

function evidence(): AutomatedPerformanceEvidence {
  return {
    evaluation: {
      schemaVersion: "2.0.0",
      scoreId: "score",
      audioSha256: "A".repeat(64),
      algorithm: "synctoolbox-mrmsdtw-score-informed-1",
      effectiveRangeSeconds: [0, 1],
      timeMap: [
        { scorePosition: { measureIndex: 0, offsetQuarter: { numerator: 0, denominator: 1 } }, timeUs: 0, confidence: 0.9 },
        { scorePosition: { measureIndex: 1, offsetQuarter: { numerator: 0, denominator: 1 } }, timeUs: 1_000_000, confidence: 0.9 },
      ],
      scoreAlignment: {
        featureRate: 50,
        tuningOffsetCents: 0,
        audioFrames: 50,
        scoreFrames: 50,
        warpingPathFrames: 50,
        anchorCount: 40,
        medianChromaSimilarity: 0.82,
        p10ChromaSimilarity: 0.55,
        p90ChromaSimilarity: 0.95,
      },
      models: {
        pianoTranscriptionInference: {
          version: "piano-transcription-inference-0.0.6",
          noteCount: 1_000,
          pedalEventCount: 80,
        },
      },
      pianoAlignment: {
        overall: {
          matchedNotes: 950,
          substitutedNotes: 5,
          ornamentNotes: 4,
          omittedNotes: 40,
          extraNotes: 50,
          uncertainNotes: 1,
          scoreCoverage: 0.95,
          performanceCoverage: 0.91,
          confidence: 0.9,
          onsetResidualMs: { median: 30, p90: 110, p95: 150 },
        },
        sections: {},
      },
      limitations: [],
    },
    coverage: {
      scoreNotes: 10,
      matchedNotes: 9,
      ornamentGestures: 1,
      uncertainNotes: 0,
      extraEvents: 1,
      scoreCoverage: 1,
      performanceCoverage: 0.9,
    },
    noteExpressions: Array.from({ length: 10 }, (_, index): AutomatedPerformanceEvidence["noteExpressions"][number] => {
      const scoreNoteRef = {
        partId: "P1",
        measureIndex: index,
        offsetQuarter: { numerator: 0, denominator: 1 },
        staff: 1,
        voice: "1",
        writtenPitch: "C4",
        ordinalAtPosition: 0,
      };
      return index === 0
        ? {
            scoreNoteRef,
            kind: "ornament",
            realizations: [
              { pitch: 60, onsetUs: 0, releaseUs: 10, intensity: 0.5 },
              { pitch: 62, onsetUs: 10, releaseUs: 20, intensity: 0.5 },
            ],
            realizationKind: "trill",
            confidence: 0.9,
          }
        : {
            scoreNoteRef,
            kind: "performed",
            onsetUs: index * 1_000,
            releaseUs: index * 1_000 + 500,
            intensity: 0.5,
            confidence: 0.9,
          };
    }),
    pedals: {
      sustain: Array.from({ length: 40 }, (_, index) => ({
        timeUs: index * 1_000,
        value: index % 2 === 0 ? 1 : 0,
      })),
    },
    notatedGestureCount: 1,
  };
}

describe("automated performance validation", () => {
  it("enables every dimension supported by automatic model evidence", () => {
    const result = deriveAutomatedPerformanceValidation(evidence());
    expect(result.status).toBe("automatically-validated");
    expect(Object.keys(result.dimensions)).toEqual([
      "pitch", "note-onset", "note-offset", "pedal", "ornament", "dynamics",
    ]);
  });

  it("keeps weak score alignment as an automated candidate", () => {
    const weak = evidence();
    weak.evaluation.scoreAlignment.medianChromaSimilarity = 0.4;
    const result = deriveAutomatedPerformanceValidation(weak);
    expect(result.status).toBe("automated-candidate");
    expect(result.dimensions.pitch).toBeUndefined();
    expect(result.dimensions["note-onset"]).toBeUndefined();
  });

  it("publishes ornament analysis only when every notated gesture is realized", () => {
    const partial = evidence();
    const ornament = partial.noteExpressions[0];
    partial.notatedGestureCount = 10;
    partial.noteExpressions = Array.from({ length: 9 }, (_, index) => ({
      ...ornament,
      scoreNoteRef: { ...ornament.scoreNoteRef, measureIndex: index },
    }));
    expect(deriveAutomatedPerformanceValidation(partial).dimensions.ornament).toBeUndefined();
  });

  it("rejects stale published automatic metadata", () => {
    const result = deriveAutomatedPerformanceValidation(evidence());
    expect(() => assertAutomatedPerformanceValidationConsistency(result, {
      status: result.status,
      validationPolicyVersion: result.policyVersion,
      dimensions: { ...result.dimensions, dynamics: 0.1 },
    }, "reference")).toThrow("automatic performance confidence is stale");
  });
});
