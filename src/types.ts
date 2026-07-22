export type Hand = "left" | "right";

export interface RationalNumber {
  numerator: number;
  denominator: number;
}

export interface ScoreNoteRef {
  partId: string;
  measureIndex: number;
  offsetQuarter: RationalNumber;
  staff: number;
  voice: string;
  writtenPitch: string;
  ordinalAtPosition: number;
  playbackOccurrence?: number;
}

export interface ParsedNote {
  id: string;
  scoreRef: ScoreNoteRef;
  midi: number;
  name: string;
  writtenName?: string;
  hand: Hand;
  staff: number;
  measureIndex: number;
  startTick: number;
  absoluteTick: number;
  durationTicks: number;
  playbackEvents: PlaybackEvent[];
  ornament?: NotatedOrnament;
  graceNotes?: NotatedGraceNote[];
}

export type NotatedOrnamentKind = "trill" | "mordent" | "inverted-mordent" | "turn" | "inverted-turn";

export interface NotatedOrnament {
  kind: NotatedOrnamentKind;
  hasWavyLine: boolean;
  expectedPitches: number[];
}

export interface NotatedGraceNote {
  midi: number;
  slash: boolean;
  order: number;
}

export interface NoteGroup {
  id: string;
  hand: Hand;
  measureIndex: number;
  startTick: number;
  absoluteTick: number;
  durationTicks: number;
  notes: ParsedNote[];
  playbackEvents: PlaybackEvent[];
}

export interface PlaybackEvent {
  midis: number[];
  offsetTicks: number;
  durationTicks: number;
}

export interface TimeSignature {
  beats: number;
  beatType: number;
}

export interface MeasurePlaybackOccurrence {
  measureIndex: number;
  playbackOccurrence: number;
  timelineStartTick: number;
  durationTicks: number;
}

export interface ScoreData {
  title: string;
  xml: string;
  noteGroups: NoteGroup[];
  /** MusicXML `<measure number>` values in written measure order. */
  measureNumbers?: string[];
  measureStarts: number[];
  measureDurations: number[];
  measureTimeSignatures: TimeSignature[];
  totalTicks: number;
  measurePlaybackOrder?: MeasurePlaybackOccurrence[];
  timelineTotalTicks?: number;
  canSeparateHands: boolean;
  hasLeftHand: boolean;
  hasRightHand: boolean;
}

export interface GroupLayout {
  groupId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MidiInputInfo {
  id: string;
  name: string;
}

export type MidiStatus = "unsupported" | "idle" | "requesting" | "ready" | "connected" | "error";

export interface MidiState {
  status: MidiStatus;
  inputs: MidiInputInfo[];
  selectedInputId: string | null;
  pressedNotes: number[];
  eventId: number;
  error: string | null;
}

export interface RawMidiEvent {
  timeUs: number;
  status: number;
  data1: number;
  data2: number;
  channel: number;
  deviceId: string;
}

export interface SelectionRange {
  startTick: number;
  endTick: number;
  hands: Hand[];
}

export interface SelectionState {
  range: SelectionRange | null;
  loopIndex: number;
}

export const TICKS_PER_QUARTER = 480;
