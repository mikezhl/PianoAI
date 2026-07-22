import { NoteGroup, PlaybackEvent } from "../types";
import type { RawMidiEvent } from "../types";
import type { PerformancePlaybackNote } from "../performance/types";
import { resolveAppAssetUrl } from "./appUrl";
import { midiToName } from "./piano";
import { DEFAULT_PLAYBACK_BPM, ticksToSeconds } from "./playbackTiming";

interface PianoSound {
  label: string;
  baseUrl: string;
  urls: Record<string, string>;
  volume: number;
  release: number;
}

interface InstrumentLike {
  volume: { value: number };
  triggerAttack: (notes: string | string[], time?: string | number, velocity?: number) => void;
  triggerRelease: (notes: string | string[], time?: string | number) => void;
  triggerAttackRelease: (notes: string[], duration: string | number, time?: string | number) => void;
  releaseAll?: () => void;
  dispose?: () => void;
}

const salamanderUrls: Record<string, string> = {
  A0: "A0v8.mp3",
  A1: "A1v8.mp3",
  A2: "A2v8.mp3",
  A3: "A3v8.mp3",
  A4: "A4v8.mp3",
  A5: "A5v8.mp3",
  A6: "A6v8.mp3",
  A7: "A7v8.mp3",
  C1: "C1v8.mp3",
  C2: "C2v8.mp3",
  C3: "C3v8.mp3",
  C4: "C4v8.mp3",
  C5: "C5v8.mp3",
  C6: "C6v8.mp3",
  C7: "C7v8.mp3",
  C8: "C8v8.mp3",
  "D#1": "Ds1v8.mp3",
  "D#2": "Ds2v8.mp3",
  "D#3": "Ds3v8.mp3",
  "D#4": "Ds4v8.mp3",
  "D#5": "Ds5v8.mp3",
  "D#6": "Ds6v8.mp3",
  "D#7": "Ds7v8.mp3",
  "F#1": "Fs1v8.mp3",
  "F#2": "Fs2v8.mp3",
  "F#3": "Fs3v8.mp3",
  "F#4": "Fs4v8.mp3",
  "F#5": "Fs5v8.mp3",
  "F#6": "Fs6v8.mp3",
  "F#7": "Fs7v8.mp3",
};

const salamanderGrand: PianoSound = {
  label: "Salamander Grand",
  baseUrl: resolveAppAssetUrl("/audio/piano/salamander-v8/"),
  urls: salamanderUrls,
  volume: -8,
  release: 1.4,
};

let samplerPromise: Promise<InstrumentLike> | null = null;
let currentInstrument: InstrumentLike | null = null;
let playbackGeneration = 0;
let scheduledPlaybackTimers: number[] = [];
let monitorOccurrenceId = 0;
const PLAYBACK_LOOKAHEAD_SECONDS = 2.5;
const PLAYBACK_SCHEDULER_INTERVAL_MS = 250;
export const PERFORMANCE_PLAYBACK_START_DELAY_MS = 60;

export interface PerformancePlaybackOptions {
  startOffsetMs?: number;
}

interface MonitorActiveNote {
  deviceId: string;
  channel: number;
  pitchName: string;
  occurrenceIds: number[];
}

interface MonitorSustainedNote {
  deviceId: string;
  channel: number;
  pitchName: string;
}

const monitorActiveNotes = new Map<string, MonitorActiveNote>();
const monitorSustainedNotes = new Map<string, MonitorSustainedNote>();
const monitorPedalDown = new Map<string, boolean>();

export function cancelScheduledPlayback(): void {
  playbackGeneration += 1;
  for (const timer of scheduledPlaybackTimers) {
    window.clearTimeout(timer);
  }
  scheduledPlaybackTimers = [];
  currentInstrument?.releaseAll?.();
}

function beginPlaybackBatch(): number {
  cancelScheduledPlayback();
  return playbackGeneration;
}

function scheduleAudioClockEvents<T>(
  events: T[],
  generation: number,
  now: () => number,
  eventAudioTime: (event: T) => number,
  scheduleEvent: (event: T, audioTime: number) => void,
): void {
  let nextEventIndex = 0;
  const scheduleWindow = () => {
    if (generation !== playbackGeneration) return;
    const currentTime = now();
    const horizon = currentTime + PLAYBACK_LOOKAHEAD_SECONDS;
    while (nextEventIndex < events.length) {
      const event = events[nextEventIndex];
      const intendedAudioTime = eventAudioTime(event);
      if (intendedAudioTime > horizon) break;
      scheduleEvent(event, Math.max(intendedAudioTime, currentTime + 0.01));
      nextEventIndex += 1;
    }
    if (nextEventIndex >= events.length || generation !== playbackGeneration) return;
    const timer = window.setTimeout(() => {
      scheduledPlaybackTimers = scheduledPlaybackTimers.filter((candidate) => candidate !== timer);
      scheduleWindow();
    }, PLAYBACK_SCHEDULER_INTERVAL_MS);
    scheduledPlaybackTimers.push(timer);
  };
  scheduleWindow();
}

async function loadSampler(sound: PianoSound): Promise<InstrumentLike> {
  const Tone = await import("tone");
  await Tone.start();

  return new Promise((resolve, reject) => {
    let settled = false;
    const limiter = new Tone.Limiter(-1).toDestination();
    const sampler = new Tone.Sampler({
      urls: sound.urls,
      baseUrl: sound.baseUrl,
      release: sound.release,
      onload: () => {
        settled = true;
        resolve(sampler);
      },
      onerror: (error: unknown) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      },
    }).connect(limiter);

    sampler.volume.value = sound.volume;
  });
}

async function getInstrument(): Promise<InstrumentLike | null> {
  if (!samplerPromise) {
    samplerPromise = loadSampler(salamanderGrand);
  }

  try {
    const instrument = await samplerPromise;
    currentInstrument = instrument ?? null;
    return instrument ?? null;
  } catch (error) {
    samplerPromise = null;
    console.error(`Failed to load piano sound: ${salamanderGrand.label}`, error);
    return null;
  }
}

export async function playGroups(
  groups: NoteGroup[],
  duration = "8n",
  bpm = DEFAULT_PLAYBACK_BPM,
): Promise<void> {
  if (groups.length === 0) {
    return;
  }

  const generation = beginPlaybackBatch();
  const playbackEvents = groups.flatMap((group) =>
    group.playbackEvents.length > 0
      ? group.playbackEvents
      : [{
          midis: group.notes.map((note) => note.midi),
          offsetTicks: 0,
          durationTicks: group.durationTicks,
        }],
  );

  if (playbackEvents.length > 0) {
    await playPlaybackEvents(playbackEvents, bpm, generation);
    return;
  }

  await playMidiNotes(
    groups.flatMap((group) => group.notes.map((note) => note.midi)),
    duration,
  );
}

export function buildScoreRangePlaybackEvents(
  groups: NoteGroup[],
  rangeStartTick: number,
  rangeEndTick: number,
): PlaybackEvent[] {
  return groups.flatMap((group) => {
    const events = group.playbackEvents.length > 0
      ? group.playbackEvents
      : [{
          midis: group.notes.map((note) => note.midi),
          offsetTicks: 0,
          durationTicks: group.durationTicks,
        }];
    return events.flatMap((event) => {
      const eventStartTick = group.absoluteTick + event.offsetTicks;
      const eventEndTick = eventStartTick + event.durationTicks;
      const clippedStartTick = Math.max(rangeStartTick, eventStartTick);
      const clippedEndTick = Math.min(rangeEndTick, eventEndTick);
      if (clippedStartTick >= clippedEndTick) {
        return [];
      }
      return [{
        ...event,
        offsetTicks: clippedStartTick - rangeStartTick,
        durationTicks: clippedEndTick - clippedStartTick,
      }];
    });
  });
}

export async function playScoreRange(
  groups: NoteGroup[],
  bpm: number,
  rangeStartTick: number,
  rangeEndTick: number,
): Promise<boolean> {
  if (groups.length === 0) {
    return false;
  }

  const generation = beginPlaybackBatch();
  const playbackEvents = buildScoreRangePlaybackEvents(groups, rangeStartTick, rangeEndTick);
  if (playbackEvents.length === 0) {
    return false;
  }

  return playPlaybackEvents(playbackEvents, bpm, generation);
}

async function playPlaybackEvents(events: PlaybackEvent[], bpm: number, generation: number): Promise<boolean> {
  const player = await getInstrument();
  if (!player || generation !== playbackGeneration) {
    return false;
  }

  const Tone = await import("tone");
  if (generation !== playbackGeneration) {
    return false;
  }
  const startTime = Tone.now();
  const scheduledEvents = mergePlaybackEvents(events).flatMap((event) => {
    const notes = [...new Set(event.midis.map((midi) => midiToName(midi)))];
    return notes.length > 0 ? [{
      notes,
      offsetSeconds: ticksToSeconds(event.offsetTicks, bpm),
      durationSeconds: Math.max(0.04, ticksToSeconds(event.durationTicks, bpm) * 0.9),
    }] : [];
  });
  scheduleAudioClockEvents(
    scheduledEvents,
    generation,
    Tone.now,
    (event) => startTime + event.offsetSeconds,
    (event, audioTime) => player.triggerAttackRelease(event.notes, event.durationSeconds, audioTime),
  );

  return true;
}

function mergePlaybackEvents(events: PlaybackEvent[]): PlaybackEvent[] {
  const merged = new Map<string, PlaybackEvent>();

  for (const event of events) {
    const key = `${event.offsetTicks}:${event.durationTicks}`;
    const existing = merged.get(key);
    if (existing) {
      existing.midis.push(...event.midis);
    } else {
      merged.set(key, { ...event, midis: [...event.midis] });
    }
  }

  return Array.from(merged.values()).sort((a, b) => a.offsetTicks - b.offsetTicks);
}

export async function playMidiNotes(midis: number[], duration = "8n"): Promise<void> {
  if (midis.length === 0) {
    return;
  }

  const player = await getInstrument();
  if (!player) {
    return;
  }

  const notes = [...new Set(midis.map((midi) => midiToName(midi)))];
  player.triggerAttackRelease(notes, duration);
}

export async function playPerformanceNotes(
  notes: PerformancePlaybackNote[],
  options: PerformancePlaybackOptions = {},
): Promise<number> {
  if (notes.length === 0) return 0;
  const generation = beginPlaybackBatch();
  const player = await getInstrument();
  if (!player || generation !== playbackGeneration) return 0;
  const Tone = await import("tone");
  const completeTimeline = notes
    .map((note) => ({ ...note, offsetUs: Math.max(note.onsetUs + 40_000, note.offsetUs) }))
    .sort((left, right) => left.onsetUs - right.onsetUs || left.pitch - right.pitch);
  const originUs = completeTimeline[0].onsetUs;
  const endUs = Math.max(originUs, ...completeTimeline.map((note) => note.offsetUs));
  const startUs = Math.max(
    originUs,
    Math.min(endUs, originUs + Math.max(0, options.startOffsetMs ?? 0) * 1000),
  );
  const ordered = completeTimeline
    .filter((note) => note.offsetUs > startUs)
    .map((note) => note.onsetUs < startUs ? { ...note, onsetUs: startUs } : note);
  if (ordered.length === 0) return 0;
  const startTime = Tone.now() + PERFORMANCE_PLAYBACK_START_DELAY_MS / 1000;
  const notesByPitch = new Map<number, typeof ordered>();
  for (const note of ordered) {
    const pitchNotes = notesByPitch.get(note.pitch) ?? [];
    pitchNotes.push(note);
    notesByPitch.set(note.pitch, pitchNotes);
  }
  const releaseEvents: Array<{ pitch: number; timeUs: number }> = [];
  for (const [pitch, pitchNotes] of notesByPitch) {
    let soundingUntilUs: number | null = null;
    for (const note of pitchNotes) {
      if (soundingUntilUs != null && note.onsetUs > soundingUntilUs) {
        releaseEvents.push({ pitch, timeUs: soundingUntilUs });
        soundingUntilUs = note.offsetUs;
      } else {
        soundingUntilUs = Math.max(soundingUntilUs ?? note.offsetUs, note.offsetUs);
      }
    }
    if (soundingUntilUs != null) {
      releaseEvents.push({ pitch, timeUs: soundingUntilUs });
    }
  }
  const playbackEvents = [
    ...ordered.map((note) => ({ kind: "attack" as const, timeUs: note.onsetUs, note })),
    ...releaseEvents.map((release) => ({ kind: "release" as const, timeUs: release.timeUs, release })),
  ].sort((left, right) => left.timeUs - right.timeUs || (left.kind === "release" ? -1 : 1));
  scheduleAudioClockEvents(
    playbackEvents,
    generation,
    Tone.now,
    (event) => startTime + Math.max(0, event.timeUs - startUs) / 1_000_000,
    (event, audioTime) => {
      if (event.kind === "attack") {
        player.triggerAttack(
          midiToName(event.note.pitch),
          audioTime,
          Math.max(0.05, Math.min(1, event.note.velocity)),
        );
      } else {
        player.triggerRelease(midiToName(event.release.pitch), audioTime);
      }
    },
  );
  return Math.max(0, (endUs - startUs) / 1000);
}

function monitorChannelKey(deviceId: string, channel: number): string {
  return `${deviceId}\u0000${channel}`;
}

function monitorNoteKey(deviceId: string, channel: number, pitch: number): string {
  return `${monitorChannelKey(deviceId, channel)}\u0000${pitch}`;
}

function pitchStillSounding(pitchName: string): boolean {
  return Array.from(monitorActiveNotes.values()).some((note) =>
    note.pitchName === pitchName && note.occurrenceIds.length > 0)
    || Array.from(monitorSustainedNotes.values()).some((note) => note.pitchName === pitchName);
}

async function releaseMonitorPitches(pitchNames: Iterable<string>): Promise<void> {
  const releasable = [...new Set(pitchNames)].filter((pitchName) => !pitchStillSounding(pitchName));
  if (releasable.length === 0) return;
  const player = await getInstrument();
  player?.triggerRelease(releasable.length === 1 ? releasable[0] : releasable);
}

export async function handleMidiMonitorEvent(event: RawMidiEvent): Promise<void> {
  const command = event.status & 0xf0;
  const channelKey = monitorChannelKey(event.deviceId, event.channel);
  const key = monitorNoteKey(event.deviceId, event.channel, event.data1);
  const pitchName = midiToName(event.data1);
  const isNoteOn = command === 0x90 && event.data2 > 0;
  const isNoteOff = command === 0x80 || (command === 0x90 && event.data2 === 0);

  if (isNoteOn) {
    const occurrenceId = monitorOccurrenceId + 1;
    monitorOccurrenceId = occurrenceId;
    const current = monitorActiveNotes.get(key);
    monitorActiveNotes.set(key, {
      deviceId: event.deviceId,
      channel: event.channel,
      pitchName,
      occurrenceIds: [...(current?.occurrenceIds ?? []), occurrenceId],
    });
    monitorSustainedNotes.delete(key);
    const player = await getInstrument();
    if (player && monitorActiveNotes.get(key)?.occurrenceIds.includes(occurrenceId)) {
      player.triggerAttack(pitchName, undefined, Math.max(0.05, event.data2 / 127));
    }
    return;
  }

  if (isNoteOff) {
    const current = monitorActiveNotes.get(key);
    if (!current) return;
    const [, ...remainingOccurrenceIds] = current.occurrenceIds;
    if (remainingOccurrenceIds.length > 0) {
      monitorActiveNotes.set(key, { ...current, occurrenceIds: remainingOccurrenceIds });
      return;
    }
    monitorActiveNotes.delete(key);
    if (monitorPedalDown.get(channelKey)) {
      monitorSustainedNotes.set(key, {
        deviceId: event.deviceId,
        channel: event.channel,
        pitchName,
      });
      return;
    }
    await releaseMonitorPitches([pitchName]);
    return;
  }

  if (command !== 0xb0) return;
  if (event.data1 === 64) {
    const wasDown = monitorPedalDown.get(channelKey) ?? false;
    const isDown = event.data2 >= 64;
    monitorPedalDown.set(channelKey, isDown);
    if (wasDown && !isDown) {
      const released = Array.from(monitorSustainedNotes.entries())
        .filter(([, note]) => note.deviceId === event.deviceId && note.channel === event.channel);
      released.forEach(([noteKey]) => monitorSustainedNotes.delete(noteKey));
      await releaseMonitorPitches(released.map(([, note]) => note.pitchName));
    }
    return;
  }

  if (event.data1 === 120 || event.data1 === 123) {
    const releasedPitches: string[] = [];
    for (const [noteKey, note] of monitorActiveNotes) {
      if (note.deviceId === event.deviceId && note.channel === event.channel) {
        releasedPitches.push(note.pitchName);
        monitorActiveNotes.delete(noteKey);
      }
    }
    for (const [noteKey, note] of monitorSustainedNotes) {
      if (note.deviceId === event.deviceId && note.channel === event.channel) {
        releasedPitches.push(note.pitchName);
        monitorSustainedNotes.delete(noteKey);
      }
    }
    monitorPedalDown.delete(channelKey);
    await releaseMonitorPitches(releasedPitches);
  }
}

export function resetMidiMonitor(): void {
  monitorOccurrenceId = 0;
  monitorActiveNotes.clear();
  monitorSustainedNotes.clear();
  monitorPedalDown.clear();
  currentInstrument?.releaseAll?.();
}
