import type { ScoreRange } from "../analysis/types";
import { scoreNoteRefId } from "../lib/scoreIdentity";
import type { ScoreData } from "../types";
import {
  interpretationPositionTick,
  interpretationRangeTickBounds,
  interpolatePerformanceTime,
} from "./interpretation";
import type {
  ReferenceAnalysisCapabilities,
  ReferenceInterpretation,
} from "./types";

export interface ReferencePerformanceSummary {
  intensityMedian?: number;
  upperStaffBalance?: number;
  durationRatioMedian?: number;
  pedalDownRatio?: number;
}

export function getReferenceAnalysisCapabilities(
  reference: ReferenceInterpretation,
): ReferenceAnalysisCapabilities {
  const sectionTempo = reference.timeMap.length >= 2;
  const noteLevelValidated = reference.generation.status === "automatically-validated";
  const dimensions = reference.generation.dimensions;
  return {
    sectionTempo,
    dynamics: noteLevelValidated && dimensions.dynamics != null,
    articulation: noteLevelValidated && dimensions["note-offset"] != null,
    pedal: noteLevelValidated && dimensions.pedal != null,
  };
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2
    : ordered[middle];
}

function pedalDownRatio(
  reference: ReferenceInterpretation,
  startUs: number,
  endUs: number,
): number | undefined {
  if (endUs <= startUs) return undefined;
  const points = reference.pedals.sustain;
  if (points.length === 0) return 0;
  let down = false;
  for (const point of points) {
    if (point.timeUs > startUs) break;
    down = point.value >= 0.5;
  }
  let cursor = startUs;
  let downUs = 0;
  for (const point of points) {
    if (point.timeUs <= startUs) continue;
    if (point.timeUs >= endUs) break;
    if (down) downUs += point.timeUs - cursor;
    cursor = point.timeUs;
    down = point.value >= 0.5;
  }
  if (down) downUs += endUs - cursor;
  return downUs / (endUs - startUs);
}

function metricValues(summary: ReferencePerformanceSummary, key: keyof ReferencePerformanceSummary): number[] {
  const value = summary[key];
  return value == null ? [] : [value];
}

export function buildReferencePerformanceSummary(
  score: ScoreData,
  range: ScoreRange,
  reference: ReferenceInterpretation,
): ReferencePerformanceSummary {
  const capabilities = getReferenceAnalysisCapabilities(reference);
  const { startTick, endTick } = interpretationRangeTickBounds(score, range, reference);
  const scoreNotes = new Map(
    score.noteGroups.flatMap((group) => group.notes).map((note) => [scoreNoteRefId(note.scoreRef), note] as const),
  );
  const expressions = reference.noteExpressions.filter((expression) => {
    if (
      expression.confidence < 0.75
    ) return false;
    const tick = interpretationPositionTick(score, reference, expression.scoreNoteRef);
    return tick >= startTick && tick < endTick;
  });

  const intensityValues = expressions.flatMap((expression) =>
    expression.intensity == null ? [] : [expression.intensity]);
  const staffIntensity = (staff: number) => median(expressions.flatMap((expression) =>
    expression.scoreNoteRef.staff === staff && expression.intensity != null
      ? [expression.intensity]
      : []));
  const upperIntensity = staffIntensity(1);
  const lowerIntensity = staffIntensity(2);

  const durationRatios = expressions.flatMap((expression) => {
    if (expression.onsetUs == null || expression.releaseUs == null) return [];
    const scoreNote = scoreNotes.get(scoreNoteRefId(expression.scoreNoteRef))
      ?? scoreNotes.get(scoreNoteRefId({ ...expression.scoreNoteRef, playbackOccurrence: undefined }));
    if (!scoreNote) return [];
    const noteStartTick = interpretationPositionTick(score, reference, expression.scoreNoteRef);
    const expectedStart = interpolatePerformanceTime(score, reference.timeMap, noteStartTick);
    const expectedEnd = interpolatePerformanceTime(
      score,
      reference.timeMap,
      noteStartTick + scoreNote.durationTicks,
    );
    if (!expectedStart || !expectedEnd || expectedEnd.timeUs <= expectedStart.timeUs) return [];
    return [(expression.releaseUs - expression.onsetUs) / (expectedEnd.timeUs - expectedStart.timeUs)];
  });

  const start = interpolatePerformanceTime(score, reference.timeMap, startTick);
  const end = interpolatePerformanceTime(score, reference.timeMap, endTick);
  return {
    intensityMedian: capabilities.dynamics ? median(intensityValues) : undefined,
    upperStaffBalance: capabilities.dynamics && upperIntensity != null && lowerIntensity != null
      ? upperIntensity - lowerIntensity
      : undefined,
    durationRatioMedian: capabilities.articulation ? median(durationRatios) : undefined,
    pedalDownRatio: capabilities.pedal && start && end
      ? pedalDownRatio(reference, start.timeUs, end.timeUs)
      : undefined,
  };
}

export function aggregateReferencePerformanceSummaries(
  summaries: ReferencePerformanceSummary[],
): ReferencePerformanceSummary {
  return {
    intensityMedian: median(summaries.flatMap((summary) => metricValues(summary, "intensityMedian"))),
    upperStaffBalance: median(summaries.flatMap((summary) => metricValues(summary, "upperStaffBalance"))),
    durationRatioMedian: median(summaries.flatMap((summary) => metricValues(summary, "durationRatioMedian"))),
    pedalDownRatio: median(summaries.flatMap((summary) => metricValues(summary, "pedalDownRatio"))),
  };
}
