import type { ScoreRange } from "../../analysis/types";

export const ANALYSIS_SCORE_CHUNK_MEASURES = 12;

export interface AnalysisScoreChunk {
  index: number;
  startMeasureIndex: number;
  endMeasureIndex: number;
}

export function musicXmlSystemStartMeasureIndexes(xml: string): number[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagNameNS("*", "parsererror").length > 0) {
    return [];
  }

  const firstPart = Array.from(doc.documentElement.children).find((child) => child.localName === "part");
  if (!firstPart) {
    return [];
  }

  return Array.from(firstPart.children)
    .filter((child) => child.localName === "measure")
    .flatMap((measure, measureIndex) => {
      if (measureIndex === 0) return [];
      const startsSystem = Array.from(measure.children).some((child) => (
        child.localName === "print"
        && (child.getAttribute("new-system") === "yes" || child.getAttribute("new-page") === "yes")
      ));
      return startsSystem ? [measureIndex] : [];
    });
}

export function buildAnalysisScoreChunks(
  measureCount: number,
  chunkMeasures = ANALYSIS_SCORE_CHUNK_MEASURES,
  systemStartMeasureIndexes: number[] = [],
): AnalysisScoreChunk[] {
  const preferredStarts = [...new Set(systemStartMeasureIndexes)]
    .filter((measureIndex) => measureIndex > 0 && measureIndex < measureCount)
    .sort((left, right) => left - right);
  const chunks: AnalysisScoreChunk[] = [];
  for (let startMeasureIndex = 0; startMeasureIndex < measureCount;) {
    const idealEnd = startMeasureIndex + chunkMeasures;
    const preferredBeforeIdeal = preferredStarts.filter(
      (measureIndex) => measureIndex > startMeasureIndex && measureIndex <= idealEnd,
    );
    const preferredAfterIdeal = preferredStarts.find(
      (measureIndex) => measureIndex > idealEnd && measureIndex <= startMeasureIndex + Math.ceil(chunkMeasures * 1.5),
    );
    const nextStartMeasureIndex = preferredBeforeIdeal.at(-1)
      ?? preferredAfterIdeal
      ?? Math.min(measureCount, idealEnd);
    chunks.push({
      index: chunks.length,
      startMeasureIndex,
      endMeasureIndex: nextStartMeasureIndex - 1,
    });
    startMeasureIndex = nextStartMeasureIndex;
  }
  return chunks;
}

export function lastMeasureIndexInRange(range: ScoreRange): number {
  return range.end.offsetQuarter.numerator === 0 && range.end.measureIndex > range.start.measureIndex
    ? range.end.measureIndex - 1
    : range.end.measureIndex;
}

export function scoreChunkIndexesForRange(
  chunks: AnalysisScoreChunk[],
  range: ScoreRange,
): number[] {
  const lastMeasureIndex = lastMeasureIndexInRange(range);
  return chunks
    .filter((chunk) => (
      chunk.endMeasureIndex >= range.start.measureIndex
      && chunk.startMeasureIndex <= lastMeasureIndex
    ))
    .map((chunk) => chunk.index);
}
