import type { ScoreAnalysis, ScorePosition, ScoreRange } from "../analysis/types";
import {
  scorePositionToTimelineTick,
  scoreRangeToTickBounds,
  tickToScorePosition,
} from "../lib/scoreIdentity";
import type { ScoreData } from "../types";
import { TICKS_PER_QUARTER } from "../types";
import type {
  PerformanceTimeAnchor,
  ScoreInterpretation,
  TempoSample,
} from "./types";

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2
    : ordered[middle] ?? 0;
}

interface CompiledTimeAnchor {
  tick: number;
  timeUs: number;
  confidence: number;
}

const compiledTimeMaps = new WeakMap<ScoreData, WeakMap<PerformanceTimeAnchor[], CompiledTimeAnchor[]>>();

function compileTimeMap(score: ScoreData, timeMap: PerformanceTimeAnchor[]): CompiledTimeAnchor[] {
  let scoreCache = compiledTimeMaps.get(score);
  if (!scoreCache) {
    scoreCache = new WeakMap();
    compiledTimeMaps.set(score, scoreCache);
  }
  const cached = scoreCache.get(timeMap);
  if (cached) return cached;
  const compiled = timeMap
    .map((anchor) => ({
      tick: scorePositionToTimelineTick(score, anchor.scorePosition),
      timeUs: anchor.timeUs,
      confidence: anchor.confidence,
    }))
    .sort((left, right) => left.tick - right.tick);
  scoreCache.set(timeMap, compiled);
  return compiled;
}

function upperBound<T>(items: T[], value: number, select: (item: T) => number): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (select(items[middle]) <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function interpolatePerformanceTime(
  score: ScoreData,
  timeMap: PerformanceTimeAnchor[],
  tick: number,
): { timeUs: number; confidence: number } | null {
  const anchors = compileTimeMap(score, timeMap);
  const rightIndex = upperBound(anchors, tick, (anchor) => anchor.tick);
  const left = anchors[Math.max(0, rightIndex - 1)];
  const right = anchors[Math.min(anchors.length - 1, rightIndex)];
  if (!left || !right) return null;
  if (left.tick === right.tick) {
    return { timeUs: left.timeUs, confidence: left.confidence };
  }
  const ratio = (tick - left.tick) / (right.tick - left.tick);
  return {
    timeUs: left.timeUs + ratio * (right.timeUs - left.timeUs),
    confidence: Math.min(left.confidence, right.confidence),
  };
}

export function interpolateScoreTickAtPerformanceTime(
  score: ScoreData,
  timeMap: PerformanceTimeAnchor[],
  timeUs: number,
): number | null {
  const anchors = compileTimeMap(score, timeMap);
  const rightIndex = upperBound(anchors, timeUs, (anchor) => anchor.timeUs);
  const left = anchors[Math.max(0, rightIndex - 1)];
  const right = anchors[Math.min(anchors.length - 1, rightIndex)];
  if (!left || !right) return null;
  if (left.timeUs === right.timeUs) return left.tick;
  const ratio = (timeUs - left.timeUs) / (right.timeUs - left.timeUs);
  return left.tick + ratio * (right.tick - left.tick);
}

export function interpretationRangeTickBounds(
  score: ScoreData,
  range: ScoreRange,
  interpretation: ScoreInterpretation,
): { startTick: number; endTick: number } {
  const written = scoreRangeToTickBounds(score, range);
  const usesUnfoldedTimeline = interpretation.timeMap.some(
    (anchor) => anchor.scorePosition.playbackOccurrence != null,
  );
  if (
    usesUnfoldedTimeline
    && written.startTick === 0
    && written.endTick === score.totalTicks
    && score.timelineTotalTicks != null
  ) {
    return { startTick: 0, endTick: score.timelineTotalTicks };
  }
  if (usesUnfoldedTimeline && score.measurePlaybackOrder?.length) {
    const startOccurrence = score.measurePlaybackOrder.find((occurrence) =>
      occurrence.measureIndex === range.start.measureIndex && occurrence.playbackOccurrence === 0);
    if (startOccurrence) {
      const startPosition = { ...range.start, playbackOccurrence: 0 };
      const startTick = scorePositionToTimelineTick(score, startPosition);
      if (range.end.measureIndex === range.start.measureIndex) {
        return {
          startTick,
          endTick: scorePositionToTimelineTick(score, { ...range.end, playbackOccurrence: 0 }),
        };
      }
      const startIndex = score.measurePlaybackOrder.indexOf(startOccurrence);
      let previousMeasure = startOccurrence.measureIndex;
      for (let index = startIndex + 1; index < score.measurePlaybackOrder.length; index += 1) {
        const occurrence = score.measurePlaybackOrder[index];
        if (occurrence.measureIndex < previousMeasure) {
          return { startTick, endTick: occurrence.timelineStartTick };
        }
        if (occurrence.measureIndex >= range.end.measureIndex) {
          return {
            startTick,
            endTick: occurrence.measureIndex === range.end.measureIndex
              ? scorePositionToTimelineTick(score, {
                ...range.end,
                playbackOccurrence: occurrence.playbackOccurrence,
              })
              : occurrence.timelineStartTick,
          };
        }
        previousMeasure = occurrence.measureIndex;
      }
    }
  }
  return {
    startTick: interpretationPositionTick(score, interpretation, range.start),
    endTick: interpretationPositionTick(score, interpretation, range.end),
  };
}

export function interpretationPositionTick(
  score: ScoreData,
  interpretation: ScoreInterpretation,
  position: ScorePosition,
): number {
  const usesUnfoldedTimeline = interpretation.timeMap.some(
    (anchor) => anchor.scorePosition.playbackOccurrence != null,
  );
  return scorePositionToTimelineTick(score, usesUnfoldedTimeline && position.playbackOccurrence == null
    ? { ...position, playbackOccurrence: 0 }
    : position);
}

function metricalBeatFor(score: ScoreData, measureIndex: number): { numerator: number; denominator: number } {
  const signature = score.measureTimeSignatures[measureIndex] ?? { beats: 4, beatType: 4 };
  return signature.beatType === 8 && signature.beats >= 6 && signature.beats % 3 === 0
    ? { numerator: 3, denominator: 2 }
    : { numerator: 4, denominator: signature.beatType };
}

function isFreeTimePosition(analysis: ScoreAnalysis | null, position: ScorePosition): boolean {
  return analysis?.sections.some((section) =>
    section.kind === "cadenza"
    && position.measureIndex >= section.range.start.measureIndex
    && position.measureIndex < section.range.end.measureIndex,
  ) ?? false;
}

export function buildTempoProfile(
  score: ScoreData,
  timeMap: PerformanceTimeAnchor[],
  analysis: ScoreAnalysis | null,
): TempoSample[] {
  const samples: TempoSample[] = [];
  const usesTimeline = timeMap.some((anchor) => anchor.scorePosition.playbackOccurrence != null)
    && Boolean(score.measurePlaybackOrder?.length);
  const measureTimeline = usesTimeline
    ? score.measurePlaybackOrder!.map((occurrence) => ({
      measureIndex: occurrence.measureIndex,
      startTick: occurrence.timelineStartTick,
      durationTicks: occurrence.durationTicks,
      scorePosition: {
        measureIndex: occurrence.measureIndex,
        offsetQuarter: { numerator: 0, denominator: 1 },
        playbackOccurrence: occurrence.playbackOccurrence,
      } satisfies ScorePosition,
    }))
    : score.measureStarts.map((startTick, measureIndex) => ({
      measureIndex,
      startTick,
      durationTicks: score.measureDurations[measureIndex] ?? 0,
      scorePosition: tickToScorePosition(score, startTick),
    }));
  for (const measure of measureTimeline) {
    const { measureIndex, startTick, durationTicks, scorePosition } = measure;
    if (durationTicks <= 0) continue;
    const endTick = startTick + durationTicks;
    const start = interpolatePerformanceTime(score, timeMap, startTick);
    const end = interpolatePerformanceTime(score, timeMap, endTick);
    if (!start || !end || end.timeUs <= start.timeUs) continue;

    const metricalBeat = metricalBeatFor(score, measureIndex);
    if (isFreeTimePosition(analysis, scorePosition)) {
      samples.push({
        scorePosition,
        metricalBeat,
        resolution: "measure",
        confidence: Math.min(start.confidence, end.confidence),
        tempoMode: "free-time",
      });
      continue;
    }

    const quarterCount = durationTicks / TICKS_PER_QUARTER;
    const durationMinutes = (end.timeUs - start.timeUs) / 60_000_000;
    const quarterBpm = quarterCount / durationMinutes;
    if (!Number.isFinite(quarterBpm) || quarterBpm < 10 || quarterBpm > 400) continue;
    const beatQuarterLength = metricalBeat.numerator / metricalBeat.denominator;
    samples.push({
      scorePosition,
      quarterBpm,
      metricalBeat,
      metricalBeatBpm: quarterBpm / beatQuarterLength,
      resolution: "measure",
      confidence: Math.min(start.confidence, end.confidence),
      tempoMode: "metrical",
    });
  }

  const medianQuarterBpm = median(samples.flatMap((sample) => sample.quarterBpm == null ? [] : [sample.quarterBpm]));
  return samples.map((sample) => ({
    ...sample,
    normalizedTempoRatio: sample.quarterBpm != null && medianQuarterBpm > 0
      ? sample.quarterBpm / medianQuarterBpm
      : undefined,
  }));
}
