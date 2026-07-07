import type { Hand, NoteGroup, ScoreData } from "../types";
import type { ScoreGroupLayout, ScoreStaffGeometry, StaffGeometry } from "./scoreOverlay";

export interface MidiScoreMarker {
  midi: number;
  hand: Hand;
  x: number;
  y: number;
  ledgerLines: number[];
}

interface BuildMidiScoreMarkersOptions {
  pressedNotes: number[];
  score: ScoreData;
  activeGroups: NoteGroup[];
  layouts: ScoreGroupLayout[];
  staffGeometry: ScoreStaffGeometry;
  progressX: number;
}

const PITCH_CLASS_TO_DIATONIC_STEP = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const TREBLE_BOTTOM_LINE_MIDI = 64;
const BASS_BOTTOM_LINE_MIDI = 43;
const MIDI_MARKER_X_OFFSET = 18;
const CHROMATIC_COLLISION_OFFSET = 8;

function midiToDiatonicIndex(midi: number): number {
  const octave = Math.floor(midi / 12) - 1;
  const pitchClass = ((midi % 12) + 12) % 12;
  return octave * 7 + PITCH_CLASS_TO_DIATONIC_STEP[pitchClass];
}

function resolveHand(
  midi: number,
  score: ScoreData,
  activeGroups: NoteGroup[],
  layoutsByGroupId: Map<string, ScoreGroupLayout>,
  progressX: number,
): Hand {
  const activeMatch = activeGroups.find((group) => group.notes.some((note) => note.midi === midi));
  if (activeMatch) {
    return activeMatch.hand;
  }

  const nearestScoreMatch = score.noteGroups
    .filter((group) => group.notes.some((note) => note.midi === midi))
    .map((group) => ({ group, layout: layoutsByGroupId.get(group.id) }))
    .filter((candidate): candidate is { group: NoteGroup; layout: ScoreGroupLayout } => candidate.layout != null)
    .sort((a, b) => Math.abs(a.layout.centerX - progressX) - Math.abs(b.layout.centerX - progressX))[0];

  return nearestScoreMatch?.group.hand ?? (midi < 60 ? "left" : "right");
}

function getGeometryForHand(hand: Hand, staffGeometry: ScoreStaffGeometry): StaffGeometry | null {
  return staffGeometry[hand] ?? staffGeometry.right ?? staffGeometry.left;
}

function markerY(midi: number, hand: Hand, geometry: StaffGeometry): number {
  const referenceMidi = hand === "right" ? TREBLE_BOTTOM_LINE_MIDI : BASS_BOTTOM_LINE_MIDI;
  const diatonicDistance = midiToDiatonicIndex(midi) - midiToDiatonicIndex(referenceMidi);
  return geometry.bottom - (diatonicDistance * geometry.spacing) / 2;
}

function ledgerLinesForY(y: number, geometry: StaffGeometry): number[] {
  const ledgerLines: number[] = [];
  const aboveCount = Math.floor((geometry.top - y) / geometry.spacing + 0.25);
  const belowCount = Math.floor((y - geometry.bottom) / geometry.spacing + 0.25);

  for (let index = 1; index <= aboveCount; index += 1) {
    ledgerLines.push(geometry.top - index * geometry.spacing);
  }

  for (let index = 1; index <= belowCount; index += 1) {
    ledgerLines.push(geometry.bottom + index * geometry.spacing);
  }

  return ledgerLines;
}

export function buildMidiScoreMarkers({
  pressedNotes,
  score,
  activeGroups,
  layouts,
  staffGeometry,
  progressX,
}: BuildMidiScoreMarkersOptions): MidiScoreMarker[] {
  const layoutsByGroupId = new Map(layouts.map((layout) => [layout.groupId, layout]));
  const collisionCounts = new Map<string, number>();

  return pressedNotes.flatMap((midi) => {
    const hand = resolveHand(midi, score, activeGroups, layoutsByGroupId, progressX);
    const geometry = getGeometryForHand(hand, staffGeometry);
    if (!geometry) {
      return [];
    }

    const y = markerY(midi, hand, geometry);
    const collisionKey = `${hand}:${Math.round(y)}`;
    const collisionIndex = collisionCounts.get(collisionKey) ?? 0;
    collisionCounts.set(collisionKey, collisionIndex + 1);

    return [{
      midi,
      hand,
      x: progressX + MIDI_MARKER_X_OFFSET + collisionIndex * CHROMATIC_COLLISION_OFFSET,
      y,
      ledgerLines: ledgerLinesForY(y, geometry),
    }];
  });
}
