import { describe, expect, it } from "vitest";
import type { ScoreAnalysis } from "./types";
import { buildAnalysisItems } from "./viewModel";

const range = {
  start: { measureIndex: 0, offsetQuarter: { numerator: 0, denominator: 1 } },
  end: { measureIndex: 1, offsetQuarter: { numerator: 0, denominator: 1 } },
};

const analysis = {
  leftHandAnalysisMode: "chord-groups",
  leftHandChordFamilies: [{
    id: "chord-one",
    label: "C",
    summary: "summary",
    pitchClasses: ["C", "E", "G"],
    occurrenceCount: 1,
    voicingVariantCount: 1,
    bassVariants: [{ bass: "C", count: 1 }],
    occurrences: [{
      id: "left-chord-one",
      range,
      measureIndex: 0,
      beatIndex: 0,
      absoluteStartTick: 0,
      absoluteEndTick: 480,
      symbol: "C",
      name: "C major",
      alternatives: [],
      noteNames: ["C3", "E3", "G3"],
      pitchClasses: ["C", "E", "G"],
      bass: "C",
      pitchClassSignature: "0-4-7",
      voicingSignature: "48-52-55",
      relation: "representative",
    }],
  }],
  leftHandTextureFamilies: [],
} as unknown as ScoreAnalysis;

describe("analysis view model", () => {
  it("shows chord families for chord-group scores", () => {
    expect(buildAnalysisItems(analysis, "left-hand").map((item) => item.kind)).toEqual(["chord"]);
  });

  it("shows texture families for polyphonic scores", () => {
    const polyphonic = {
      ...analysis,
      leftHandAnalysisMode: "polyphonic-texture",
      leftHandChordGrouping: null,
      leftHandChordFamilies: [],
      leftHandTextureFamilies: [{
        id: "texture-one",
        label: "延留音程",
        summary: "summary",
        role: "sustained-interval",
        recognitionBasis: ["held voices"],
        understanding: "understanding",
        occurrences: [{
          id: "texture-occurrence-one",
          label: "first",
          range,
          summary: "summary",
          noteNames: ["C3", "A3"],
          relation: "representative",
          differences: [],
        }],
      }],
    } as ScoreAnalysis;
    expect(buildAnalysisItems(polyphonic, "left-hand").map((item) => item.kind)).toEqual(["texture"]);
  });
});
