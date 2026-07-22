import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteGroup } from "../types";
import {
  buildScoreRangePlaybackEvents,
  cancelScheduledPlayback,
  handleMidiMonitorEvent,
  playPerformanceNotes,
  playScoreRange,
  resetMidiMonitor,
} from "./audio";

const audioSpies = vi.hoisted(() => ({
  attack: vi.fn(),
  release: vi.fn(),
  attackRelease: vi.fn(),
  releaseAll: vi.fn(),
}));

const toneClock = vi.hoisted(() => ({ now: 10 }));

vi.mock("tone", () => ({
  start: vi.fn(async () => undefined),
  now: () => toneClock.now,
  Limiter: class {
    constructor(_threshold: number) {}
    toDestination() { return this; }
  },
  Sampler: class {
    volume = { value: 0 };
    constructor(options: { onload: () => void }) {
      queueMicrotask(options.onload);
    }
    connect() { return this; }
    triggerAttack(...args: unknown[]) { audioSpies.attack(...args); }
    triggerRelease(...args: unknown[]) { audioSpies.release(...args); }
    triggerAttackRelease(...args: unknown[]) { audioSpies.attackRelease(...args); }
    releaseAll() { audioSpies.releaseAll(); }
  },
}));

beforeEach(() => {
  toneClock.now = 10;
  resetMidiMonitor();
  Object.values(audioSpies).forEach((spy) => spy.mockClear());
});

function noteGroup(overrides: Partial<NoteGroup>): NoteGroup {
  return {
    id: "group-1",
    hand: "right",
    measureIndex: 0,
    startTick: 480,
    absoluteTick: 480,
    durationTicks: 240,
    notes: [{
      id: "note-1",
      scoreRef: {
        partId: "P1",
        measureIndex: 0,
        offsetQuarter: { numerator: 1, denominator: 1 },
        staff: 1,
        voice: "1",
        writtenPitch: "C4",
        ordinalAtPosition: 0,
      },
      midi: 60,
      name: "C4",
      hand: "right",
      staff: 1,
      measureIndex: 0,
      startTick: 480,
      absoluteTick: 480,
      durationTicks: 240,
      playbackEvents: [],
    }],
    playbackEvents: [],
    ...overrides,
  };
}

describe("buildScoreRangePlaybackEvents", () => {
  it("preserves leading silence relative to the selected score range", () => {
    expect(buildScoreRangePlaybackEvents([noteGroup({})], 0, 1920)).toEqual([{
      midis: [60],
      offsetTicks: 480,
      durationTicks: 240,
    }]);
  });

  it("adds note-level playback offsets to the group position", () => {
    const group = noteGroup({
      absoluteTick: 960,
      playbackEvents: [{ midis: [62], offsetTicks: 120, durationTicks: 180 }],
    });

    expect(buildScoreRangePlaybackEvents([group], 480, 1920)).toEqual([{
      midis: [62],
      offsetTicks: 600,
      durationTicks: 180,
    }]);
  });

  it("replays and clips a note that is already sounding at the range start", () => {
    const group = noteGroup({
      absoluteTick: 0,
      durationTicks: 1440,
      notes: [{
        ...noteGroup({}).notes[0],
        absoluteTick: 0,
        startTick: 0,
        durationTicks: 1440,
      }],
    });

    expect(buildScoreRangePlaybackEvents([group], 720, 1080)).toEqual([{
      midis: [60],
      offsetTicks: 0,
      durationTicks: 360,
    }]);
  });

  it("drops playback events that do not intersect the selected range", () => {
    expect(buildScoreRangePlaybackEvents([noteGroup({})], 0, 240)).toEqual([]);
  });

  it("keeps long score ranges on one rolling scheduler and cancels the old session", async () => {
    vi.useFakeTimers();
    const groups = Array.from({ length: 100 }, (_, index) => noteGroup({
      id: `group-${index}`,
      absoluteTick: index * 1920,
      startTick: index * 1920,
    }));

    expect(await playScoreRange(groups, 120, 0, 100 * 1920)).toBe(true);
    expect(audioSpies.attackRelease).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);

    cancelScheduledPlayback();
    toneClock.now = 30;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(audioSpies.attackRelease).toHaveBeenCalledTimes(2);
    expect(audioSpies.releaseAll).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});

describe("performance audio", () => {
  it("keeps MIDI notes sounding until key release", async () => {
    await handleMidiMonitorEvent({ timeUs: 1_000, status: 0x90, data1: 60, data2: 96, channel: 0, deviceId: "midi" });
    expect(audioSpies.attack).toHaveBeenCalledWith("C4", undefined, 96 / 127);
    await handleMidiMonitorEvent({ timeUs: 2_000, status: 0x80, data1: 60, data2: 0, channel: 0, deviceId: "midi" });
    expect(audioSpies.release).toHaveBeenCalledWith("C4");
  });

  it("defers MIDI key release while sustain is down", async () => {
    await handleMidiMonitorEvent({ timeUs: 1_000, status: 0xb0, data1: 64, data2: 127, channel: 0, deviceId: "midi" });
    await handleMidiMonitorEvent({ timeUs: 1_100, status: 0x90, data1: 64, data2: 80, channel: 0, deviceId: "midi" });
    await handleMidiMonitorEvent({ timeUs: 2_000, status: 0x80, data1: 64, data2: 0, channel: 0, deviceId: "midi" });
    expect(audioSpies.release).not.toHaveBeenCalled();
    await handleMidiMonitorEvent({ timeUs: 3_000, status: 0xb0, data1: 64, data2: 0, channel: 0, deviceId: "midi" });
    expect(audioSpies.release).toHaveBeenCalledWith("E4");
  });

  it("keeps repeated same-pitch occurrences active until the final note-off", async () => {
    await handleMidiMonitorEvent({ timeUs: 1_000, status: 0x90, data1: 60, data2: 90, channel: 0, deviceId: "midi" });
    await handleMidiMonitorEvent({ timeUs: 1_100, status: 0x90, data1: 60, data2: 80, channel: 0, deviceId: "midi" });
    audioSpies.release.mockClear();

    await handleMidiMonitorEvent({ timeUs: 2_000, status: 0x80, data1: 60, data2: 0, channel: 0, deviceId: "midi" });
    expect(audioSpies.release).not.toHaveBeenCalled();

    await handleMidiMonitorEvent({ timeUs: 2_100, status: 0x80, data1: 60, data2: 0, channel: 0, deviceId: "midi" });
    expect(audioSpies.release).toHaveBeenCalledWith("C4");
  });

  it("tracks the same pitch independently across MIDI channels", async () => {
    await handleMidiMonitorEvent({ timeUs: 1_000, status: 0x90, data1: 60, data2: 90, channel: 0, deviceId: "midi" });
    await handleMidiMonitorEvent({ timeUs: 1_100, status: 0x91, data1: 60, data2: 80, channel: 1, deviceId: "midi" });
    audioSpies.release.mockClear();

    await handleMidiMonitorEvent({ timeUs: 2_000, status: 0x80, data1: 60, data2: 0, channel: 0, deviceId: "midi" });
    expect(audioSpies.release).not.toHaveBeenCalled();

    await handleMidiMonitorEvent({ timeUs: 2_100, status: 0x81, data1: 60, data2: 0, channel: 1, deviceId: "midi" });
    expect(audioSpies.release).toHaveBeenCalledWith("C4");
  });

  it("schedules interpreted notes on the audio clock", async () => {
    const duration = await playPerformanceNotes([
      { id: "one", pitch: 60, scoreTick: 0, scoreGroupId: "g0", onsetUs: 1_000_000, offsetUs: 1_500_000, velocity: 0.7, synthesized: false },
      { id: "two", pitch: 64, scoreTick: 480, scoreGroupId: "g1", onsetUs: 1_250_000, offsetUs: 2_000_000, velocity: 0.6, synthesized: true },
    ]);
    expect(audioSpies.attack).toHaveBeenNthCalledWith(1, "C4", 10.06, 0.7);
    expect(audioSpies.release).toHaveBeenNthCalledWith(2, "E4", 11.06);
    expect(duration).toBe(1_000);
  });

  it("schedules a dense long trill without dropping attacks", async () => {
    const notes = Array.from({ length: 16 }, (_, index) => ({
      id: `trill-${index}`,
      pitch: index % 2 === 0 ? 77 : 79,
      scoreTick: 0,
      scoreGroupId: "trill",
      onsetUs: 1_000_000 + index * 75_000,
      offsetUs: 1_055_000 + index * 75_000,
      velocity: 0.62,
      synthesized: false,
    }));

    const duration = await playPerformanceNotes(notes);
    expect(audioSpies.attack).toHaveBeenCalledTimes(16);
    expect(audioSpies.release).toHaveBeenCalledTimes(16);
    expect(duration).toBe(1_180);
  });

  it("does not let an earlier release cut off a repeated pitch still held by pedal", async () => {
    const duration = await playPerformanceNotes([
      { id: "first", pitch: 60, scoreTick: 0, scoreGroupId: "g0", onsetUs: 1_000_000, offsetUs: 2_500_000, velocity: 0.7, synthesized: false },
      { id: "second", pitch: 60, scoreTick: 480, scoreGroupId: "g1", onsetUs: 1_500_000, offsetUs: 3_000_000, velocity: 0.6, synthesized: false },
    ]);
    expect(audioSpies.attack).toHaveBeenCalledTimes(2);
    expect(audioSpies.release).toHaveBeenCalledTimes(1);
    expect(audioSpies.release).toHaveBeenCalledWith("C4", 12.06);
    expect(duration).toBe(2_000);
  });

  it("keeps long performances inside a bounded lookahead window", async () => {
    vi.useFakeTimers();
    const notes = Array.from({ length: 120 }, (_, index) => ({
      id: `note-${index}`,
      pitch: 60 + index % 12,
      scoreTick: index * 480,
      scoreGroupId: `group-${index}`,
      onsetUs: index * 1_000_000,
      offsetUs: index * 1_000_000 + 500_000,
      velocity: 0.6,
      synthesized: false,
    }));

    const duration = await playPerformanceNotes(notes);
    expect(duration).toBe(119_500);
    expect(audioSpies.attack).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(1);

    toneClock.now = 11;
    await vi.advanceTimersByTimeAsync(250);
    expect(audioSpies.attack).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(1);

    cancelScheduledPlayback();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("starts a standardized performance from a requested progress position", async () => {
    const duration = await playPerformanceNotes([
      { id: "held", pitch: 60, scoreTick: 0, scoreGroupId: "g0", onsetUs: 1_000_000, offsetUs: 1_500_000, velocity: 0.7, synthesized: false },
      { id: "later", pitch: 64, scoreTick: 480, scoreGroupId: "g1", onsetUs: 2_000_000, offsetUs: 2_500_000, velocity: 0.6, synthesized: false },
    ], { startOffsetMs: 250 });

    expect(audioSpies.attack).toHaveBeenNthCalledWith(1, "C4", 10.06, 0.7);
    expect(audioSpies.attack).toHaveBeenNthCalledWith(2, "E4", 10.81, 0.6);
    expect(duration).toBe(1_250);
  });
});
