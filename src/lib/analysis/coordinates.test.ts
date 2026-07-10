import { describe, expect, it } from "vitest";
import type { ScoreAnalysisMetadata } from "../../analysis/types";
import {
  compareScorePositions,
  formatScoreRange,
  getDisplayMeasureLabel,
} from "./coordinates";

const metadata: ScoreAnalysisMetadata = {
  id: "chopin-nocturne-op9-no2",
  sourceFile: "Nocturne Op. 9 No. 2.mxl",
  sourceHash: "sha256:TEST",
  title: "Nocturne Op. 9 No. 2",
  composer: "Frédéric Chopin",
  key: "E-flat major",
  meter: "12/8",
  measureCount: 34,
  internalMeasureCount: 36,
  pickupMeasureIndex: 0,
  measureNumberByIndex: [
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16",
    "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30", "31", "32", "32", "33", "34",
  ],
};

function position(measureIndex: number, numerator = 0, denominator = 1) {
  return { measureIndex, offsetQuarter: { numerator, denominator } };
}

describe("analysis coordinates", () => {
  it("orders positions using exact rational offsets", () => {
    expect(compareScorePositions(position(3, 1, 3), position(3, 1, 2))).toBeLessThan(0);
    expect(compareScorePositions(position(4), position(3, 9, 1))).toBeGreaterThan(0);
  });

  it("disambiguates the two internal parts of displayed measure 32", () => {
    expect(getDisplayMeasureLabel(metadata, 32)).toBe("m32a");
    expect(getDisplayMeasureLabel(metadata, 33)).toBe("m32b");
    expect(formatScoreRange(metadata, { start: position(32), end: position(34) })).toBe("m32a–m32b");
  });
});
