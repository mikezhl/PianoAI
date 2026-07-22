import type { ScoreAnalysisMetadata, ScorePosition, ScoreRange } from "../../analysis/types";

function compareRationals(left: ScorePosition["offsetQuarter"], right: ScorePosition["offsetQuarter"]): number {
  return left.numerator * right.denominator - right.numerator * left.denominator;
}

export function compareScorePositions(left: ScorePosition, right: ScorePosition): number {
  if (left.measureIndex !== right.measureIndex) {
    return left.measureIndex - right.measureIndex;
  }

  return compareRationals(left.offsetQuarter, right.offsetQuarter);
}

export function isZeroOffset(position: ScorePosition): boolean {
  return position.offsetQuarter.numerator === 0;
}

export function getDisplayMeasureLabel(metadata: ScoreAnalysisMetadata, measureIndex: number): string {
  if (measureIndex >= metadata.internalMeasureCount) {
    return "终点";
  }

  const displayNumber = metadata.measureNumberByIndex[measureIndex] ?? String(measureIndex);
  const matchingIndices = metadata.measureNumberByIndex
    .map((value, index) => ({ value, index }))
    .filter((item) => item.value === displayNumber)
    .map((item) => item.index);

  if (matchingIndices.length <= 1) {
    return `m${displayNumber}`;
  }

  const duplicateIndex = matchingIndices.indexOf(measureIndex);
  const suffix = String.fromCharCode("a".charCodeAt(0) + Math.max(0, duplicateIndex));
  return `m${displayNumber}${suffix}`;
}

export function formatScoreRange(metadata: ScoreAnalysisMetadata, range: ScoreRange): string {
  const startIndex = Math.min(range.start.measureIndex, metadata.internalMeasureCount - 1);
  const endIndex = isZeroOffset(range.end)
    ? Math.max(startIndex, range.end.measureIndex - 1)
    : Math.min(range.end.measureIndex, metadata.internalMeasureCount - 1);
  const startLabel = getDisplayMeasureLabel(metadata, startIndex);
  const endLabel = getDisplayMeasureLabel(metadata, endIndex);
  return startLabel === endLabel ? startLabel : `${startLabel}–${endLabel}`;
}
