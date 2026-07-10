import { NoteGroup, PlaybackEvent } from "../types";
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
  baseUrl: "/audio/pianos/salamander-v8/",
  urls: salamanderUrls,
  volume: -8,
  release: 1.4,
};

let samplerPromise: Promise<InstrumentLike> | null = null;
let currentInstrument: InstrumentLike | null = null;
let playbackGeneration = 0;
let scheduledPlaybackTimers: number[] = [];

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

async function loadSampler(sound: PianoSound): Promise<InstrumentLike> {
  const Tone = await import("tone");
  await Tone.start();

  return new Promise((resolve, reject) => {
    let settled = false;
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
    }).toDestination();

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

  for (const event of mergePlaybackEvents(events)) {
    const notes = [...new Set(event.midis.map((midi) => midiToName(midi)))];
    if (notes.length === 0) {
      continue;
    }

    const offsetSeconds = ticksToSeconds(event.offsetTicks, bpm);
    const durationSeconds = Math.max(0.04, ticksToSeconds(event.durationTicks, bpm) * 0.9);
    const playEvent = () => {
      if (generation === playbackGeneration) {
        player.triggerAttackRelease(notes, durationSeconds);
      }
    };

    if (offsetSeconds <= 0) {
      playEvent();
      continue;
    }

    const timer = window.setTimeout(() => {
      scheduledPlaybackTimers = scheduledPlaybackTimers.filter((candidate) => candidate !== timer);
      playEvent();
    }, offsetSeconds * 1000);
    scheduledPlaybackTimers.push(timer);
  }

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
