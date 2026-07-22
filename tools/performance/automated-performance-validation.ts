import type {
  InterpretationCoverage,
  NoteExpression,
  PianoPedals,
  PerformanceTimeAnchor,
  ReferenceValidationDimension,
} from "../../src/performance/types";

const AUTOMATED_PERFORMANCE_POLICY_VERSION = "score-informed-piano-alignment-1";

export interface PianoAlignmentMetrics {
  matchedNotes: number;
  substitutedNotes: number;
  ornamentNotes: number;
  omittedNotes: number;
  extraNotes: number;
  uncertainNotes: number;
  scoreCoverage: number;
  performanceCoverage: number;
  confidence: number;
  onsetResidualMs: {
    median: number;
    p90: number;
    p95: number;
  };
}

export interface ScoreInformedEvaluationReport {
  schemaVersion: "2.0.0";
  scoreId: string;
  audioSha256: string;
  algorithm: string;
  effectiveRangeSeconds: [number, number];
  timeMap: PerformanceTimeAnchor[];
  scoreAlignment: {
    featureRate: number;
    tuningOffsetCents: number;
    audioFrames: number;
    scoreFrames: number;
    warpingPathFrames: number;
    anchorCount: number;
    medianChromaSimilarity: number;
    p10ChromaSimilarity: number;
    p90ChromaSimilarity: number;
  };
  models: {
    pianoTranscriptionInference: {
      version: string;
      noteCount: number;
      pedalEventCount: number;
    };
  };
  pianoAlignment: {
    overall: PianoAlignmentMetrics;
    sections: Record<string, PianoAlignmentMetrics>;
  };
  limitations: string[];
}

export interface AutomatedPerformanceEvidence {
  evaluation: ScoreInformedEvaluationReport;
  coverage: InterpretationCoverage;
  noteExpressions: NoteExpression[];
  pedals: PianoPedals;
  notatedGestureCount: number;
}

export interface AutomatedPerformanceValidation {
  status: "automated-candidate" | "automatically-validated";
  policyVersion: typeof AUTOMATED_PERFORMANCE_POLICY_VERSION;
  dimensions: Partial<Record<ReferenceValidationDimension, number>>;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`Automatic performance evidence missing ${label}`);
  return value;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function rounded(value: number): number {
  return Math.round(clamp(value) * 10_000) / 10_000;
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function deriveAutomatedPerformanceValidation(
  evidence: AutomatedPerformanceEvidence,
): AutomatedPerformanceValidation {
  const alignment = evidence.evaluation.scoreAlignment;
  const pianoAlignment = evidence.evaluation.pianoAlignment.overall;
  const scoreCoverage = finite(evidence.coverage.scoreCoverage, "score coverage");
  const onsetMedianMs = finite(pianoAlignment.onsetResidualMs.median, "onset residual median");
  const onsetP90Ms = finite(pianoAlignment.onsetResidualMs.p90, "onset residual P90");
  const chromaMedian = finite(alignment.medianChromaSimilarity, "median chroma similarity");
  const chromaP10 = finite(alignment.p10ChromaSimilarity, "P10 chroma similarity");

  const trustedExpressions = evidence.noteExpressions.filter((expression) =>
    expression.confidence >= 0.75);
  const dynamicsExpressions = trustedExpressions.filter((expression) =>
    expression.intensity != null
    || expression.realizations?.some((realization) => realization.intensity != null));
  const durationExpressions = trustedExpressions.filter((expression) =>
    expression.onsetUs != null
    && expression.releaseUs != null
    && expression.releaseUs > expression.onsetUs);
  const realizedGestures = evidence.noteExpressions.filter((expression) =>
    expression.kind === "ornament"
    && (expression.realizations?.length ?? 0) >= 2);
  const pedalChanges = evidence.pedals.sustain;

  const scoreAlignmentPassed = alignment.anchorCount >= 32
    && chromaMedian >= 0.65
    && chromaP10 >= 0.35;
  const pitchPassed = scoreAlignmentPassed
    && scoreCoverage >= 0.85
    && evidence.coverage.matchedNotes >= Math.min(100, Math.ceil(evidence.coverage.scoreNotes * 0.75));
  const noteOnsetPassed = pitchPassed
    && pianoAlignment.scoreCoverage >= 0.85
    && onsetMedianMs <= 60
    && onsetP90Ms <= 180;
  const durationCoverage = durationExpressions.length / Math.max(1, trustedExpressions.length);
  const noteOffsetPassed = noteOnsetPassed && durationCoverage >= 0.75;
  const pedalPassed = evidence.evaluation.models.pianoTranscriptionInference.pedalEventCount >= 16
    && pedalChanges.length >= 32;
  const ornamentCoverage = evidence.notatedGestureCount > 0
    ? realizedGestures.length / evidence.notatedGestureCount
    : 0;
  const ornamentPassed = evidence.notatedGestureCount > 0
    && realizedGestures.length === evidence.notatedGestureCount;
  const dynamicsCoverage = evidence.coverage.scoreCoverage > 0
    ? dynamicsExpressions.length / Math.max(1, evidence.coverage.scoreNotes)
    : 0;
  const dynamicsPassed = pitchPassed && dynamicsCoverage >= 0.6;

  const dimensions: Partial<Record<ReferenceValidationDimension, number>> = {};
  const add = (dimension: ReferenceValidationDimension, confidence: number) => {
    dimensions[dimension] = rounded(confidence);
  };

  if (pitchPassed) add("pitch", scoreCoverage);
  const onsetConfidence = Math.min(
    pianoAlignment.confidence,
    chromaMedian,
    1 - onsetP90Ms / 1_000,
  );
  if (noteOnsetPassed) add("note-onset", onsetConfidence);
  if (noteOffsetPassed) add("note-offset", Math.min(onsetConfidence, durationCoverage));
  if (pedalPassed) add("pedal", Math.min(0.7, pedalChanges.length / 256));
  if (ornamentPassed) add("ornament", Math.min(ornamentCoverage, average(realizedGestures.map((item) => item.confidence))));
  if (dynamicsPassed) add("dynamics", Math.min(scoreCoverage, dynamicsCoverage));

  return {
    status: pitchPassed && noteOnsetPassed ? "automatically-validated" : "automated-candidate",
    policyVersion: AUTOMATED_PERFORMANCE_POLICY_VERSION,
    dimensions,
  };
}

export function assertAutomatedPerformanceValidationConsistency(
  expected: AutomatedPerformanceValidation,
  actual: {
    status?: string;
    validationPolicyVersion?: string;
    dimensions?: Partial<Record<ReferenceValidationDimension, number>>;
  },
  interpretationId: string,
): void {
  const expectedDimensions = Object.keys(expected.dimensions).sort();
  const actualDimensions = Object.keys(actual.dimensions ?? {}).sort();
  if (
    actual.status !== expected.status
    || actual.validationPolicyVersion !== expected.policyVersion
    || JSON.stringify(actualDimensions) !== JSON.stringify(expectedDimensions)
  ) {
    throw new Error(`automatic performance validation is stale ${interpretationId}`);
  }
  for (const dimension of expectedDimensions as ReferenceValidationDimension[]) {
    if (actual.dimensions?.[dimension] !== expected.dimensions[dimension]) {
      throw new Error(`automatic performance confidence is stale ${interpretationId}:${dimension}`);
    }
  }
}
