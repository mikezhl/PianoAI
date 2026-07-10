export type AnalysisConfidence = "high" | "medium" | "low";

export interface RationalNumber {
  numerator: number;
  denominator: number;
}

export interface ScorePosition {
  measureIndex: number;
  offsetQuarter: RationalNumber;
  staff?: number;
  voice?: string;
}

export interface ScoreRange {
  start: ScorePosition;
  end: ScorePosition;
}

export interface AnalysisSourceReference {
  sourceId: string;
  claim: string;
}

export interface AnalysisEntityBase {
  id: string;
  label: string;
  range: ScoreRange;
  summary: string;
  details?: string[];
  confidence: AnalysisConfidence;
  sourceRefs?: AnalysisSourceReference[];
}

export interface ScoreAnalysisMetadata {
  id: string;
  sourceFile: string;
  sourceHash: string;
  title: string;
  composer: string;
  key: string;
  meter: string;
  measureCount: number;
  internalMeasureCount: number;
  pickupMeasureIndex: number | null;
  measureNumberByIndex: string[];
}

export interface AnalysisForm {
  label: string;
  summary: string;
}

export interface AnalysisSource {
  id: string;
  title: string;
  url: string;
  kind: "score" | "academic" | "secondary" | "reference";
  use: string;
  limitations?: string;
}

export interface CrossValidationItem {
  id: string;
  claim: string;
  status: "confirmed" | "qualified" | "rejected";
  evidence: string[];
  sourceIds?: string[];
  conclusion: string;
}

export interface AnalysisSection extends AnalysisEntityBase {
  layer: "structure";
  kind: "pickup" | "theme" | "contrast" | "coda" | "cadenza" | "closure";
  displayNumber: number;
  tonality: string;
  understanding: string;
  relatedMotifFamilyIds?: string[];
}

export type MotifRelation =
  | "representative"
  | "exact"
  | "near-exact"
  | "transposed"
  | "ornamented"
  | "rhythmic-variant"
  | "fragmented"
  | "extended"
  | "intensified"
  | "other";

export interface MotifOccurrence extends AnalysisEntityBase {
  relation: MotifRelation;
  differences: string[];
}

export interface MotifFamily {
  id: string;
  label: string;
  role: "theme" | "motif" | "bass" | "accompaniment" | "cadential" | "coda";
  summary: string;
  recognitionBasis: string[];
  understanding: string;
  occurrences: MotifOccurrence[];
}

export type ChordOccurrenceRelation = "representative" | "exact-voicing" | "voicing-variant" | "inversion";

export interface LeftHandChordOccurrence {
  id: string;
  range: ScoreRange;
  measureIndex: number;
  beatIndex: number;
  absoluteStartTick: number;
  absoluteEndTick: number;
  symbol: string;
  name: string;
  alternatives: string[];
  noteNames: string[];
  pitchClasses: string[];
  bass: string;
  pitchClassSignature: string;
  voicingSignature: string;
  relation: ChordOccurrenceRelation;
}

export interface LeftHandChordFamily {
  id: string;
  label: string;
  summary: string;
  pitchClasses: string[];
  occurrenceCount: number;
  voicingVariantCount: number;
  bassVariants: Array<{ bass: string; count: number }>;
  occurrences: LeftHandChordOccurrence[];
}

export interface LeftHandChordAnalysis {
  families: LeftHandChordFamily[];
  occurrences: LeftHandChordOccurrence[];
}

export type LeftHandChordGroupingMode = "meter-beat" | "notated-beat" | "measure";

export interface LeftHandChordGroupingOverride {
  startMeasureIndex: number;
  endMeasureIndex: number;
  mode: LeftHandChordGroupingMode;
}

export interface LeftHandChordGrouping {
  defaultMode: LeftHandChordGroupingMode;
  overrides: LeftHandChordGroupingOverride[];
}

export type LeftHandAnalysisMode = "chord-groups" | "polyphonic-texture";

export type LeftHandTextureRole =
  | "bass-framework"
  | "sustained-interval"
  | "voice-leading"
  | "closing-gesture";

export type LeftHandTextureRelation = "representative" | "exact" | "near-exact" | "varied";

export interface LeftHandTextureOccurrence {
  id: string;
  label: string;
  range: ScoreRange;
  summary: string;
  noteNames: string[];
  relation: LeftHandTextureRelation;
  differences: string[];
}

export interface LeftHandTextureFamily {
  id: string;
  label: string;
  summary: string;
  role: LeftHandTextureRole;
  recognitionBasis: string[];
  understanding: string;
  occurrences: LeftHandTextureOccurrence[];
}

export interface ScoreAnalysis {
  schemaVersion: "2.1.0";
  analysisVersion: string;
  score: ScoreAnalysisMetadata;
  form: AnalysisForm;
  sources: AnalysisSource[];
  crossValidation: CrossValidationItem[];
  sections: AnalysisSection[];
  motifFamilies: MotifFamily[];
  leftHandAnalysisMode: LeftHandAnalysisMode;
  leftHandChordGrouping: LeftHandChordGrouping | null;
  leftHandChordFamilies: LeftHandChordFamily[];
  leftHandTextureFamilies: LeftHandTextureFamily[];
}

export type AnalysisTab = "structure" | "motif" | "left-hand";
export type AppMode = "practice" | "analysis";

export type AnalysisViewItem =
  | { kind: "section"; id: string; label: string; summary: string; ranges: ScoreRange[]; entity: AnalysisSection }
  | { kind: "motif"; id: string; label: string; summary: string; ranges: ScoreRange[]; entity: MotifFamily }
  | { kind: "chord"; id: string; label: string; summary: string; ranges: ScoreRange[]; entity: LeftHandChordFamily }
  | { kind: "texture"; id: string; label: string; summary: string; ranges: ScoreRange[]; entity: LeftHandTextureFamily };
