import type { ScoreRange } from "../analysis/types";
import {
  scoreNoteRefId,
  scoreRangeToTickBounds,
  timelineTickToScorePosition,
  tickToScorePosition,
} from "../lib/scoreIdentity";
import type { Hand, ParsedNote, ScoreData } from "../types";
import { TICKS_PER_QUARTER } from "../types";
import type { PerformanceTimeAnchor, TranscribedPerformanceNote } from "./types";
import { interpolatePerformanceTime } from "./interpretation";

export const MIDI_ALIGNMENT_ALGORITHM_VERSION = "score-onset-dp-2-repeat-aware";

export interface ScoreOnset {
  tick: number;
  scorePosition: ScoreRange["start"];
  notes: ParsedNote[];
}

export interface MidiOnset {
  timeUs: number;
  notes: TranscribedPerformanceNote[];
}

export interface AlignedNoteMapping {
  scoreNote: ParsedNote | null;
  midiNote: TranscribedPerformanceNote | null;
  midiNotes?: TranscribedPerformanceNote[];
  status: "matched" | "pitch-substituted" | "omitted" | "extra" | "ornament-realized" | "uncertain";
  confidence: number;
}

export interface MidiScoreAlignment {
  mappings: AlignedNoteMapping[];
  timeMap: PerformanceTimeAnchor[];
  matchedNotes: number;
  substitutedNotes: number;
  ornamentNotes: number;
  omittedNotes: number;
  extraNotes: number;
  uncertainNotes: number;
  skippedRanges: ScoreRange[];
  scoreCoverage: number;
  performanceCoverage: number;
  confidence: number;
}

export interface MidiScoreAlignmentOptions {
  timeMap?: PerformanceTimeAnchor[];
  timeToleranceUs?: number;
  timeWeight?: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2
    : ordered[middle] ?? 0;
}

export function buildScoreOnsets(
  score: ScoreData,
  range: ScoreRange,
  hands: Hand[],
): ScoreOnset[] {
  const { startTick, endTick } = scoreRangeToTickBounds(score, range);
  const handSet = new Set(hands);
  const onsets = new Map<number, Map<string, ParsedNote>>();
  for (const group of score.noteGroups) {
    if (group.absoluteTick < startTick || group.absoluteTick >= endTick || !handSet.has(group.hand)) {
      continue;
    }
    const notesAtTick = onsets.get(group.absoluteTick) ?? new Map<string, ParsedNote>();
    for (const note of group.notes) {
      notesAtTick.set(scoreNoteRefId(note.scoreRef), note);
    }
    onsets.set(group.absoluteTick, notesAtTick);
  }
  return Array.from(onsets, ([tick, notes]) => ({
    tick,
    scorePosition: tickToScorePosition(score, tick),
    notes: Array.from(notes.values()).sort((left, right) => left.midi - right.midi),
  })).sort((left, right) => left.tick - right.tick);
}

export function buildPerformanceScoreOnsets(
  score: ScoreData,
  range: ScoreRange,
  hands: Hand[],
): ScoreOnset[] {
  if (!score.measurePlaybackOrder?.some((occurrence) => occurrence.playbackOccurrence > 0)) {
    return buildScoreOnsets(score, range, hands);
  }
  const { startTick, endTick } = scoreRangeToTickBounds(score, range);
  const handSet = new Set(hands);
  const onsets = new Map<number, Map<string, ParsedNote>>();
  for (const occurrence of score.measurePlaybackOrder) {
    for (const group of score.noteGroups) {
      if (
        group.measureIndex !== occurrence.measureIndex
        || group.absoluteTick < startTick
        || group.absoluteTick >= endTick
        || !handSet.has(group.hand)
      ) continue;
      const timelineTick = occurrence.timelineStartTick + group.startTick;
      const notesAtTick = onsets.get(timelineTick) ?? new Map<string, ParsedNote>();
      for (const note of group.notes) {
        const scoreRef = { ...note.scoreRef, playbackOccurrence: occurrence.playbackOccurrence };
        const expandedNote: ParsedNote = {
          ...note,
          id: scoreNoteRefId(scoreRef),
          scoreRef,
          absoluteTick: timelineTick,
        };
        notesAtTick.set(expandedNote.id, expandedNote);
      }
      onsets.set(timelineTick, notesAtTick);
    }
  }
  return Array.from(onsets, ([tick, notes]) => ({
    tick,
    scorePosition: timelineTickToScorePosition(score, tick),
    notes: Array.from(notes.values()).sort((left, right) => left.midi - right.midi),
  })).sort((left, right) => left.tick - right.tick);
}

export function groupMidiOnsets(notes: TranscribedPerformanceNote[], chordWindowUs = 30000): MidiOnset[] {
  const ordered = [...notes].sort((left, right) => left.keyDownUs - right.keyDownUs || left.pitch - right.pitch);
  const onsets: MidiOnset[] = [];
  for (const note of ordered) {
    const current = onsets.at(-1);
    const clusterStartUs = current?.notes[0]?.keyDownUs;
    if (!current || clusterStartUs == null || note.keyDownUs - clusterStartUs > chordWindowUs) {
      onsets.push({ timeUs: note.keyDownUs, notes: [note] });
      continue;
    }
    current.notes.push(note);
    current.timeUs = Math.round(median(current.notes.map((candidate) => candidate.keyDownUs)));
  }
  return onsets;
}

function combineMidiOnsets(onsets: MidiOnset[]): MidiOnset {
  const notes = onsets.flatMap((onset) => onset.notes);
  return {
    timeUs: Math.round(median(notes.map((note) => note.keyDownUs))),
    notes,
  };
}

function onsetMatchCost(
  scoreOnset: ScoreOnset,
  midiOnset: MidiOnset,
  expectedTimeUs?: number,
  options?: MidiScoreAlignmentOptions,
): number {
  const scorePitches = scoreOnset.notes.map((note) => note.midi);
  const midiPitches = midiOnset.notes.map((note) => note.pitch);
  const remainingMidi = [...midiPitches];
  let exact = 0;
  const remainingScore: number[] = [];
  for (const pitch of scorePitches) {
    const index = remainingMidi.indexOf(pitch);
    if (index >= 0) {
      exact += 1;
      remainingMidi.splice(index, 1);
    } else {
      remainingScore.push(pitch);
    }
  }

  let distance = 0;
  while (remainingScore.length > 0 && remainingMidi.length > 0) {
    let bestScoreIndex = 0;
    let bestMidiIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let scoreIndex = 0; scoreIndex < remainingScore.length; scoreIndex += 1) {
      for (let midiIndex = 0; midiIndex < remainingMidi.length; midiIndex += 1) {
        const candidate = Math.abs((remainingScore[scoreIndex] ?? 0) - (remainingMidi[midiIndex] ?? 0));
        if (candidate < bestDistance) {
          bestDistance = candidate;
          bestScoreIndex = scoreIndex;
          bestMidiIndex = midiIndex;
        }
      }
    }
    distance += Math.min(12, bestDistance);
    remainingScore.splice(bestScoreIndex, 1);
    remainingMidi.splice(bestMidiIndex, 1);
  }

  const maximumSize = Math.max(1, scorePitches.length, midiPitches.length);
  const exactRatio = exact / maximumSize;
  const sizeDifference = Math.abs(scorePitches.length - midiPitches.length) / maximumSize;
  const pitchDistance = distance / (12 * maximumSize);
  const pitchStructureCost = Math.min(
    1.9,
    0.08 + (1 - exactRatio) * 0.85 + sizeDifference * 0.55 + pitchDistance * 0.75,
  );
  if (expectedTimeUs == null) return pitchStructureCost;
  const toleranceUs = options?.timeToleranceUs ?? 500_000;
  const timeWeight = options?.timeWeight ?? 1.2;
  const normalizedTimeDistance = Math.min(
    1.75,
    Math.abs(midiOnset.timeUs - expectedTimeUs) / toleranceUs,
  );
  return pitchStructureCost + normalizedTimeDistance * timeWeight;
}

function gapCost(noteCount: number): number {
  return 1.02 + Math.min(0.4, Math.max(0, noteCount - 1) * 0.08);
}

function mapAlignedOnsets(scoreOnset: ScoreOnset, midiOnset: MidiOnset): AlignedNoteMapping[] {
  const remainingScore = [...scoreOnset.notes];
  const remainingMidi = [...midiOnset.notes];
  const mappings: AlignedNoteMapping[] = [];

  for (let scoreIndex = remainingScore.length - 1; scoreIndex >= 0; scoreIndex -= 1) {
    const scoreNote = remainingScore[scoreIndex];
    const midiIndex = remainingMidi.findIndex((note) => note.pitch === scoreNote.midi);
    if (midiIndex < 0) continue;
    const [midiNote] = remainingMidi.splice(midiIndex, 1);
    remainingScore.splice(scoreIndex, 1);
    mappings.push({ scoreNote, midiNote, midiNotes: [midiNote], status: "matched", confidence: 1 });
  }

  const ornamentAssignments = new Map<AlignedNoteMapping, TranscribedPerformanceNote[]>();
  const ornamentEvents = new Set<TranscribedPerformanceNote>();
  for (const candidate of remainingMidi) {
    const target = mappings
      .flatMap((mapping) => {
        if (!mapping.scoreNote || !mapping.midiNote || mapping.status !== "matched") return [];
        const pitchDistance = Math.abs(mapping.scoreNote.midi - candidate.pitch);
        const timeDistanceUs = Math.abs(mapping.midiNote.keyDownUs - candidate.keyDownUs);
        const notatedRealizationPitches = new Set(
          mapping.scoreNote.playbackEvents.flatMap((event) => event.midis),
        );
        const isRepeatedMainPitch = mapping.scoreNote.playbackEvents.length > 1
          && candidate.pitch === mapping.scoreNote.midi;
        const isNotatedOrnamentPitch = mapping.scoreNote.playbackEvents.length > 1
          && notatedRealizationPitches.has(candidate.pitch);
        if (
          (!isRepeatedMainPitch && !isNotatedOrnamentPitch)
          || pitchDistance > 2
          || timeDistanceUs <= 30_000
          || timeDistanceUs > 350_000
        ) return [];
        return [{ mapping, pitchDistance, timeDistanceUs }];
      })
      .sort((left, right) =>
        left.pitchDistance - right.pitchDistance || left.timeDistanceUs - right.timeDistanceUs)[0];
    if (!target) continue;
    const assigned = ornamentAssignments.get(target.mapping) ?? [];
    assigned.push(candidate);
    ornamentAssignments.set(target.mapping, assigned);
    ornamentEvents.add(candidate);
  }
  for (const [mapping, assigned] of ornamentAssignments) {
    mapping.status = "ornament-realized";
    mapping.midiNotes = [mapping.midiNote!, ...assigned]
      .sort((left, right) => left.keyDownUs - right.keyDownUs || left.pitch - right.pitch);
    const maximumPitchDistance = Math.max(...assigned.map((note) => Math.abs(mapping.scoreNote!.midi - note.pitch)));
    mapping.confidence = Math.min(mapping.confidence, Math.max(0.6, 0.9 - maximumPitchDistance * 0.12));
  }
  for (let index = remainingMidi.length - 1; index >= 0; index -= 1) {
    if (ornamentEvents.has(remainingMidi[index])) remainingMidi.splice(index, 1);
  }

  while (remainingScore.length > 0 && remainingMidi.length > 0) {
    let bestScoreIndex = 0;
    let bestMidiIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let scoreIndex = 0; scoreIndex < remainingScore.length; scoreIndex += 1) {
      for (let midiIndex = 0; midiIndex < remainingMidi.length; midiIndex += 1) {
        const candidate = Math.abs(remainingScore[scoreIndex].midi - remainingMidi[midiIndex].pitch);
        if (candidate < bestDistance) {
          bestDistance = candidate;
          bestScoreIndex = scoreIndex;
          bestMidiIndex = midiIndex;
        }
      }
    }

    if (bestDistance > 7) break;
    const [scoreNote] = remainingScore.splice(bestScoreIndex, 1);
    const [midiNote] = remainingMidi.splice(bestMidiIndex, 1);
    const confidence = Math.max(0.35, 1 - bestDistance / 9);
    mappings.push({
      scoreNote,
      midiNote,
      midiNotes: [midiNote],
      status: confidence < 0.5 ? "uncertain" : "pitch-substituted",
      confidence,
    });
  }

  for (const scoreNote of remainingScore) {
    mappings.push({ scoreNote, midiNote: null, status: "omitted", confidence: 0.9 });
  }
  for (const midiNote of remainingMidi) {
    mappings.push({ scoreNote: null, midiNote, status: "extra", confidence: 0.9 });
  }
  return mappings;
}

function hasNotatedRealization(note: ParsedNote): boolean {
  return Boolean(
    note.ornament
    || note.graceNotes?.length
    || note.playbackEvents.length > 1
    || note.playbackEvents.some((event) => event.midis.some((midi) => midi !== note.midi)),
  );
}

function realizationPitchSet(note: ParsedNote): Set<number> {
  const pitches = new Set<number>([
    note.midi,
    ...note.playbackEvents.flatMap((event) => event.midis),
    ...(note.ornament?.expectedPitches ?? []),
    ...(note.graceNotes?.map((grace) => grace.midi) ?? []),
  ]);
  if (note.ornament) {
    pitches.add(note.midi - 2);
    pitches.add(note.midi - 1);
    pitches.add(note.midi + 1);
    pitches.add(note.midi + 2);
  }
  return pitches;
}

function collectContiguousEvents(
  ordered: TranscribedPerformanceNote[],
  anchorUs: number,
  minimumUs: number,
  maximumUs: number,
  maximumGapUs: number,
): TranscribedPerformanceNote[] {
  const inWindow = ordered.filter((note) => note.keyDownUs >= minimumUs && note.keyDownUs <= maximumUs);
  if (inWindow.length === 0) return [];
  let anchorIndex = inWindow.reduce((bestIndex, note, index) =>
    Math.abs(note.keyDownUs - anchorUs) < Math.abs(inWindow[bestIndex].keyDownUs - anchorUs)
      ? index
      : bestIndex, 0);
  let startIndex = anchorIndex;
  let endIndex = anchorIndex;
  while (
    startIndex > 0
    && inWindow[startIndex].keyDownUs - inWindow[startIndex - 1].keyDownUs <= maximumGapUs
  ) startIndex -= 1;
  while (
    endIndex + 1 < inWindow.length
    && inWindow[endIndex + 1].keyDownUs - inWindow[endIndex].keyDownUs <= maximumGapUs
  ) endIndex += 1;
  anchorIndex = Math.max(startIndex, Math.min(endIndex, anchorIndex));
  return inWindow.slice(startIndex, endIndex + 1);
}

/**
 * Reclaims transcribed events that the onset DP necessarily leaves as extras
 * when one notated note expands into a grace cluster, turn, mordent, or a long
 * trill. This pass runs after the global structural alignment, so ordinary
 * wrong notes remain residual while score-declared one-to-many gestures can
 * retain their complete performed sequence.
 */
function attachNotatedRealizations(mappings: AlignedNoteMapping[]): AlignedNoteMapping[] {
  const extras = mappings.filter((mapping) => mapping.status === "extra" && mapping.midiNote);
  const assignedExtras = new Set<AlignedNoteMapping>();
  const scoreMappings = mappings
    .filter((mapping): mapping is AlignedNoteMapping & { scoreNote: ParsedNote } => Boolean(mapping.scoreNote))
    .sort((left, right) => left.scoreNote.absoluteTick - right.scoreNote.absoluteTick);

  for (const mapping of scoreMappings) {
    const scoreNote = mapping.scoreNote;
    if (!hasNotatedRealization(scoreNote)) continue;
    const allowedPitches = realizationPitchSet(scoreNote);
    const primary = mapping.midiNotes ?? (mapping.midiNote ? [mapping.midiNote] : []);
    const anchorUs = mapping.midiNote?.keyDownUs
      ?? scoreMappings
        .filter((candidate) => candidate.scoreNote.absoluteTick > scoreNote.absoluteTick && candidate.midiNote)
        .map((candidate) => candidate.midiNote!.keyDownUs)[0];
    if (anchorUs == null) continue;

    const nextBoundaryUs = scoreMappings
      .filter((candidate) =>
        candidate.scoreNote.absoluteTick >= scoreNote.absoluteTick + scoreNote.durationTicks
        && candidate.midiNote
        && candidate.midiNote.keyDownUs > anchorUs)
      .map((candidate) => candidate.midiNote!.keyDownUs)
      .sort((left, right) => left - right)[0];
    const isLongTrill = scoreNote.ornament?.kind === "trill" && scoreNote.ornament.hasWavyLine;
    const hasGrace = Boolean(scoreNote.graceNotes?.length);
    const minimumUs = anchorUs - (isLongTrill ? 1_500_000 : hasGrace ? 800_000 : 300_000);
    const maximumUs = Math.min(
      anchorUs + (isLongTrill ? 4_000_000 : hasGrace ? 500_000 : 1_200_000),
      nextBoundaryUs == null
        ? Number.POSITIVE_INFINITY
        : nextBoundaryUs + (isLongTrill ? 1_000_000 : 250_000),
    );
    const candidateExtras = extras
      .filter((candidate) =>
        !assignedExtras.has(candidate)
        && candidate.midiNote
        && allowedPitches.has(candidate.midiNote.pitch))
      .map((candidate) => candidate.midiNote!)
      .sort((left, right) => left.keyDownUs - right.keyDownUs || left.pitch - right.pitch);
    const contiguous = collectContiguousEvents(
      [...primary, ...candidateExtras]
        .filter((note, index, values) => values.findIndex((candidate) => candidate.id === note.id) === index)
        .sort((left, right) => left.keyDownUs - right.keyDownUs || left.pitch - right.pitch),
      anchorUs,
      minimumUs,
      maximumUs,
      isLongTrill ? 550_000 : 300_000,
    );
    const expectedCount = scoreNote.playbackEvents.length;
    const realizationNotes = isLongTrill
      ? contiguous
      : contiguous
        .sort((left, right) => left.keyDownUs - right.keyDownUs || left.pitch - right.pitch)
        .slice(0, Math.max(expectedCount + 2, 4));
    if (
      realizationNotes.length < 2
      || new Set(realizationNotes.map((note) => note.pitch)).size < 2
    ) continue;

    mapping.status = "ornament-realized";
    mapping.midiNotes = realizationNotes;
    mapping.confidence = Math.min(
      0.92,
      Math.max(0.62, 0.62 + Math.min(0.25, (realizationNotes.length - 2) * 0.025)),
    );
    const realizationIds = new Set(realizationNotes.map((note) => note.id));
    for (const candidate of extras) {
      if (candidate.midiNote && realizationIds.has(candidate.midiNote.id)) assignedExtras.add(candidate);
    }
  }

  return mappings.filter((mapping) => !assignedExtras.has(mapping));
}

function detectSkippedRanges(
  score: ScoreData,
  scoreOnsets: ScoreOnset[],
  mappings: AlignedNoteMapping[],
): ScoreRange[] {
  const statusByRef = new Map(
    mappings.flatMap((mapping) => mapping.scoreNote
      ? [[scoreNoteRefId(mapping.scoreNote.scoreRef), mapping.status] as const]
      : []),
  );
  const states = scoreOnsets.map((onset) => {
    const statuses = onset.notes.map((note) => statusByRef.get(scoreNoteRefId(note.scoreRef)));
    return {
      tick: onset.tick,
      scorePosition: onset.scorePosition,
      observed: statuses.some((status) =>
        status === "matched" || status === "pitch-substituted" || status === "ornament-realized"),
      omitted: statuses.length > 0 && statuses.every((status) => status === "omitted"),
    };
  });
  const ranges: ScoreRange[] = [];
  let runStart = -1;
  for (let index = 0; index <= states.length; index += 1) {
    if (states[index]?.omitted) {
      if (runStart < 0) runStart = index;
      continue;
    }
    if (runStart < 0) continue;
    const runEnd = index - 1;
    const previousObserved = states.slice(0, runStart).some((state) => state.observed);
    const nextObserved = states.slice(index).some((state) => state.observed);
    const startTick = states[runStart]?.tick ?? 0;
    const endTick = states[index]?.tick ?? score.totalTicks;
    if (
      previousObserved
      && nextObserved
      && runEnd - runStart + 1 >= 4
      && endTick - startTick >= TICKS_PER_QUARTER * 2
    ) {
      ranges.push({
        start: states[runStart]?.scorePosition ?? tickToScorePosition(score, startTick),
        end: states[index]?.scorePosition ?? tickToScorePosition(score, endTick),
      });
    }
    runStart = -1;
  }
  return ranges;
}

function alignMidiToScoreOnsets(
  score: ScoreData,
  scoreOnsets: ScoreOnset[],
  midiNotes: TranscribedPerformanceNote[],
  options?: MidiScoreAlignmentOptions,
): MidiScoreAlignment {
  const midiOnsets = groupMidiOnsets(midiNotes);
  const rows = scoreOnsets.length + 1;
  const columns = midiOnsets.length + 1;
  const costs = new Float64Array(rows * columns);
  const operations = new Uint8Array(rows * columns);
  const indexOf = (row: number, column: number) => row * columns + column;

  for (let row = 1; row < rows; row += 1) {
    costs[indexOf(row, 0)] = costs[indexOf(row - 1, 0)] + gapCost(scoreOnsets[row - 1].notes.length);
    operations[indexOf(row, 0)] = 2;
  }
  for (let column = 1; column < columns; column += 1) {
    costs[indexOf(0, column)] = costs[indexOf(0, column - 1)] + gapCost(midiOnsets[column - 1].notes.length);
    operations[indexOf(0, column)] = 3;
  }

  for (let row = 1; row < rows; row += 1) {
    const expectedTimeUs = options?.timeMap
      ? interpolatePerformanceTime(score, options.timeMap, scoreOnsets[row - 1].tick)?.timeUs
      : undefined;
    for (let column = 1; column < columns; column += 1) {
      const match = costs[indexOf(row - 1, column - 1)]
        + onsetMatchCost(scoreOnsets[row - 1], midiOnsets[column - 1], expectedTimeUs, options);
      const omit = costs[indexOf(row - 1, column)] + gapCost(scoreOnsets[row - 1].notes.length);
      const extra = costs[indexOf(row, column - 1)] + gapCost(midiOnsets[column - 1].notes.length);
      const currentIndex = indexOf(row, column);
      const candidates = [
        { cost: match, operation: 1 },
        { cost: omit, operation: 2 },
        { cost: extra, operation: 3 },
      ];
      if (column >= 2) {
        candidates.push({
          cost: costs[indexOf(row - 1, column - 2)]
            + onsetMatchCost(
              scoreOnsets[row - 1],
              combineMidiOnsets(midiOnsets.slice(column - 2, column)),
              expectedTimeUs,
              options,
            )
            + 0.1,
          operation: 4,
        });
      }
      if (column >= 3) {
        candidates.push({
          cost: costs[indexOf(row - 1, column - 3)]
            + onsetMatchCost(
              scoreOnsets[row - 1],
              combineMidiOnsets(midiOnsets.slice(column - 3, column)),
              expectedTimeUs,
              options,
            )
            + 0.18,
          operation: 5,
        });
      }
      const best = candidates.reduce((left, right) => right.cost < left.cost ? right : left);
      costs[currentIndex] = best.cost;
      operations[currentIndex] = best.operation;
    }
  }

  const onsetPairs: Array<{ scoreOnset: ScoreOnset | null; midiOnset: MidiOnset | null }> = [];
  let row = scoreOnsets.length;
  let column = midiOnsets.length;
  while (row > 0 || column > 0) {
    const operation = operations[indexOf(row, column)];
    if (operation === 1) {
      onsetPairs.push({ scoreOnset: scoreOnsets[row - 1], midiOnset: midiOnsets[column - 1] });
      row -= 1;
      column -= 1;
    } else if (operation === 4) {
      onsetPairs.push({
        scoreOnset: scoreOnsets[row - 1],
        midiOnset: combineMidiOnsets(midiOnsets.slice(column - 2, column)),
      });
      row -= 1;
      column -= 2;
    } else if (operation === 5) {
      onsetPairs.push({
        scoreOnset: scoreOnsets[row - 1],
        midiOnset: combineMidiOnsets(midiOnsets.slice(column - 3, column)),
      });
      row -= 1;
      column -= 3;
    } else if (operation === 2) {
      onsetPairs.push({ scoreOnset: scoreOnsets[row - 1], midiOnset: null });
      row -= 1;
    } else {
      onsetPairs.push({ scoreOnset: null, midiOnset: midiOnsets[column - 1] });
      column -= 1;
    }
  }
  onsetPairs.reverse();

  const mappings: AlignedNoteMapping[] = [];
  const timeMap: PerformanceTimeAnchor[] = [];
  for (const pair of onsetPairs) {
    if (pair.scoreOnset && pair.midiOnset) {
      const onsetMappings = mapAlignedOnsets(pair.scoreOnset, pair.midiOnset);
      mappings.push(...onsetMappings);
      const observed = onsetMappings.filter((mapping) =>
        mapping.scoreNote
        && mapping.midiNote
        && (mapping.status === "matched"
          || mapping.status === "pitch-substituted"
          || mapping.status === "ornament-realized"));
      if (observed.length > 0) {
        timeMap.push({
          scorePosition: pair.scoreOnset.scorePosition,
          timeUs: Math.round(median(observed.map((mapping) => mapping.midiNote!.keyDownUs))),
          confidence: median(observed.map((mapping) => mapping.confidence)),
        });
      }
    } else if (pair.scoreOnset) {
      mappings.push(...pair.scoreOnset.notes.map((scoreNote) => ({
        scoreNote,
        midiNote: null,
        status: "omitted" as const,
        confidence: 0.9,
      })));
    } else if (pair.midiOnset) {
      mappings.push(...pair.midiOnset.notes.map((midiNote) => ({
        scoreNote: null,
        midiNote,
        status: "extra" as const,
        confidence: 0.9,
      })));
    }
  }

  const realizedMappings = attachNotatedRealizations(mappings);
  const matchedNotes = realizedMappings.filter((mapping) => mapping.status === "matched").length;
  const substitutedNotes = realizedMappings.filter((mapping) => mapping.status === "pitch-substituted").length;
  const ornamentNotes = realizedMappings.filter((mapping) => mapping.status === "ornament-realized").length;
  const omittedNotes = realizedMappings.filter((mapping) => mapping.status === "omitted").length;
  const extraNotes = realizedMappings.filter((mapping) => mapping.status === "extra").length;
  const uncertainNotes = realizedMappings.filter((mapping) => mapping.status === "uncertain").length;
  const mappedScoreNotes = matchedNotes + substitutedNotes + ornamentNotes;
  const mappedPerformanceNotes = realizedMappings
    .filter((mapping) => mapping.status === "matched"
      || mapping.status === "pitch-substituted"
      || mapping.status === "ornament-realized")
    .reduce((sum, mapping) => sum + (mapping.midiNotes?.length ?? (mapping.midiNote ? 1 : 0)), 0);
  const scoreNoteCount = mappedScoreNotes + omittedNotes + uncertainNotes;
  const performanceNoteCount = mappedPerformanceNotes + extraNotes + uncertainNotes;
  const skippedRanges = detectSkippedRanges(score, scoreOnsets, realizedMappings);
  const reliableMappings = realizedMappings.filter((mapping) =>
    mapping.status === "matched"
    || mapping.status === "pitch-substituted"
    || mapping.status === "ornament-realized");
  const mappingConfidence = reliableMappings.length > 0
    ? reliableMappings.reduce((sum, mapping) => sum + mapping.confidence, 0) / reliableMappings.length
    : 0;
  const scoreCoverage = scoreNoteCount > 0 ? mappedScoreNotes / scoreNoteCount : 0;
  const performanceCoverage = performanceNoteCount > 0 ? mappedPerformanceNotes / performanceNoteCount : 0;
  const confidence = mappingConfidence * Math.sqrt(scoreCoverage * performanceCoverage);

  return {
    mappings: realizedMappings,
    timeMap,
    matchedNotes,
    substitutedNotes,
    ornamentNotes,
    omittedNotes,
    extraNotes,
    uncertainNotes,
    skippedRanges,
    scoreCoverage,
    performanceCoverage,
    confidence,
  };
}

export function alignMidiToScore(
  score: ScoreData,
  range: ScoreRange,
  hands: Hand[],
  midiNotes: TranscribedPerformanceNote[],
  options?: MidiScoreAlignmentOptions,
): MidiScoreAlignment {
  const writtenOnsets = buildScoreOnsets(score, range, hands);
  const written = alignMidiToScoreOnsets(score, writtenOnsets, midiNotes, options);
  const performanceOnsets = buildPerformanceScoreOnsets(score, range, hands);
  if (
    performanceOnsets.length === writtenOnsets.length
    && performanceOnsets.every((onset, index) => onset.tick === writtenOnsets[index]?.tick)
  ) return written;
  const unfolded = alignMidiToScoreOnsets(score, performanceOnsets, midiNotes, options);
  return unfolded.confidence > written.confidence ? unfolded : written;
}
