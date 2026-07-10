import type { AnalysisTab, AnalysisViewItem, ScoreAnalysis } from "./types";

export function buildAnalysisItems(analysis: ScoreAnalysis, tab: AnalysisTab): AnalysisViewItem[] {
  if (tab === "structure") {
    return analysis.sections.map((entity) => ({
      kind: "section",
      id: entity.id,
      label: entity.label,
      summary: entity.summary,
      ranges: [entity.range],
      entity,
    }));
  }

  if (tab === "motif") {
    return analysis.motifFamilies.map((entity) => ({
      kind: "motif",
      id: entity.id,
      label: entity.label,
      summary: entity.summary,
      ranges: entity.occurrences.map((occurrence) => occurrence.range),
      entity,
    }));
  }

  if (tab === "left-hand") {
    if (analysis.leftHandAnalysisMode === "polyphonic-texture") {
      return analysis.leftHandTextureFamilies.map((entity) => ({
        kind: "texture",
        id: entity.id,
        label: entity.label,
        summary: entity.summary,
        ranges: entity.occurrences.map((occurrence) => occurrence.range),
        entity,
      }));
    }
    return analysis.leftHandChordFamilies.map((entity) => ({
      kind: "chord",
      id: entity.id,
      label: entity.label,
      summary: entity.summary,
      ranges: entity.occurrences.map((occurrence) => occurrence.range),
      entity,
    }));
  }

  return [];
}
