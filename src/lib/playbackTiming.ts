import { TICKS_PER_QUARTER } from "../types";

export const DEFAULT_PLAYBACK_BPM = 92;
export const MIN_PLAYBACK_BPM = 30;
export const MAX_PLAYBACK_BPM = 240;

export function clampPlaybackBpm(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_PLAYBACK_BPM;
  }

  return Math.max(MIN_PLAYBACK_BPM, Math.min(MAX_PLAYBACK_BPM, Math.round(value)));
}

export function ticksToMilliseconds(ticks: number, bpm: number): number {
  if (ticks <= 0) {
    return 0;
  }

  return (ticks / TICKS_PER_QUARTER) * (60000 / clampPlaybackBpm(bpm));
}

export function ticksToSeconds(ticks: number, bpm: number): number {
  return ticksToMilliseconds(ticks, bpm) / 1000;
}
