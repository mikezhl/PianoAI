export type Hand = "left" | "right";

export interface ParsedNote {
  id: string;
  midi: number;
  name: string;
  hand: Hand;
  staff: number;
  measureIndex: number;
  startTick: number;
  absoluteTick: number;
  durationTicks: number;
  playbackEvents: PlaybackEvent[];
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

export interface ScoreData {
  title: string;
  xml: string;
  noteGroups: NoteGroup[];
  measureStarts: number[];
  measureDurations: number[];
  totalTicks: number;
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
