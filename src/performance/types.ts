import type { ScorePosition } from "../analysis/types";
import type { ScoreNoteRef } from "../types";

export type ReferenceValidationDimension =
  | "pitch"
  | "note-onset"
  | "note-offset"
  | "pedal"
  | "ornament"
  | "dynamics";

export interface ScoreIdentity {
  scoreId: string;
  sourceHash: string;
  identitySource: "library-source" | "canonical-xml";
}

export interface PedalPoint {
  timeUs: number;
  value: number;
}

export interface PianoPedals {
  sustain: PedalPoint[];
}

export interface TranscribedPerformanceNote {
  id: string;
  pitch: number;
  channel: number;
  keyDownUs: number;
  keyUpUs: number;
  attackVelocity: number;
}

export interface PerformanceTimeAnchor {
  scorePosition: ScorePosition;
  timeUs: number;
  confidence: number;
}

export interface TempoSample {
  scorePosition: ScorePosition;
  quarterBpm?: number;
  metricalBeat: { numerator: number; denominator: number };
  metricalBeatBpm?: number;
  normalizedTempoRatio?: number;
  resolution: "section" | "measure" | "beat" | "note";
  confidence: number;
  tempoMode?: "metrical" | "free-time";
}

interface NoteExpressionBase {
  scoreNoteRef: ScoreNoteRef;
  confidence: number;
}

export interface PerformedNoteExpression extends NoteExpressionBase {
  kind: "performed";
  onsetUs: number;
  releaseUs: number;
  intensity: number;
  realizations?: never;
  realizationKind?: never;
}

export interface OrnamentNoteExpression extends NoteExpressionBase {
  kind: "ornament";
  onsetUs?: never;
  releaseUs?: never;
  intensity?: never;
  realizations: NoteRealization[];
  realizationKind: "trill" | "mordent" | "inverted-mordent" | "turn" | "inverted-turn" | "grace" | "mixed";
}

export type NoteExpression = PerformedNoteExpression | OrnamentNoteExpression;

export interface NoteRealization {
  pitch: number;
  onsetUs: number;
  releaseUs: number;
  intensity: number;
}

export interface InterpretationCoverage {
  scoreNotes: number;
  matchedNotes: number;
  ornamentGestures: number;
  uncertainNotes: number;
  extraEvents: number;
  scoreCoverage: number;
  performanceCoverage: number;
}

export interface InterpretationGeneration {
  status: "automated-candidate" | "automatically-validated";
  algorithmVersion: string;
  validationPolicyVersion: string;
  models: string[];
  evaluationId: string;
  evaluationSha256: string;
  dimensions: Partial<Record<ReferenceValidationDimension, number>>;
  coverage: InterpretationCoverage;
}

export interface ScoreInterpretation {
  schemaVersion: "2.1.0";
  interpretationId: string;
  score: ScoreIdentity;
  timeMap: PerformanceTimeAnchor[];
  noteExpressions: NoteExpression[];
  pedals: PianoPedals;
  generation: InterpretationGeneration;
}

export interface ReferenceSource {
  title: string;
  url: string;
  kind: "original-recording";
}

export interface ReferenceAudioEvidence {
  fileName: string;
  objectKey: string;
  sha256: string;
  durationUs: number;
  format: string;
  sampleRate: number;
  channels: number;
  storage: "cloudflare-r2";
}

export interface ReferenceInterpretationCatalogEntry {
  interpretationId: string;
  score: ScoreIdentity;
  performerId: string;
  performerName: string;
  evidenceId: string;
  source: ReferenceSource;
  audio: ReferenceAudioEvidence;
}

export type ReferenceInterpretation = ScoreInterpretation
  & Omit<ReferenceInterpretationCatalogEntry, "audio">
  & { audio: ReferenceAudioEvidence & { url: string } };

export interface ReferenceInterpretationCatalog {
  schemaVersion: "2.1.0";
  references: ReferenceInterpretationCatalogEntry[];
}

export interface ReferenceAnalysisCapabilities {
  sectionTempo: boolean;
  dynamics: boolean;
  articulation: boolean;
  pedal: boolean;
}

export interface PerformancePlaybackNote {
  id: string;
  pitch: number;
  scoreTick: number;
  scoreGroupId: string;
  onsetUs: number;
  offsetUs: number;
  velocity: number;
  synthesized: boolean;
  onsetSource?: "reference" | "time-map" | "score-group";
  durationSource?: "reference" | "time-map";
  dynamicsSource?: "reference" | "default";
}
