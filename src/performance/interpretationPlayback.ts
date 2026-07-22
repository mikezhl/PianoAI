import type { ScoreRange } from "../analysis/types";
import { scoreNoteRefId } from "../lib/scoreIdentity";
import type { ParsedNote, ScoreData, ScoreNoteRef } from "../types";
import { interpretationRangeTickBounds, interpolatePerformanceTime } from "./interpretation";
import type {
  NoteExpression,
  NoteRealization,
  PedalPoint,
  PerformancePlaybackNote,
  ScoreInterpretation,
} from "./types";

interface InterpretationPlaybackPolicy {
  noteOnset: boolean;
  noteOffset: boolean;
  dynamics: boolean;
  pedal: boolean;
  ornament: boolean;
}

interface InterpretationPlaybackCandidate {
  scoreNote: ParsedNote;
  scoreGroupId: string;
  expression?: NoteExpression;
}

function clampVelocity(value: number): number {
  return Math.max(0.05, Math.min(1, value));
}

interface PlaybackDynamics {
  intensity?: number;
}

function playbackVelocity(dynamics?: PlaybackDynamics): number {
  if (dynamics?.intensity != null) return clampVelocity(0.2 + dynamics.intensity * 0.7);
  return 0.58;
}

function playbackPolicy(interpretation: ScoreInterpretation): InterpretationPlaybackPolicy {
  const noteValidated = interpretation.generation.status === "automatically-validated";
  const dimensions = interpretation.generation.dimensions;
  return {
    noteOnset: noteValidated && dimensions["note-onset"] != null,
    noteOffset: noteValidated && dimensions["note-offset"] != null,
    dynamics: noteValidated && dimensions.dynamics != null,
    pedal: noteValidated && dimensions.pedal != null,
    ornament: noteValidated && dimensions.ornament != null,
  };
}

function trustedExpression(expression: NoteExpression | undefined): expression is NoteExpression {
  return Boolean(
    expression
    && expression.confidence >= 0.75,
  );
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2
    : ordered[middle];
}

interface SustainInterval {
  startUs: number;
  endUs?: number;
}

const sustainIntervalsByPoints = new WeakMap<PedalPoint[], SustainInterval[]>();

function compileSustainIntervals(sustain: PedalPoint[]): SustainInterval[] {
  const cached = sustainIntervalsByPoints.get(sustain);
  if (cached) return cached;
  const intervals: SustainInterval[] = [];
  let active: SustainInterval | null = null;
  for (const point of sustain) {
    if (point.value >= 0.5) {
      if (!active) active = { startUs: point.timeUs };
      continue;
    }
    if (active) {
      active.endUs = point.timeUs;
      intervals.push(active);
      active = null;
    }
  }
  if (active) intervals.push(active);
  sustainIntervalsByPoints.set(sustain, intervals);
  return intervals;
}

function pedalReleaseAfter(
  sustain: PedalPoint[],
  keyUpUs: number,
): number | undefined {
  const intervals = compileSustainIntervals(sustain);
  let low = 0;
  let high = intervals.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (intervals[middle].startUs <= keyUpUs) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return undefined;
  const interval = intervals[low - 1];
  return interval.endUs == null || keyUpUs < interval.endUs ? interval.endUs : undefined;
}

function realizationPlaybackNote(
  interpretation: ScoreInterpretation,
  refId: string,
  realization: NoteRealization,
  index: number,
  scoreTick: number,
  scoreGroupId: string,
): PerformancePlaybackNote {
  const pedalReleaseUs = pedalReleaseAfter(
    interpretation.pedals.sustain,
    realization.releaseUs,
  );
  return {
    id: `standardized:${interpretation.interpretationId}:${refId}:realization:${index}`,
    pitch: realization.pitch,
    scoreTick,
    scoreGroupId,
    onsetUs: realization.onsetUs,
    offsetUs: Math.max(
      realization.onsetUs + 40_000,
      pedalReleaseUs ?? realization.releaseUs,
    ),
    velocity: playbackVelocity(realization),
    synthesized: false,
    onsetSource: "reference",
    durationSource: "reference",
    dynamicsSource: "reference",
  };
}

function writtenRef(ref: ScoreNoteRef): ScoreNoteRef {
  return { ...ref, playbackOccurrence: undefined };
}

function scoreCandidates(
  score: ScoreData,
  interpretation: ScoreInterpretation,
): InterpretationPlaybackCandidate[] {
  const writtenCandidates = score.noteGroups.flatMap((group) =>
    group.notes.map((scoreNote) => ({ scoreNote, scoreGroupId: group.id })),
  );
  const expressionsByRef = new Map(
    interpretation.noteExpressions.map((expression) => [scoreNoteRefId(expression.scoreNoteRef), expression] as const),
  );
  const expressionFor = (ref: ScoreNoteRef) => expressionsByRef.get(scoreNoteRefId(ref))
    ?? expressionsByRef.get(scoreNoteRefId(writtenRef(ref)));

  const usesUnfoldedTimeline = interpretation.timeMap.some(
    (anchor) => anchor.scorePosition.playbackOccurrence != null,
  );
  if (!usesUnfoldedTimeline || !score.measurePlaybackOrder?.length) {
    return writtenCandidates.map((candidate) => ({
      ...candidate,
      expression: expressionFor(candidate.scoreNote.scoreRef),
    }));
  }

  const notesByMeasure = new Map<number, InterpretationPlaybackCandidate[]>();
  for (const candidate of writtenCandidates) {
    const measureNotes = notesByMeasure.get(candidate.scoreNote.measureIndex) ?? [];
    measureNotes.push(candidate);
    notesByMeasure.set(candidate.scoreNote.measureIndex, measureNotes);
  }
  return score.measurePlaybackOrder.flatMap((occurrence) =>
    (notesByMeasure.get(occurrence.measureIndex) ?? []).map(({ scoreNote: written, scoreGroupId }) => ({
      scoreNote: {
        ...written,
        id: scoreNoteRefId({ ...written.scoreRef, playbackOccurrence: occurrence.playbackOccurrence }),
        scoreRef: { ...written.scoreRef, playbackOccurrence: occurrence.playbackOccurrence },
        absoluteTick: occurrence.timelineStartTick + written.startTick,
      },
      scoreGroupId,
      expression: expressionFor({ ...written.scoreRef, playbackOccurrence: occurrence.playbackOccurrence }),
    })),
  );
}

/**
 * Renders a score-aligned interpretation through the common piano source.
 * Score pitches define ordinary notes; notated ornament realizations retain their
 * one-to-many performed pitches. The interpretation supplies timing, duration,
 * dynamics, and pedal. Low-confidence model events stay in offline evidence
 * and do not leak into the standardized listening comparison.
 */
export function buildInterpretationPlaybackNotes(
  score: ScoreData,
  range: ScoreRange,
  interpretation: ScoreInterpretation,
): PerformancePlaybackNote[] {
  const { startTick, endTick } = interpretationRangeTickBounds(score, range, interpretation);
  const policy = playbackPolicy(interpretation);
  const candidates = scoreCandidates(score, interpretation)
    .filter(({ scoreNote }) => scoreNote.absoluteTick >= startTick && scoreNote.absoluteTick < endTick);
  const groupOnsets = new Map<string, number>();
  const observedGroupOnsets = new Map<string, number>();
  const playbackGroupKey = (candidate: InterpretationPlaybackCandidate) =>
    `${candidate.scoreGroupId}:${candidate.scoreNote.absoluteTick}`;
  const candidatesByGroup = new Map<string, InterpretationPlaybackCandidate[]>();
  for (const candidate of candidates) {
    const groupKey = playbackGroupKey(candidate);
    const group = candidatesByGroup.get(groupKey) ?? [];
    group.push(candidate);
    candidatesByGroup.set(groupKey, group);
  }
  for (const [groupKey, group] of candidatesByGroup) {
    const mapped = interpolatePerformanceTime(score, interpretation.timeMap, group[0].scoreNote.absoluteTick)?.timeUs;
    const observed = policy.noteOnset
      ? group.flatMap(({ expression }) =>
          trustedExpression(expression) && expression.onsetUs != null ? [expression.onsetUs] : [])
      : [];
    const observedGroupOnset = observed.length === 0
      ? undefined
      : median(observed);
    if (observedGroupOnset != null) observedGroupOnsets.set(groupKey, observedGroupOnset);
    const groupOnset = policy.noteOnset ? observedGroupOnset ?? mapped : mapped;
    if (groupOnset != null) groupOnsets.set(groupKey, groupOnset);
  }
  const groupKeysByTick = new Map<number, string[]>();
  for (const [groupKey] of groupOnsets) {
    const tick = candidatesByGroup.get(groupKey)?.[0]?.scoreNote.absoluteTick;
    if (tick == null) continue;
    const keys = groupKeysByTick.get(tick) ?? [];
    keys.push(groupKey);
    groupKeysByTick.set(tick, keys);
  }
  let previousTickOnsetUs = Number.NEGATIVE_INFINITY;
  for (const [, groupKeys] of [...groupKeysByTick].sort((left, right) => left[0] - right[0])) {
    const ordinaryGroupKeys = groupKeys.filter((key) =>
      !candidatesByGroup.get(key)?.some(({ scoreNote }) =>
        scoreNote.ornament || scoreNote.graceNotes?.length,
      ),
    );
    if (ordinaryGroupKeys.length === 0) continue;
    const minimumOnsetUs = Math.min(...ordinaryGroupKeys.map((key) => groupOnsets.get(key)!));
    const shiftUs = Math.max(0, previousTickOnsetUs - minimumOnsetUs);
    if (shiftUs > 0) {
      for (const key of ordinaryGroupKeys) groupOnsets.set(key, groupOnsets.get(key)! + shiftUs);
    }
    previousTickOnsetUs = minimumOnsetUs + shiftUs;
  }
  const mappedRangeEndUs = interpolatePerformanceTime(score, interpretation.timeMap, endTick)?.timeUs;
  return candidates
    .flatMap<PerformancePlaybackNote>(({ scoreNote, scoreGroupId, expression }, index) => {
      const refId = scoreNoteRefId(scoreNote.scoreRef);
      const expressionTrusted = trustedExpression(expression);
      if (
        policy.ornament
        && expressionTrusted
        && expression.kind === "ornament"
        && expression.realizations?.length
      ) {
        return expression.realizations.map((realization, realizationIndex) =>
          realizationPlaybackNote(
            interpretation,
            refId,
            realization,
            realizationIndex,
            scoreNote.absoluteTick,
            scoreGroupId,
          ));
      }
      const mappedOnset = interpolatePerformanceTime(score, interpretation.timeMap, scoreNote.absoluteTick);
      const mappedOffset = interpolatePerformanceTime(
        score,
        interpretation.timeMap,
        scoreNote.absoluteTick + scoreNote.durationTicks,
      );
      const groupKey = playbackGroupKey({ scoreNote, scoreGroupId, expression });
      const groupOnsetUs = groupOnsets.get(groupKey)
        ?? mappedOnset?.timeUs;
      const usesReferenceGroupOnset = policy.noteOnset && observedGroupOnsets.has(groupKey);
      const onsetUs = groupOnsetUs;
      if (onsetUs == null) return [];

      const mappedDurationUs = mappedOnset && mappedOffset
        ? Math.max(40_000, mappedOffset.timeUs - mappedOnset.timeUs)
        : 250_000;
      const useReferenceDuration = policy.noteOffset
        && expressionTrusted
        && expression.releaseUs != null;
      const keyUpUs = useReferenceDuration ? expression.releaseUs! : onsetUs + mappedDurationUs;
      const pedalReleaseUs = policy.pedal
        ? pedalReleaseAfter(interpretation.pedals.sustain, keyUpUs)
        : undefined;
      const offsetUs = Math.max(
        onsetUs + 40_000,
        pedalReleaseUs ?? keyUpUs,
      );
      const notatedEvents = scoreNote.playbackEvents.length > 1
        || scoreNote.playbackEvents.some((event) => event.midis.some((midi) => midi !== scoreNote.midi))
        ? scoreNote.playbackEvents
        : [];
      if (notatedEvents.length > 0) {
        const notatedSpanTicks = Math.max(
          scoreNote.durationTicks,
          ...notatedEvents.map((event) => event.offsetTicks + event.durationTicks),
        );
        const scaleUsPerTick = mappedDurationUs / Math.max(1, notatedSpanTicks);
        return notatedEvents.flatMap((event, eventIndex) => event.midis.map((pitch, pitchIndex) => ({
          id: `standardized:${interpretation.interpretationId}:${refId}:notated:${eventIndex}:${pitchIndex}`,
          pitch,
          scoreTick: scoreNote.absoluteTick,
          scoreGroupId,
          onsetUs: onsetUs + event.offsetTicks * scaleUsPerTick,
          offsetUs: onsetUs + (event.offsetTicks + event.durationTicks) * scaleUsPerTick,
          velocity: policy.dynamics && expressionTrusted ? playbackVelocity(expression) : 0.58,
          synthesized: true,
          onsetSource: "time-map" as const,
          durationSource: "time-map" as const,
          dynamicsSource: policy.dynamics && expressionTrusted ? "reference" as const : "default" as const,
        })));
      }
      const boundedOffsetUs = mappedRangeEndUs == null
        ? offsetUs
        : Math.min(offsetUs, mappedRangeEndUs + 1_500_000);
      return [{
        id: `standardized:${interpretation.interpretationId}:${refId}:${index}`,
        pitch: scoreNote.midi,
        scoreTick: scoreNote.absoluteTick,
        scoreGroupId,
        onsetUs,
        offsetUs: boundedOffsetUs,
        velocity: policy.dynamics && expressionTrusted ? playbackVelocity(expression) : 0.58,
        synthesized: !usesReferenceGroupOnset || !useReferenceDuration,
        onsetSource: usesReferenceGroupOnset ? "reference" : policy.noteOnset ? "score-group" : "time-map",
        durationSource: useReferenceDuration ? "reference" : "time-map",
        dynamicsSource: policy.dynamics && expressionTrusted ? "reference" : "default",
      } satisfies PerformancePlaybackNote];
    })
    .map((note) => ({
      ...note,
      onsetUs: Math.round(note.onsetUs),
      offsetUs: Math.round(mappedRangeEndUs == null
        ? note.offsetUs
        : Math.min(note.offsetUs, mappedRangeEndUs + 1_500_000)),
    }))
    .sort((left, right) => left.onsetUs - right.onsetUs || left.pitch - right.pitch);
}
