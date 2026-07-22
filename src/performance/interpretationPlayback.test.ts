import { describe, expect, it } from "vitest";
import type { ScoreRange } from "../analysis/types";
import type { ParsedNote, ScoreData, ScoreNoteRef } from "../types";
import { buildInterpretationPlaybackNotes } from "./interpretationPlayback";
import type { ScoreInterpretation } from "./types";

const firstRef: ScoreNoteRef = {
  partId: "P1",
  measureIndex: 0,
  offsetQuarter: { numerator: 0, denominator: 1 },
  staff: 1,
  voice: "1",
  writtenPitch: "C4",
  ordinalAtPosition: 0,
};

const secondRef: ScoreNoteRef = {
  ...firstRef,
  offsetQuarter: { numerator: 1, denominator: 1 },
  writtenPitch: "D4",
};

function note(id: string, scoreRef: ScoreNoteRef, midi: number, absoluteTick: number): ParsedNote {
  return {
    id,
    scoreRef,
    midi,
    name: scoreRef.writtenPitch,
    hand: "right",
    staff: 1,
    measureIndex: 0,
    startTick: absoluteTick,
    absoluteTick,
    durationTicks: 480,
    playbackEvents: [],
  };
}

const firstNote = note("first", firstRef, 60, 0);
const secondNote = note("second", secondRef, 62, 480);

const score: ScoreData = {
  title: "fixture",
  xml: "",
  noteGroups: [
    { id: "g1", hand: "right", measureIndex: 0, startTick: 0, absoluteTick: 0, durationTicks: 480, notes: [firstNote], playbackEvents: [] },
    { id: "g2", hand: "right", measureIndex: 0, startTick: 480, absoluteTick: 480, durationTicks: 480, notes: [secondNote], playbackEvents: [] },
  ],
  measureStarts: [0],
  measureDurations: [960],
  measureTimeSignatures: [{ beats: 2, beatType: 4 }],
  totalTicks: 960,
  canSeparateHands: true,
  hasLeftHand: false,
  hasRightHand: true,
};

const range: ScoreRange = {
  start: { measureIndex: 0, offsetQuarter: { numerator: 0, denominator: 1 } },
  end: { measureIndex: 1, offsetQuarter: { numerator: 0, denominator: 1 } },
};

function interpretation(noteExpressions: ScoreInterpretation["noteExpressions"]): ScoreInterpretation {
  return {
    schemaVersion: "2.1.0",
    interpretationId: "fixture-interpretation",
    score: {
      scoreId: "fixture",
      sourceHash: `sha256:${"A".repeat(64)}`,
      identitySource: "library-source",
    },
    timeMap: [
      { scorePosition: range.start, timeUs: 0, confidence: 1 },
      { scorePosition: range.end, timeUs: 2_000_000, confidence: 1 },
    ],
    noteExpressions,
    pedals: { sustain: [
      { timeUs: 400_000, value: 1 },
      { timeUs: 700_000, value: 0 },
    ] },
    generation: {
      status: "automatically-validated",
      algorithmVersion: "test",
      validationPolicyVersion: "test",
      models: ["test"],
      evaluationId: "fixture-interpretation",
      evaluationSha256: `sha256:${"A".repeat(64)}`,
      dimensions: {
        pitch: 1,
        "note-onset": 1,
        "note-offset": 1,
        pedal: 1,
        ornament: 1,
        dynamics: 1,
      },
      coverage: {
        scoreNotes: 2,
        matchedNotes: noteExpressions.filter((expression) => expression.kind === "performed").length,
        ornamentGestures: noteExpressions.filter((expression) => expression.kind === "ornament").length,
        uncertainNotes: 0,
        extraEvents: 0,
        scoreCoverage: 1,
        performanceCoverage: 1,
      },
    },
  };
}

describe("buildInterpretationPlaybackNotes", () => {
  it("plays score pitches while preserving expressive timing, dynamics, and pedal", () => {
    const notes = buildInterpretationPlaybackNotes(score, range, interpretation([
      {
        scoreNoteRef: firstRef,
        kind: "performed",
        intensity: 0.5,
        onsetUs: 100_000,
        releaseUs: 500_000,
        confidence: 0.9,
      },
    ]));

    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({
      pitch: 60,
      scoreTick: 0,
      scoreGroupId: "g1",
      onsetUs: 100_000,
      offsetUs: 700_000,
      synthesized: false,
    });
    expect(notes[0].velocity).toBeCloseTo(0.55);
    expect(notes[1]).toMatchObject({
      pitch: 62,
      scoreTick: 480,
      scoreGroupId: "g2",
      onsetUs: 1_000_000,
      offsetUs: 2_000_000,
      synthesized: true,
    });
  });

  it("can render an aggregate interpretation from the score and time map alone", () => {
    const notes = buildInterpretationPlaybackNotes(score, range, interpretation([]));

    expect(notes.map((item) => [item.pitch, item.onsetUs, item.offsetUs])).toEqual([
      [60, 0, 1_000_000],
      [62, 1_000_000, 2_000_000],
    ]);
    expect(notes.every((item) => item.synthesized)).toBe(true);
  });

  it("keeps a score-aligned ornament as multiple realized notes", () => {
    const notes = buildInterpretationPlaybackNotes(score, range, interpretation([{
      scoreNoteRef: firstRef,
      kind: "ornament",
      realizationKind: "trill",
      realizations: [
        {
          pitch: 62,
          onsetUs: 100_000,
          releaseUs: 170_000,
          intensity: 0.5,
        },
        {
          pitch: 60,
          onsetUs: 185_000,
          releaseUs: 320_000,
          intensity: 0.6,
        },
      ],
      confidence: 0.9,
    }]));

    expect(notes.map((item) => [item.pitch, item.onsetUs, item.offsetUs])).toEqual([
      [62, 100_000, 170_000],
      [60, 185_000, 320_000],
      [62, 1_000_000, 2_000_000],
    ]);
    expect(notes.slice(0, 2).every((item) => !item.synthesized)).toBe(true);
    expect(notes.slice(0, 2).every((item) => item.scoreTick === 0 && item.scoreGroupId === "g1")).toBe(true);
  });

  it("keeps ordinary score ticks monotonic when an earlier ornament shares the previous tick", () => {
    const ornamentRef = { ...firstRef, writtenPitch: "B4" };
    const ordinaryAtZeroRef = { ...firstRef, writtenPitch: "C4", ordinalAtPosition: 1 };
    const ordinaryAtNextTickRef = {
      ...firstRef,
      offsetQuarter: { numerator: 1, denominator: 3 },
      writtenPitch: "D4",
    };
    const ornamentNote = {
      ...note("ornament", ornamentRef, 71, 0),
      ornament: { kind: "trill" as const, hasWavyLine: false, expectedPitches: [71, 72] },
    };
    const ordinaryAtZero = note("ordinary-zero", ordinaryAtZeroRef, 60, 0);
    const ordinaryAtNextTick = note("ordinary-next", ordinaryAtNextTickRef, 62, 160);
    const mixedScore: ScoreData = {
      ...score,
      noteGroups: [
        { id: "ornament-group", hand: "right", measureIndex: 0, startTick: 0, absoluteTick: 0, durationTicks: 480, notes: [ornamentNote], playbackEvents: [] },
        { id: "ordinary-zero-group", hand: "right", measureIndex: 0, startTick: 0, absoluteTick: 0, durationTicks: 480, notes: [ordinaryAtZero], playbackEvents: [] },
        { id: "ordinary-next-group", hand: "right", measureIndex: 0, startTick: 160, absoluteTick: 160, durationTicks: 480, notes: [ordinaryAtNextTick], playbackEvents: [] },
      ],
    };
    const notes = buildInterpretationPlaybackNotes(mixedScore, range, interpretation([
      {
        scoreNoteRef: ornamentRef,
        kind: "ornament",
        realizationKind: "trill",
        realizations: [
          { pitch: 71, onsetUs: 100_000, releaseUs: 140_000, intensity: 0.5 },
          { pitch: 72, onsetUs: 150_000, releaseUs: 190_000, intensity: 0.5 },
        ],
        confidence: 0.9,
      },
      {
        scoreNoteRef: ordinaryAtZeroRef,
        kind: "performed",
        onsetUs: 300_000,
        releaseUs: 500_000,
        intensity: 0.5,
        confidence: 0.9,
      },
      {
        scoreNoteRef: ordinaryAtNextTickRef,
        kind: "performed",
        onsetUs: 200_000,
        releaseUs: 600_000,
        intensity: 0.5,
        confidence: 0.9,
      },
    ]));

    expect(notes.filter((item) => item.scoreGroupId === "ornament-group").map((item) => item.onsetUs)).toEqual([
      100_000,
      150_000,
    ]);
    expect(notes.find((item) => item.scoreGroupId === "ordinary-zero-group")?.onsetUs).toBe(300_000);
    expect(notes.find((item) => item.scoreGroupId === "ordinary-next-group")?.onsetUs).toBe(300_000);
  });

  it("does not apply unvalidated note timing, dynamics, pedal, or realization data", () => {
    const chordRef = { ...secondRef, offsetQuarter: firstRef.offsetQuarter, writtenPitch: "E4" };
    const chordNote = note("chord", chordRef, 64, 0);
    const candidateScore: ScoreData = {
      ...score,
      noteGroups: [{
        id: "g1",
        hand: "right",
        measureIndex: 0,
        startTick: 0,
        absoluteTick: 0,
        durationTicks: 480,
        notes: [firstNote, chordNote],
        playbackEvents: [],
      }],
    };
    const candidate = {
      ...interpretation([
        {
          scoreNoteRef: firstRef,
          kind: "performed" as const,
          onsetUs: 150_000,
          releaseUs: 300_000,
          intensity: 0.9,
          confidence: 0.9,
        },
        {
          scoreNoteRef: chordRef,
          kind: "performed" as const,
          onsetUs: 850_000,
          releaseUs: 950_000,
          intensity: 0.1,
          confidence: 0.9,
        },
      ]),
      generation: { ...interpretation([]).generation, status: "automated-candidate" as const, dimensions: {} },
    };

    const notes = buildInterpretationPlaybackNotes(candidateScore, range, candidate);
    expect(notes.map((item) => [item.pitch, item.onsetUs, item.offsetUs, item.velocity])).toEqual([
      [60, 0, 1_000_000, 0.58],
      [64, 0, 1_000_000, 0.58],
    ]);
    expect(notes.every((item) => item.synthesized && item.onsetSource === "time-map")).toBe(true);
  });

  it("uses the notated ornament fallback until performed realizations are validated", () => {
    const ornamentNote = {
      ...firstNote,
      playbackEvents: [
        { midis: [62], offsetTicks: 0, durationTicks: 240 },
        { midis: [60], offsetTicks: 240, durationTicks: 240 },
      ],
      ornament: { kind: "trill" as const, hasWavyLine: false, expectedPitches: [60, 62] },
    };
    const candidateScore: ScoreData = {
      ...score,
      noteGroups: [{ ...score.noteGroups[0], notes: [ornamentNote], playbackEvents: ornamentNote.playbackEvents }],
    };
    const candidate = {
      ...interpretation([{
        scoreNoteRef: firstRef,
        kind: "ornament" as const,
        realizationKind: "trill" as const,
        realizations: [
          { pitch: 65, onsetUs: 300_000, releaseUs: 400_000, intensity: 0.8 },
          { pitch: 60, onsetUs: 410_000, releaseUs: 500_000, intensity: 0.7 },
        ],
        confidence: 0.9,
      }]),
      generation: { ...interpretation([]).generation, status: "automated-candidate" as const, dimensions: {} },
    };

    const notes = buildInterpretationPlaybackNotes(candidateScore, range, candidate);
    expect(notes.map((item) => [item.pitch, item.onsetUs, item.offsetUs])).toEqual([
      [62, 0, 500_000],
      [60, 500_000, 1_000_000],
    ]);
    expect(notes.every((item) => item.synthesized)).toBe(true);
  });
});
