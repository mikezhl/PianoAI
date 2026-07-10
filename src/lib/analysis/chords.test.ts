import { describe, expect, it } from "vitest";
import type { ScoreAnalysis } from "../../analysis/types";
import type { NoteGroup, ScoreData } from "../../types";
import { buildLeftHandChordAnalysis } from "./chords";

function group(id: string, tick: number, midis: number[]): NoteGroup {
  return {
    id,
    hand: "left",
    measureIndex: 0,
    startTick: tick,
    absoluteTick: tick,
    durationTicks: 240,
    notes: midis.map((midi, index) => ({
      id: `${id}-${index}`,
      midi,
      name: String(midi),
      hand: "left",
      staff: 2,
      measureIndex: 0,
      startTick: tick,
      absoluteTick: tick,
      durationTicks: 240,
      playbackEvents: [],
    })),
    playbackEvents: [],
  };
}

function sustainedGroup(
  id: string,
  tick: number,
  durationTicks: number,
  midis: number[],
  measureIndex = 0,
  measureStart = 0,
): NoteGroup {
  const result = group(id, tick, midis);
  result.measureIndex = measureIndex;
  result.startTick = tick - measureStart;
  result.durationTicks = durationTicks;
  result.notes.forEach((note) => {
    note.measureIndex = measureIndex;
    note.startTick = tick - measureStart;
    note.durationTicks = durationTicks;
  });
  return result;
}

function writtenGroup(id: string, tick: number, notes: Array<{ midi: number; writtenName: string }>): NoteGroup {
  const result = group(id, tick, notes.map((note) => note.midi));
  result.notes.forEach((note, index) => {
    note.writtenName = notes[index].writtenName;
  });
  return result;
}

const score: ScoreData = {
  title: "fixture",
  xml: "",
  noteGroups: [
    group("bass-1", 0, [48]),
    group("chord-1", 240, [55, 60, 64]),
    group("bass-2", 720, [52]),
    group("chord-2", 960, [55, 60]),
    group("bass-3", 1440, [36]),
    group("chord-3", 1680, [55, 60, 64]),
  ],
  measureStarts: [0],
  measureDurations: [2880],
  measureTimeSignatures: [{ beats: 12, beatType: 8 }],
  totalTicks: 2880,
  canSeparateHands: true,
  hasLeftHand: true,
  hasRightHand: false,
};

const analysis = {
  schemaVersion: "2.1.0",
  analysisVersion: "test",
  score: {
    id: "fixture",
    sourceFile: "fixture.mxl",
    sourceHash: `sha256:${"0".repeat(64)}`,
    title: "fixture",
    composer: "fixture",
    key: "C major",
    meter: "12/8",
    measureCount: 1,
    internalMeasureCount: 1,
    pickupMeasureIndex: 0,
    measureNumberByIndex: ["1"],
  },
  form: {
    label: "A",
    summary: "fixture",
  },
  sources: [],
  crossValidation: [],
  sections: [],
  motifFamilies: [],
  leftHandAnalysisMode: "chord-groups",
  leftHandChordGrouping: {
    defaultMode: "meter-beat",
    overrides: [],
  },
  leftHandChordFamilies: [],
  leftHandTextureFamilies: [],
} satisfies ScoreAnalysis;

describe("left-hand chord analysis", () => {
  it("combines bass and upper notes within each compound beat", () => {
    const result = buildLeftHandChordAnalysis(score, analysis);
    expect(result.occurrences).toHaveLength(3);
    expect(result.occurrences[0]).toMatchObject({ symbol: "C", bass: "C", beatIndex: 0 });
    expect(result.occurrences[1]).toMatchObject({ symbol: "C/E", bass: "E", beatIndex: 1 });
  });

  it("groups inversions and octave variants into one pitch-class family", () => {
    const result = buildLeftHandChordAnalysis(score, analysis);
    const cMajor = result.families.find((family) => family.pitchClasses.join("-") === "C-E-G");
    expect(cMajor).toMatchObject({ occurrenceCount: 3, voicingVariantCount: 3 });
    expect(cMajor?.bassVariants).toEqual([
      { bass: "C", count: 2 },
      { bass: "E", count: 1 },
    ]);
    expect(cMajor?.occurrences.some((occurrence) => occurrence.relation === "inversion")).toBe(true);
  });

  it("keeps enharmonically different spellings in separate families", () => {
    const enharmonicScore: ScoreData = {
      ...score,
      noteGroups: [
        writtenGroup("sharp", 0, [
          { midi: 49, writtenName: "C#3" },
          { midi: 53, writtenName: "F3" },
          { midi: 56, writtenName: "G#3" },
        ]),
        writtenGroup("flat", 720, [
          { midi: 49, writtenName: "Db3" },
          { midi: 53, writtenName: "F3" },
          { midi: 56, writtenName: "Ab3" },
        ]),
      ],
    };

    const result = buildLeftHandChordAnalysis(enharmonicScore, analysis);
    expect(result.families).toHaveLength(2);
    expect(result.families.map((family) => family.pitchClasses)).toEqual([
      ["C♯", "F", "G♯"],
      ["D♭", "F", "A♭"],
    ]);
  });

  it("includes notes that continue sounding from an earlier beat", () => {
    const sustainedScore: ScoreData = {
      ...score,
      noteGroups: [
        sustainedGroup("bass", 0, 1440, [48]),
        group("upper-1", 240, [55, 64]),
        group("upper-2", 720, [55, 64]),
      ],
    };

    const result = buildLeftHandChordAnalysis(sustainedScore, analysis);
    expect(result.occurrences[1]).toMatchObject({
      beatIndex: 1,
      bass: "C",
      pitchClasses: ["C", "E", "G"],
      symbol: "C",
    });
  });

  it("uses the actual beat unit after a meter change", () => {
    const meterChangeScore: ScoreData = {
      ...score,
      noteGroups: [
        sustainedGroup("three-four", 0, 1440, [48]),
        sustainedGroup("six-eight", 1440, 1440, [50], 1, 1440),
      ],
      measureStarts: [0, 1440],
      measureDurations: [1440, 1440],
      measureTimeSignatures: [
        { beats: 3, beatType: 4 },
        { beats: 6, beatType: 8 },
      ],
      totalTicks: 2880,
    };

    const result = buildLeftHandChordAnalysis(meterChangeScore, analysis);
    expect(result.occurrences.map(({ measureIndex, beatIndex }) => ({ measureIndex, beatIndex }))).toEqual([
      { measureIndex: 0, beatIndex: 0 },
      { measureIndex: 0, beatIndex: 1 },
      { measureIndex: 0, beatIndex: 2 },
      { measureIndex: 1, beatIndex: 0 },
      { measureIndex: 1, beatIndex: 1 },
    ]);
  });

  it("aggregates a 6/4 arpeggio into two compound-beat chords", () => {
    const sixFourScore: ScoreData = {
      ...score,
      noteGroups: [
        writtenGroup("tonic-bass", 0, [{ midi: 46, writtenName: "Bb2" }]),
        writtenGroup("tonic-fifth", 480, [{ midi: 53, writtenName: "F3" }]),
        writtenGroup("tonic-third", 960, [{ midi: 49, writtenName: "Db3" }]),
        writtenGroup("dominant-bass", 1440, [{ midi: 41, writtenName: "F2" }]),
        writtenGroup("dominant-fifth", 1920, [{ midi: 48, writtenName: "C3" }]),
        writtenGroup("dominant-third", 2400, [{ midi: 45, writtenName: "A2" }]),
      ],
      measureStarts: [0],
      measureDurations: [2880],
      measureTimeSignatures: [{ beats: 6, beatType: 4 }],
      totalTicks: 2880,
    };

    const result = buildLeftHandChordAnalysis(sixFourScore, analysis);
    expect(result.occurrences).toHaveLength(2);
    expect(result.occurrences.map((occurrence) => occurrence.pitchClasses)).toEqual([
      ["D♭", "F", "B♭"],
      ["C", "F", "A"],
    ]);
  });

  it("keeps unsupported complex candidates as literal pitch collections", () => {
    const complexScore: ScoreData = {
      ...score,
      noteGroups: [
        writtenGroup("complex", 0, [
          { midi: 46, writtenName: "Bb2" },
          { midi: 53, writtenName: "F3" },
          { midi: 57, writtenName: "A3" },
          { midi: 63, writtenName: "Eb4" },
        ]),
      ],
      measureStarts: [0],
      measureDurations: [720],
      measureTimeSignatures: [{ beats: 12, beatType: 8 }],
      totalTicks: 720,
    };

    const result = buildLeftHandChordAnalysis(complexScore, analysis);
    expect(result.occurrences[0]).toMatchObject({
      symbol: "E♭–F–A–B♭",
      name: "E♭–F–A–B♭ 音高集合",
    });
  });

  it("combines a waltz bass and upper attacks with measure grouping", () => {
    const waltzScore: ScoreData = {
      ...score,
      noteGroups: [
        writtenGroup("bass", 0, [{ midi: 45, writtenName: "A2" }]),
        writtenGroup("upper-1", 480, [
          { midi: 57, writtenName: "A3" },
          { midi: 60, writtenName: "C4" },
          { midi: 64, writtenName: "E4" },
        ]),
        writtenGroup("upper-2", 960, [
          { midi: 57, writtenName: "A3" },
          { midi: 60, writtenName: "C4" },
          { midi: 64, writtenName: "E4" },
        ]),
      ],
      measureStarts: [0],
      measureDurations: [1440],
      measureTimeSignatures: [{ beats: 3, beatType: 4 }],
      totalTicks: 1440,
    };
    const measureAnalysis: ScoreAnalysis = {
      ...analysis,
      leftHandChordGrouping: { defaultMode: "measure", overrides: [] },
    };

    const result = buildLeftHandChordAnalysis(waltzScore, measureAnalysis);
    expect(result.occurrences).toHaveLength(1);
    expect(result.occurrences[0]).toMatchObject({ symbol: "Am", pitchClasses: ["C", "E", "A"] });
  });

  it("applies ordered measure-range grouping overrides", () => {
    const overrideScore: ScoreData = {
      ...score,
      noteGroups: [
        sustainedGroup("measure-one", 0, 1440, [48]),
        sustainedGroup("measure-two", 1440, 1440, [50], 1, 1440),
      ],
      measureStarts: [0, 1440],
      measureDurations: [1440, 1440],
      measureTimeSignatures: [
        { beats: 3, beatType: 4 },
        { beats: 3, beatType: 4 },
      ],
      totalTicks: 2880,
    };
    const overrideAnalysis: ScoreAnalysis = {
      ...analysis,
      leftHandChordGrouping: {
        defaultMode: "measure",
        overrides: [{ startMeasureIndex: 1, endMeasureIndex: 2, mode: "notated-beat" }],
      },
    };

    const result = buildLeftHandChordAnalysis(overrideScore, overrideAnalysis);
    expect(result.occurrences.map(({ measureIndex, beatIndex }) => ({ measureIndex, beatIndex }))).toEqual([
      { measureIndex: 0, beatIndex: 0 },
      { measureIndex: 1, beatIndex: 0 },
      { measureIndex: 1, beatIndex: 1 },
      { measureIndex: 1, beatIndex: 2 },
    ]);
  });

  it("distinguishes singleton labels from major-chord labels", () => {
    const labelScore: ScoreData = {
      ...score,
      noteGroups: [
        writtenGroup("single", 0, [{ midi: 46, writtenName: "Bb2" }]),
        writtenGroup("major", 480, [
          { midi: 46, writtenName: "Bb2" },
          { midi: 50, writtenName: "D3" },
          { midi: 53, writtenName: "F3" },
        ]),
      ],
      measureStarts: [0],
      measureDurations: [960],
      measureTimeSignatures: [{ beats: 2, beatType: 4 }],
      totalTicks: 960,
    };
    const labelAnalysis: ScoreAnalysis = {
      ...analysis,
      leftHandChordGrouping: { defaultMode: "notated-beat", overrides: [] },
    };

    const result = buildLeftHandChordAnalysis(labelScore, labelAnalysis);
    expect(result.families.map((family) => family.label).sort()).toEqual(["B♭", "B♭ 低音"]);
  });
});
