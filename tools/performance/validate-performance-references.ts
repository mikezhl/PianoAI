import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import {
  buildPerformanceScoreOnsets,
  MIDI_ALIGNMENT_ALGORITHM_VERSION,
} from "../../src/performance/alignment";
import {
  interpolatePerformanceTime,
  interpolateScoreTickAtPerformanceTime,
} from "../../src/performance/interpretation";
import { buildInterpretationPlaybackNotes } from "../../src/performance/interpretationPlayback";
import type {
  ReferenceInterpretationCatalog,
  ScoreInterpretation,
} from "../../src/performance/types";
import { scoreNoteRefId, scorePositionToTimelineTick } from "../../src/lib/scoreIdentity";
import {
  assertAutomatedPerformanceValidationConsistency,
  deriveAutomatedPerformanceValidation,
  type ScoreInformedEvaluationReport,
} from "./automated-performance-validation";
import { loadCanonicalScore } from "./canonical-score";
import { canonicalTextSha256 } from "./content-hash";
import {
  evaluationPath,
  interpretationPath,
  performanceCatalogPath,
  schemaDirectory,
  scoreCatalogPath,
  scorePath,
} from "../project-paths";

const analysisManifest = JSON.parse(readFileSync(scoreCatalogPath, "utf8")) as {
  items: Array<{ scoreId: string; sourceHash: string }>;
};
const catalog = JSON.parse(
  readFileSync(performanceCatalogPath, "utf8"),
) as ReferenceInterpretationCatalog;
const interpretationSchema = JSON.parse(
  readFileSync(`${schemaDirectory}/score-interpretation.schema.json`, "utf8"),
);
const catalogSchema = JSON.parse(
  readFileSync(`${schemaDirectory}/reference-interpretation-catalog.schema.json`, "utf8"),
);
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateInterpretation = ajv.compile(interpretationSchema);
const validateCatalog = ajv.compile(catalogSchema);

if (!validateCatalog(catalog)) {
  throw new Error(`performance catalog schema mismatch: ${JSON.stringify(validateCatalog.errors)}`);
}

const scores = new Map(analysisManifest.items.map((item) => [item.scoreId, item]));
const interpretationIds = new Set<string>();
for (const reference of catalog.references) {
  if (interpretationIds.has(reference.interpretationId)) {
    throw new Error(`duplicate reference ${reference.interpretationId}`);
  }
  interpretationIds.add(reference.interpretationId);
  const expectedObjectKey = `reference-audio/${reference.audio.sha256.toLowerCase()}`
    + path.extname(reference.audio.fileName).toLowerCase();
  if (reference.audio.objectKey !== expectedObjectKey) {
    throw new Error(`reference audio object key mismatch ${reference.interpretationId}`);
  }
  const scoreManifestItem = scores.get(reference.score.scoreId);
  if (scoreManifestItem?.sourceHash !== reference.score.sourceHash) {
    throw new Error(`reference score identity mismatch ${reference.interpretationId}`);
  }

  const detailPath = interpretationPath(reference.interpretationId);
  if (!existsSync(detailPath)) {
    throw new Error(`reference detail missing: ${reference.interpretationId}`);
  }
  const detail = JSON.parse(readFileSync(detailPath, "utf8")) as ScoreInterpretation;
  if (!validateInterpretation(detail)) {
    throw new Error(
      `reference detail schema mismatch ${reference.interpretationId}: ${JSON.stringify(validateInterpretation.errors)}`,
    );
  }
  if (
    detail.interpretationId !== reference.interpretationId
    || detail.score.scoreId !== reference.score.scoreId
    || detail.score.sourceHash !== reference.score.sourceHash
  ) {
    throw new Error(`reference detail identity mismatch ${reference.interpretationId}`);
  }

  const score = await loadCanonicalScore(scorePath(scoreManifestItem.scoreId));
  const fullRange = {
    start: { measureIndex: 0, offsetQuarter: { numerator: 0, denominator: 1 } },
    end: { measureIndex: score.measureDurations.length, offsetQuarter: { numerator: 0, denominator: 1 } },
  };
  const performanceScoreNotes = buildPerformanceScoreOnsets(score, fullRange, ["left", "right"])
    .flatMap((onset) => onset.notes);
  const canonicalRefs = new Set(performanceScoreNotes.map((note) => scoreNoteRefId(note.scoreRef)));
  const gestureRefs = new Set(performanceScoreNotes
    .filter((note) => note.ornament || note.graceNotes?.length)
    .map((note) => scoreNoteRefId(note.scoreRef)));

  let previousTick = Number.NEGATIVE_INFINITY;
  let previousTimeUs = Number.NEGATIVE_INFINITY;
  for (const anchor of detail.timeMap) {
    const tick = scorePositionToTimelineTick(score, anchor.scorePosition);
    if (tick <= previousTick || anchor.timeUs <= previousTimeUs) {
      throw new Error(`reference time map is not monotonic ${reference.interpretationId}`);
    }
    previousTick = tick;
    previousTimeUs = anchor.timeUs;
  }
  if (detail.timeMap.at(-1)!.timeUs > reference.audio.durationUs) {
    throw new Error(`reference time map exceeds audio duration ${reference.interpretationId}`);
  }
  for (const anchor of detail.timeMap) {
    const tick = scorePositionToTimelineTick(score, anchor.scorePosition);
    const inverseTick = interpolateScoreTickAtPerformanceTime(score, detail.timeMap, anchor.timeUs);
    const forwardTime = interpolatePerformanceTime(score, detail.timeMap, tick)?.timeUs;
    if (inverseTick == null || Math.abs(inverseTick - tick) > 0.001 || forwardTime !== anchor.timeUs) {
      throw new Error(`reference time map roundtrip mismatch ${reference.interpretationId}`);
    }
  }

  const expressionRefs = new Set<string>();
  for (const expression of detail.noteExpressions) {
    const refId = scoreNoteRefId(expression.scoreNoteRef);
    if (!canonicalRefs.has(refId) || expressionRefs.has(refId)) {
      throw new Error(`invalid score note expression ${reference.interpretationId}:${refId}`);
    }
    expressionRefs.add(refId);
    if (
      expression.kind === "performed"
      && (expression.onsetUs == null || expression.releaseUs == null || expression.releaseUs <= expression.onsetUs)
    ) {
      throw new Error(`invalid performed note timing ${reference.interpretationId}:${refId}`);
    }
    if (expression.kind === "ornament") {
      if (!gestureRefs.has(refId)) throw new Error(`unnotated ornament realization ${reference.interpretationId}:${refId}`);
      for (const realization of expression.realizations ?? []) {
        if (realization.releaseUs <= realization.onsetUs) {
          throw new Error(`invalid ornament timing ${reference.interpretationId}:${refId}`);
        }
      }
    }
  }

  let previousPedalTimeUs = Number.NEGATIVE_INFINITY;
  for (const point of detail.pedals.sustain) {
    if (point.timeUs <= previousPedalTimeUs || point.timeUs > reference.audio.durationUs) {
      throw new Error(`invalid sustain pedal timeline ${reference.interpretationId}`);
    }
    previousPedalTimeUs = point.timeUs;
  }

  const performedCount = detail.noteExpressions.filter((expression) => expression.kind === "performed").length;
  const ornamentCount = detail.noteExpressions.filter((expression) => expression.kind === "ornament").length;
  const coverage = detail.generation.coverage;
  if (
    coverage.scoreNotes !== canonicalRefs.size
    || coverage.matchedNotes !== performedCount
    || coverage.ornamentGestures !== ornamentCount
    || coverage.uncertainNotes !== canonicalRefs.size - performedCount - ornamentCount
    || Math.abs(coverage.scoreCoverage - (performedCount + ornamentCount) / canonicalRefs.size) > 1e-12
  ) {
    throw new Error(`reference coverage is stale ${reference.interpretationId}`);
  }
  if (!detail.generation.algorithmVersion.startsWith(MIDI_ALIGNMENT_ALGORITHM_VERSION)) {
    throw new Error(`reference alignment algorithm is stale ${reference.interpretationId}`);
  }
  if (detail.generation.dimensions.ornament != null && ornamentCount !== gestureRefs.size) {
    throw new Error(`reference ornament coverage incomplete ${reference.interpretationId}`);
  }

  if (detail.generation.evaluationId !== reference.interpretationId) {
    throw new Error(`reference evaluation identity mismatch ${reference.interpretationId}`);
  }
  const reportPath = evaluationPath(detail.generation.evaluationId);
  if (!existsSync(reportPath) || canonicalTextSha256(reportPath) !== detail.generation.evaluationSha256) {
    throw new Error(`reference evaluation hash mismatch ${reference.interpretationId}`);
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as ScoreInformedEvaluationReport;
  if (report.scoreId !== reference.score.scoreId || report.audioSha256 !== reference.audio.sha256) {
    throw new Error(`reference automatic evaluation identity mismatch ${reference.interpretationId}`);
  }
  const automaticValidation = deriveAutomatedPerformanceValidation({
    evaluation: report,
    coverage,
    noteExpressions: detail.noteExpressions,
    pedals: detail.pedals,
    notatedGestureCount: gestureRefs.size,
  });
  assertAutomatedPerformanceValidationConsistency(
    automaticValidation,
    detail.generation,
    reference.interpretationId,
  );

  const playbackNotes = buildInterpretationPlaybackNotes(score, fullRange, detail);
  if (playbackNotes.length === 0 || playbackNotes.some((note) => note.offsetUs <= note.onsetUs)) {
    throw new Error(`reference standardized playback is invalid ${reference.interpretationId}`);
  }
  const gestureGroupIds = new Set(score.noteGroups
    .filter((group) => group.notes.some((note) => note.ornament || note.graceNotes?.length))
    .map((group) => group.id));
  const playbackGroups = new Map<string, typeof playbackNotes>();
  for (const note of playbackNotes) {
    const key = `${note.scoreGroupId}:${note.scoreTick}`;
    const group = playbackGroups.get(key) ?? [];
    group.push(note);
    playbackGroups.set(key, group);
  }
  for (const group of playbackGroups.values()) {
    if (gestureGroupIds.has(group[0].scoreGroupId)) continue;
    if (Math.max(...group.map((note) => note.onsetUs)) !== Math.min(...group.map((note) => note.onsetUs))) {
      throw new Error(`non-uniform score-group onset leaked into playback ${reference.interpretationId}`);
    }
  }
  const onsetByTick = new Map<number, number>();
  for (const note of playbackNotes) {
    if (gestureGroupIds.has(note.scoreGroupId)) continue;
    onsetByTick.set(note.scoreTick, Math.min(onsetByTick.get(note.scoreTick) ?? note.onsetUs, note.onsetUs));
  }
  const orderedTicks = [...onsetByTick].sort((left, right) => left[0] - right[0]);
  const orderViolation = orderedTicks.find((entry, index) =>
    index > 0 && entry[1] < orderedTicks[index - 1][1]);
  if (orderViolation) {
    const index = orderedTicks.indexOf(orderViolation);
    const previous = orderedTicks[index - 1];
    throw new Error(
      `standardized playback score order is not monotonic ${reference.interpretationId}: `
      + `${previous[0]}@${previous[1]} -> ${orderViolation[0]}@${orderViolation[1]}`,
    );
  }
  if (Math.max(...playbackNotes.map((note) => note.offsetUs)) > reference.audio.durationUs) {
    throw new Error(`standardized playback exceeds audio duration ${reference.interpretationId}`);
  }
}

console.log(`Performance reference validation passed: ${catalog.references.length} reference(s)`);
