import { describe, expect, it } from "vitest";
import {
  buildAnalysisScoreChunks,
  musicXmlSystemStartMeasureIndexes,
  scoreChunkIndexesForRange,
} from "./scoreChunks";

function range(startMeasureIndex: number, endMeasureIndex: number, endNumerator = 0) {
  return {
    start: { measureIndex: startMeasureIndex, offsetQuarter: { numerator: 0, denominator: 1 } },
    end: { measureIndex: endMeasureIndex, offsetQuarter: { numerator: endNumerator, denominator: 1 } },
  };
}

describe("analysis score chunks", () => {
  it("covers the complete written score without gaps", () => {
    expect(buildAnalysisScoreChunks(26, 12)).toEqual([
      { index: 0, startMeasureIndex: 0, endMeasureIndex: 11 },
      { index: 1, startMeasureIndex: 12, endMeasureIndex: 23 },
      { index: 2, startMeasureIndex: 24, endMeasureIndex: 25 },
    ]);
  });

  it("maps an exclusive next-measure ending to only the intersecting chunks", () => {
    const chunks = buildAnalysisScoreChunks(36, 12);
    expect(scoreChunkIndexesForRange(chunks, range(10, 24))).toEqual([0, 1]);
  });

  it("includes a partially used ending measure", () => {
    const chunks = buildAnalysisScoreChunks(36, 12);
    expect(scoreChunkIndexesForRange(chunks, range(10, 24, 1))).toEqual([0, 1, 2]);
  });

  it("uses source system starts so a chunk never splits an engraved system", () => {
    expect(buildAnalysisScoreChunks(36, 12, [4, 10, 15, 20, 25, 30])).toEqual([
      { index: 0, startMeasureIndex: 0, endMeasureIndex: 9 },
      { index: 1, startMeasureIndex: 10, endMeasureIndex: 19 },
      { index: 2, startMeasureIndex: 20, endMeasureIndex: 29 },
      { index: 3, startMeasureIndex: 30, endMeasureIndex: 35 },
    ]);
  });

  it("reads new-system and new-page boundaries from the first MusicXML part", () => {
    const xml = `
      <score-partwise>
        <part id="P1">
          <measure number="1"/>
          <measure number="2"><print new-system="yes"/></measure>
          <measure number="3"><print new-page="yes"/></measure>
        </part>
        <part id="P2">
          <measure number="1"/>
          <measure number="2"/>
          <measure number="3"/>
        </part>
      </score-partwise>
    `;
    expect(musicXmlSystemStartMeasureIndexes(xml)).toEqual([1, 2]);
  });
});
