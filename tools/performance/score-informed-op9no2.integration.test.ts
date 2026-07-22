import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildInterpretationPlaybackNotes } from "../../src/performance/interpretationPlayback";
import type { ScoreInterpretation } from "../../src/performance/types";
import type { ScoreInformedEvaluationReport } from "./automated-performance-validation";
import { loadCanonicalScore } from "./canonical-score";
import { evaluationPath, interpretationPath, scorePath } from "../project-paths";

const interpretationId = "chopin-op9-no2-seong-jin-cho-bv1ph4y117ty";
const evaluation = JSON.parse(readFileSync(evaluationPath(interpretationId), "utf8")) as ScoreInformedEvaluationReport;
const interpretation = JSON.parse(readFileSync(interpretationPath(interpretationId), "utf8")) as ScoreInterpretation;

describe("Op.9 No.2 score-informed transcription", () => {
  it("meets the measured global and difficult-section alignment gates", () => {
    expect(evaluation.algorithm).toBe("synctoolbox-mrmsdtw-score-informed-1");
    expect(evaluation.scoreAlignment.featureRate).toBe(50);
    expect(evaluation.scoreAlignment.anchorCount).toBeGreaterThan(500);
    expect(evaluation.scoreAlignment.medianChromaSimilarity).toBeGreaterThanOrEqual(0.75);
    expect(evaluation.scoreAlignment.p10ChromaSimilarity).toBeGreaterThanOrEqual(0.5);
    expect(evaluation.pianoAlignment.overall.scoreCoverage).toBeGreaterThanOrEqual(0.95);
    expect(evaluation.pianoAlignment.overall.performanceCoverage).toBeGreaterThanOrEqual(0.83);
    expect(evaluation.pianoAlignment.overall.onsetResidualMs.median).toBeLessThanOrEqual(40);
    expect(evaluation.pianoAlignment.overall.onsetResidualMs.p90).toBeLessThanOrEqual(120);
    expect(evaluation.pianoAlignment.overall.onsetResidualMs.p95).toBeLessThanOrEqual(180);
    expect(evaluation.pianoAlignment.sections["section-cadenza"].scoreCoverage).toBeGreaterThanOrEqual(0.89);
    expect(evaluation.pianoAlignment.sections["section-cadenza"].onsetResidualMs.p90).toBeLessThanOrEqual(120);
  });

  it("publishes a single-model interpretation with dense monotonic score-informed timing", () => {
    expect(interpretation.generation.models).toEqual([
      "piano-transcription-inference-0.0.6-note-pedal",
    ]);
    expect(interpretation.generation.algorithmVersion).toContain("synctoolbox-mrmsdtw-1");
    expect(interpretation.generation.validationPolicyVersion).toBe("score-informed-piano-alignment-1");
    expect(interpretation.generation.coverage.scoreCoverage).toBeGreaterThanOrEqual(0.95);
    expect(interpretation.noteExpressions.length).toBeGreaterThanOrEqual(1_160);
    expect(interpretation.timeMap.length).toBeGreaterThan(500);
    expect(interpretation.timeMap.every((anchor, index) =>
      index === 0 || anchor.timeUs > interpretation.timeMap[index - 1].timeUs)).toBe(true);
  });

  it("keeps standardized playback valid and monotonic in score order", async () => {
    const score = await loadCanonicalScore(scorePath("chopin-nocturne-op9-no2"));
    const playback = buildInterpretationPlaybackNotes(score, {
      start: { measureIndex: 0, offsetQuarter: { numerator: 0, denominator: 1 } },
      end: {
        measureIndex: score.measureDurations.length,
        offsetQuarter: { numerator: 0, denominator: 1 },
      },
    }, interpretation);
    const earliestByTick = new Map<number, number>();
    for (const note of playback) {
      earliestByTick.set(note.scoreTick, Math.min(earliestByTick.get(note.scoreTick) ?? note.onsetUs, note.onsetUs));
      expect(note.offsetUs).toBeGreaterThan(note.onsetUs);
    }
    const ordered = [...earliestByTick].sort((left, right) => left[0] - right[0]);
    expect(ordered.every((entry, index) => index === 0 || entry[1] >= ordered[index - 1][1])).toBe(true);
  });
});
