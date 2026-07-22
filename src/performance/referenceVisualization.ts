import { scoreNoteRefId, scorePositionToTick, timelineTickToScorePosition } from "../lib/scoreIdentity";
import type { Hand, NoteGroup, ParsedNote, ScoreData } from "../types";
import {
  interpolatePerformanceTime,
  interpolateScoreTickAtPerformanceTime,
  interpretationPositionTick,
} from "./interpretation";
import type { PerformedNoteExpression, ReferenceInterpretation } from "./types";

const MIN_VISUALIZATION_CONFIDENCE = 0.75;

export interface PerformanceGroupVisualization {
  groupId: string;
  tick: number;
  measureIndex: number;
  hand: Hand;
  intensity?: number;
  durationRatio?: number;
  confidence: number;
}

export interface PerformancePedalVisualization {
  tick: number;
  value: number;
}

export interface ReferencePerformanceVisualization {
  groups: PerformanceGroupVisualization[];
  pedal: PerformancePedalVisualization[];
}

interface GroupAccumulator {
  group: NoteGroup;
  intensities: number[];
  durationRatios: number[];
  confidences: number[];
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2
    : ordered[middle];
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function noteLookup(score: ScoreData): Map<string, { group: NoteGroup; note: ParsedNote }> {
  return new Map(score.noteGroups.flatMap((group) => group.notes.map((note) => [
    scoreNoteRefId(note.scoreRef),
    { group, note },
  ] as const)));
}

function expressionLookupKey(expression: PerformedNoteExpression): string[] {
  const exact = scoreNoteRefId(expression.scoreNoteRef);
  if (expression.scoreNoteRef.playbackOccurrence == null) return [exact];
  return [exact, scoreNoteRefId({ ...expression.scoreNoteRef, playbackOccurrence: undefined })];
}

function performedExpressions(reference: ReferenceInterpretation): PerformedNoteExpression[] {
  return reference.noteExpressions.filter((expression): expression is PerformedNoteExpression =>
    expression.kind === "performed" && expression.confidence >= MIN_VISUALIZATION_CONFIDENCE);
}

function durationRatio(
  score: ScoreData,
  reference: ReferenceInterpretation,
  expression: PerformedNoteExpression,
  note: ParsedNote,
): number | undefined {
  const startTick = interpretationPositionTick(score, reference, expression.scoreNoteRef);
  const expectedStart = interpolatePerformanceTime(score, reference.timeMap, startTick);
  const expectedEnd = interpolatePerformanceTime(score, reference.timeMap, startTick + note.durationTicks);
  if (!expectedStart || !expectedEnd || expectedEnd.timeUs <= expectedStart.timeUs) return undefined;
  const ratio = (expression.releaseUs - expression.onsetUs) / (expectedEnd.timeUs - expectedStart.timeUs);
  return Number.isFinite(ratio) && ratio >= 0 ? Math.min(2, ratio) : undefined;
}

function writtenTickAtPerformanceTime(
  score: ScoreData,
  reference: ReferenceInterpretation,
  timeUs: number,
): number | null {
  const timelineTick = interpolateScoreTickAtPerformanceTime(score, reference.timeMap, timeUs);
  if (timelineTick == null) return null;
  const position = timelineTickToScorePosition(score, timelineTick);
  return scorePositionToTick(score, position);
}

function buildPedalVisualization(
  score: ScoreData,
  reference: ReferenceInterpretation,
): PerformancePedalVisualization[] {
  const anchors = reference.timeMap;
  if (anchors.length === 0) return [];
  const startUs = anchors[0].timeUs;
  const endUs = anchors.at(-1)!.timeUs;
  let startValue = 0;
  for (const point of reference.pedals.sustain) {
    if (point.timeUs > startUs) break;
    startValue = point.value;
  }
  const samples: PerformancePedalVisualization[] = [{ tick: 0, value: startValue }];
  for (const point of reference.pedals.sustain) {
    if (point.timeUs <= startUs || point.timeUs >= endUs) continue;
    const tick = writtenTickAtPerformanceTime(score, reference, point.timeUs);
    if (tick == null) continue;
    const value = Math.max(0, Math.min(1, point.value));
    const previous = samples.at(-1);
    if (previous && Math.abs(previous.tick - tick) < 1) {
      previous.value = value;
    } else if (!previous || previous.value !== value) {
      samples.push({ tick, value });
    }
  }
  const lastValue = samples.at(-1)?.value ?? 0;
  samples.push({ tick: score.totalTicks, value: lastValue });
  return samples;
}

export function buildReferencePerformanceVisualization(
  score: ScoreData,
  reference: ReferenceInterpretation,
): ReferencePerformanceVisualization {
  const lookup = noteLookup(score);
  const groupAccumulators = new Map<string, GroupAccumulator>();

  for (const expression of performedExpressions(reference)) {
    const match = expressionLookupKey(expression)
      .map((key) => lookup.get(key))
      .find((candidate) => candidate != null);
    if (!match) continue;

    const accumulator = groupAccumulators.get(match.group.id) ?? {
      group: match.group,
      intensities: [],
      durationRatios: [],
      confidences: [],
    };
    accumulator.intensities.push(expression.intensity);
    accumulator.confidences.push(expression.confidence);
    const ratio = durationRatio(score, reference, expression, match.note);
    if (ratio != null) accumulator.durationRatios.push(ratio);
    groupAccumulators.set(match.group.id, accumulator);

  }

  const groups = [...groupAccumulators.values()]
    .map((accumulator) => ({
      groupId: accumulator.group.id,
      tick: accumulator.group.absoluteTick,
      measureIndex: accumulator.group.measureIndex,
      hand: accumulator.group.hand,
      intensity: median(accumulator.intensities),
      durationRatio: median(accumulator.durationRatios),
      confidence: mean(accumulator.confidences),
    }))
    .sort((left, right) => left.tick - right.tick || left.hand.localeCompare(right.hand));

  return {
    groups,
    pedal: buildPedalVisualization(score, reference),
  };
}

export function pedalValueAtTick(samples: PerformancePedalVisualization[], tick: number): number | undefined {
  let current: number | undefined;
  for (const sample of samples) {
    if (sample.tick > tick) break;
    current = sample.value;
  }
  return current;
}
