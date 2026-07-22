import type { RationalNumber, ScoreData, ScoreNoteRef } from "../types";
import type { ScorePosition, ScoreRange } from "../analysis/types";
import { TICKS_PER_QUARTER } from "../types";

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(Math.round(left));
  let b = Math.abs(Math.round(right));
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a || 1;
}

export function ticksToQuarterRational(ticks: number): RationalNumber {
  const roundedTicks = Math.round(ticks);
  const divisor = greatestCommonDivisor(roundedTicks, TICKS_PER_QUARTER);
  return {
    numerator: roundedTicks / divisor,
    denominator: TICKS_PER_QUARTER / divisor,
  };
}

function idPart(value: string | number): string {
  return encodeURIComponent(String(value));
}

export function scoreNoteRefId(ref: ScoreNoteRef): string {
  return [
    "sn",
    ref.partId,
    ref.measureIndex,
    `${ref.offsetQuarter.numerator}-${ref.offsetQuarter.denominator}`,
    ref.staff,
    ref.voice,
    ref.writtenPitch,
    ref.ordinalAtPosition,
    ref.playbackOccurrence ?? 0,
  ].map(idPart).join(":");
}

export function tickToScorePosition(score: ScoreData, tick: number): ScorePosition {
  const clampedTick = Math.max(0, Math.min(score.totalTicks, Math.round(tick)));
  if (clampedTick >= score.totalTicks) {
    return {
      measureIndex: score.measureStarts.length,
      offsetQuarter: { numerator: 0, denominator: 1 },
    };
  }

  let measureIndex = 0;
  for (let index = 0; index < score.measureStarts.length; index += 1) {
    if ((score.measureStarts[index] ?? 0) > clampedTick) {
      break;
    }
    measureIndex = index;
  }

  const measureStart = score.measureStarts[measureIndex] ?? 0;
  return {
    measureIndex,
    offsetQuarter: ticksToQuarterRational(clampedTick - measureStart),
  };
}

export function scorePositionToTick(score: ScoreData, position: ScorePosition): number {
  if (position.measureIndex >= score.measureStarts.length) {
    return score.totalTicks;
  }
  const measureStart = score.measureStarts[Math.max(0, position.measureIndex)] ?? 0;
  const denominator = position.offsetQuarter.denominator || 1;
  const offsetTicks = Math.round(
    (position.offsetQuarter.numerator / denominator) * TICKS_PER_QUARTER,
  );
  return Math.max(0, Math.min(score.totalTicks, measureStart + offsetTicks));
}

export function scorePositionToTimelineTick(score: ScoreData, position: ScorePosition): number {
  if (position.playbackOccurrence == null || !score.measurePlaybackOrder?.length) {
    return scorePositionToTick(score, position);
  }
  const occurrence = score.measurePlaybackOrder.find((candidate) =>
    candidate.measureIndex === position.measureIndex
    && candidate.playbackOccurrence === position.playbackOccurrence);
  if (!occurrence) return scorePositionToTick(score, position);
  const denominator = position.offsetQuarter.denominator || 1;
  const offsetTicks = Math.round(
    (position.offsetQuarter.numerator / denominator) * TICKS_PER_QUARTER,
  );
  return Math.max(
    occurrence.timelineStartTick,
    Math.min(occurrence.timelineStartTick + occurrence.durationTicks, occurrence.timelineStartTick + offsetTicks),
  );
}

export function timelineTickToScorePosition(score: ScoreData, tick: number): ScorePosition {
  const order = score.measurePlaybackOrder;
  if (!order?.length) return tickToScorePosition(score, tick);
  const totalTicks = score.timelineTotalTicks ?? order.reduce(
    (maximum, occurrence) => Math.max(maximum, occurrence.timelineStartTick + occurrence.durationTicks),
    0,
  );
  const clampedTick = Math.max(0, Math.min(totalTicks, Math.round(tick)));
  if (clampedTick >= totalTicks) {
    return {
      measureIndex: score.measureStarts.length,
      offsetQuarter: { numerator: 0, denominator: 1 },
    };
  }
  const occurrence = order.find((candidate) =>
    clampedTick >= candidate.timelineStartTick
    && clampedTick < candidate.timelineStartTick + candidate.durationTicks) ?? order.at(-1)!;
  return {
    measureIndex: occurrence.measureIndex,
    offsetQuarter: ticksToQuarterRational(clampedTick - occurrence.timelineStartTick),
    playbackOccurrence: occurrence.playbackOccurrence,
  };
}

export function scoreRangeToTickBounds(score: ScoreData, range: ScoreRange): { startTick: number; endTick: number } {
  const left = scorePositionToTick(score, range.start);
  const right = scorePositionToTick(score, range.end);
  return {
    startTick: Math.min(left, right),
    endTick: Math.max(left, right),
  };
}

export function tickBoundsToScoreRange(score: ScoreData, startTick: number, endTick: number): ScoreRange {
  return {
    start: tickToScorePosition(score, Math.min(startTick, endTick)),
    end: tickToScorePosition(score, Math.max(startTick, endTick)),
  };
}

export async function sha256Text(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hash.toUpperCase()}`;
}
