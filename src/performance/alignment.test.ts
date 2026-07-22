import { describe, expect, it } from "vitest";
import type { ParsedNote, ScoreData } from "../types";
import { alignMidiToScore, buildScoreOnsets, groupMidiOnsets } from "./alignment";
import type { TranscribedPerformanceNote } from "./types";

function scoreNote(id: string, midi: number, tick: number, measureIndex: number, hand: "left" | "right"): ParsedNote {
  return {
    id,
    scoreRef: {
      partId: "P1",
      measureIndex,
      offsetQuarter: { numerator: 0, denominator: 1 },
      staff: hand === "right" ? 1 : 2,
      voice: "1",
      writtenPitch: `${midi}`,
      ordinalAtPosition: 0,
    },
    midi,
    name: `${midi}`,
    hand,
    staff: hand === "right" ? 1 : 2,
    measureIndex,
    startTick: 0,
    absoluteTick: tick,
    durationTicks: 480,
    playbackEvents: [],
  };
}

function midiNote(id: string, pitch: number, onset: number): TranscribedPerformanceNote {
  return {
    id,
    pitch,
    channel: 0,
    keyDownUs: onset,
    keyUpUs: onset + 300_000,
    attackVelocity: 80,
  };
}

const c4 = scoreNote("c4", 60, 0, 0, "right");
const c3 = scoreNote("c3", 48, 0, 0, "left");
const d4 = scoreNote("d4", 62, 480, 1, "right");
const e4 = scoreNote("e4", 64, 960, 2, "right");
const score: ScoreData = {
  title: "fixture",
  xml: "",
  noteGroups: [
    { id: "g1", hand: "right", measureIndex: 0, startTick: 0, absoluteTick: 0, durationTicks: 480, notes: [c4], playbackEvents: [] },
    { id: "g2", hand: "left", measureIndex: 0, startTick: 0, absoluteTick: 0, durationTicks: 480, notes: [c3], playbackEvents: [] },
    { id: "g3", hand: "right", measureIndex: 1, startTick: 0, absoluteTick: 480, durationTicks: 480, notes: [d4], playbackEvents: [] },
    { id: "g4", hand: "right", measureIndex: 2, startTick: 0, absoluteTick: 960, durationTicks: 480, notes: [e4], playbackEvents: [] },
  ],
  measureStarts: [0, 480, 960],
  measureDurations: [480, 480, 480],
  measureTimeSignatures: [{ beats: 4, beatType: 4 }, { beats: 4, beatType: 4 }, { beats: 4, beatType: 4 }],
  totalTicks: 1440,
  canSeparateHands: true,
  hasLeftHand: true,
  hasRightHand: true,
};
const range = {
  start: { measureIndex: 0, offsetQuarter: { numerator: 0, denominator: 1 } },
  end: { measureIndex: 3, offsetQuarter: { numerator: 0, denominator: 1 } },
};

describe("MIDI score alignment", () => {
  it("merges both staves at one score onset while preserving a rolled MIDI chord for multi-onset alignment", () => {
    expect(buildScoreOnsets(score, range, ["left", "right"])[0].notes.map((note) => note.midi)).toEqual([48, 60]);
    expect(groupMidiOnsets([midiNote("a", 48, 100_000), midiNote("b", 60, 150_000)])).toHaveLength(2);
    const alignment = alignMidiToScore(score, {
      start: range.start,
      end: { measureIndex: 1, offsetQuarter: { numerator: 0, denominator: 1 } },
    }, ["left", "right"], [midiNote("a", 48, 100_000), midiNote("b", 60, 150_000)]);
    expect(alignment.matchedNotes).toBe(2);
  });

  it("uses a score-informed time map to choose the intended repeated pitch occurrence", () => {
    const alignment = alignMidiToScore(score, {
      start: range.start,
      end: { measureIndex: 1, offsetQuarter: { numerator: 0, denominator: 1 } },
    }, ["right"], [
      midiNote("expected", 60, 100_000),
      midiNote("later-repeat", 60, 900_000),
    ], {
      timeMap: [
        {
          scorePosition: range.start,
          timeUs: 100_000,
          confidence: 0.9,
        },
        {
          scorePosition: { measureIndex: 1, offsetQuarter: { numerator: 0, denominator: 1 } },
          timeUs: 600_000,
          confidence: 0.9,
        },
      ],
    });

    expect(alignment.mappings.find((mapping) => mapping.status === "matched")?.midiNote?.id).toBe("expected");
  });

  it("maps a short neighboring-note realization and repeated attack to one score note", () => {
    const ornamentNote = {
      ...c4,
      playbackEvents: [
        { midis: [62], offsetTicks: 0, durationTicks: 120 },
        { midis: [60], offsetTicks: 120, durationTicks: 120 },
        { midis: [60], offsetTicks: 240, durationTicks: 120 },
      ],
    };
    const ornamentScore: ScoreData = {
      ...score,
      noteGroups: score.noteGroups.map((group) => group.id === "g1"
        ? { ...group, notes: [ornamentNote], playbackEvents: ornamentNote.playbackEvents }
        : group),
    };
    const alignment = alignMidiToScore(ornamentScore, {
      start: range.start,
      end: { measureIndex: 1, offsetQuarter: { numerator: 0, denominator: 1 } },
    }, ["right"], [
      midiNote("upper-neighbor", 62, 100_000),
      midiNote("main", 60, 180_000),
      midiNote("repeat", 60, 260_000),
    ]);

    expect(alignment).toMatchObject({
      matchedNotes: 0,
      ornamentNotes: 1,
      omittedNotes: 0,
      extraNotes: 0,
      scoreCoverage: 1,
      performanceCoverage: 1,
    });
    expect(alignment.mappings[0]).toMatchObject({
      status: "ornament-realized",
      midiNotes: [
        { id: "upper-neighbor" },
        { id: "main" },
        { id: "repeat" },
      ],
    });
    expect(alignment.timeMap[0]?.timeUs).toBe(180_000);
  });

  it("reclaims a long notated trill across many MIDI onset clusters", () => {
    const trillNote = {
      ...c4,
      durationTicks: 1440,
      ornament: { kind: "trill" as const, hasWavyLine: true, expectedPitches: [60, 62] },
      playbackEvents: Array.from({ length: 12 }, (_, index) => ({
        midis: [index % 2 === 0 ? 60 : 62],
        offsetTicks: index * 120,
        durationTicks: 120,
      })),
    };
    const trillScore: ScoreData = {
      ...score,
      noteGroups: [{
        id: "g1",
        hand: "right",
        measureIndex: 0,
        startTick: 0,
        absoluteTick: 0,
        durationTicks: 1440,
        notes: [trillNote],
        playbackEvents: trillNote.playbackEvents,
      }],
      measureDurations: [1440],
      totalTicks: 1440,
    };
    const performed = Array.from({ length: 12 }, (_, index) =>
      midiNote(`trill-${index}`, index % 2 === 0 ? 60 : 62, 100_000 + index * 90_000));
    const alignment = alignMidiToScore(trillScore, {
      start: range.start,
      end: { measureIndex: 1, offsetQuarter: { numerator: 0, denominator: 1 } },
    }, ["right"], performed);

    const realized = alignment.mappings.find((mapping) => mapping.scoreNote?.id === trillNote.id);
    expect(realized?.status).toBe("ornament-realized");
    expect(realized?.midiNotes).toHaveLength(12);
    expect(alignment.extraNotes).toBe(0);
  });

  it("does not hide an unnotated neighboring wrong note as an ornament", () => {
    const alignment = alignMidiToScore(score, {
      start: range.start,
      end: { measureIndex: 1, offsetQuarter: { numerator: 0, denominator: 1 } },
    }, ["right"], [
      midiNote("wrong-neighbor", 62, 100_000),
      midiNote("main", 60, 180_000),
    ]);

    expect(alignment.matchedNotes).toBe(1);
    expect(alignment.ornamentNotes).toBe(0);
    expect(alignment.extraNotes).toBe(1);
  });

  it("keeps matched, substituted, omitted and extra evidence distinct", () => {
    const alignment = alignMidiToScore(score, range, ["left", "right"], [
      midiNote("c3", 48, 100_000),
      midiNote("c4", 60, 130_000),
      midiNote("ds4", 63, 600_000),
      midiNote("extra", 90, 1_100_000),
    ]);
    expect(alignment.matchedNotes).toBe(2);
    expect(alignment.substitutedNotes).toBe(1);
    expect(alignment.omittedNotes).toBe(1);
    expect(alignment.extraNotes).toBe(1);
    expect(alignment.timeMap.map((anchor) => anchor.timeUs)).toEqual([115_000, 600_000]);
    expect(alignment.confidence).toBeLessThan(0.8);
  });

  it("keeps distant pitch candidates uncertain and out of the reliable time map", () => {
    const alignment = alignMidiToScore(score, {
      start: { measureIndex: 1, offsetQuarter: { numerator: 0, denominator: 1 } },
      end: { measureIndex: 2, offsetQuarter: { numerator: 0, denominator: 1 } },
    }, ["right"], [midiNote("uncertain", 67, 500_000)]);
    expect(alignment.uncertainNotes).toBe(1);
    expect(alignment.mappings[0]).toMatchObject({ status: "uncertain", confidence: 4 / 9 });
    expect(alignment.timeMap).toEqual([]);
    expect(alignment.confidence).toBe(0);
  });

  it("reports a long omitted run between observed anchors as a skipped score range", () => {
    const sequentialNotes = Array.from({ length: 8 }, (_, index) =>
      scoreNote(`n${index}`, 60 + index, index * 480, index, "right"));
    const sequentialScore: ScoreData = {
      ...score,
      noteGroups: sequentialNotes.map((note, index) => ({
        id: `g${index}`,
        hand: "right",
        measureIndex: index,
        startTick: 0,
        absoluteTick: index * 480,
        durationTicks: 480,
        notes: [note],
        playbackEvents: [],
      })),
      measureStarts: Array.from({ length: 8 }, (_, index) => index * 480),
      measureDurations: Array.from({ length: 8 }, () => 480),
      measureTimeSignatures: Array.from({ length: 8 }, () => ({ beats: 4, beatType: 4 })),
      totalTicks: 8 * 480,
      hasLeftHand: false,
    };
    const alignment = alignMidiToScore(sequentialScore, {
      start: { measureIndex: 0, offsetQuarter: { numerator: 0, denominator: 1 } },
      end: { measureIndex: 8, offsetQuarter: { numerator: 0, denominator: 1 } },
    }, ["right"], [
      midiNote("first", 60, 100_000),
      midiNote("last", 67, 3_500_000),
    ]);
    expect(alignment.skippedRanges).toEqual([{
      start: { measureIndex: 1, offsetQuarter: { numerator: 0, denominator: 1 } },
      end: { measureIndex: 7, offsetQuarter: { numerator: 0, denominator: 1 } },
    }]);
  });

  it("chooses the legal repeated or non-repeated score path from MIDI evidence", () => {
    const repeatNotes = [
      scoreNote("r0", 60, 0, 0, "right"),
      scoreNote("r1", 62, 480, 1, "right"),
      scoreNote("r2", 64, 960, 2, "right"),
      scoreNote("r3", 65, 1440, 3, "right"),
    ];
    const repeatScore: ScoreData = {
      ...score,
      noteGroups: repeatNotes.map((note, index) => ({
        id: `repeat-${index}`,
        hand: "right",
        measureIndex: index,
        startTick: 0,
        absoluteTick: index * 480,
        durationTicks: 480,
        notes: [note],
        playbackEvents: [],
      })),
      measureStarts: [0, 480, 960, 1440],
      measureDurations: [480, 480, 480, 480],
      measureTimeSignatures: Array.from({ length: 4 }, () => ({ beats: 4, beatType: 4 })),
      totalTicks: 1920,
      timelineTotalTicks: 2880,
      measurePlaybackOrder: [
        { measureIndex: 0, playbackOccurrence: 0, timelineStartTick: 0, durationTicks: 480 },
        { measureIndex: 1, playbackOccurrence: 0, timelineStartTick: 480, durationTicks: 480 },
        { measureIndex: 2, playbackOccurrence: 0, timelineStartTick: 960, durationTicks: 480 },
        { measureIndex: 1, playbackOccurrence: 1, timelineStartTick: 1440, durationTicks: 480 },
        { measureIndex: 2, playbackOccurrence: 1, timelineStartTick: 1920, durationTicks: 480 },
        { measureIndex: 3, playbackOccurrence: 0, timelineStartTick: 2400, durationTicks: 480 },
      ],
      hasLeftHand: false,
    };
    const repeatRange = {
      start: { measureIndex: 0, offsetQuarter: { numerator: 0, denominator: 1 } },
      end: { measureIndex: 4, offsetQuarter: { numerator: 0, denominator: 1 } },
    };
    const repeated = alignMidiToScore(repeatScore, repeatRange, ["right"], [60, 62, 64, 62, 64, 65].map(
      (pitch, index) => midiNote(`repeat-midi-${index}`, pitch, 100_000 + index * 500_000),
    ));
    expect(repeated.matchedNotes).toBe(6);
    expect(repeated.omittedNotes + repeated.extraNotes).toBe(0);
    expect(repeated.mappings.flatMap((mapping) => mapping.scoreNote?.scoreRef.playbackOccurrence ?? [])).toEqual([0, 0, 0, 1, 1, 0]);

    const withoutRepeat = alignMidiToScore(repeatScore, repeatRange, ["right"], [60, 62, 64, 65].map(
      (pitch, index) => midiNote(`written-midi-${index}`, pitch, 100_000 + index * 500_000),
    ));
    expect(withoutRepeat.matchedNotes).toBe(4);
    expect(withoutRepeat.omittedNotes + withoutRepeat.extraNotes).toBe(0);
    expect(withoutRepeat.mappings.every((mapping) => mapping.scoreNote?.scoreRef.playbackOccurrence == null)).toBe(true);
  });
});
