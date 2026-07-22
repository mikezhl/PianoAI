import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AnalysisSection, ScoreAnalysis, ScoreRange } from "../../src/analysis/types";
import { scorePositionToTimelineTick } from "../../src/lib/scoreIdentity";
import { alignMidiToScore } from "../../src/performance/alignment";
import { interpolatePerformanceTime } from "../../src/performance/interpretation";
import type { PerformanceTimeAnchor, TranscribedPerformanceNote } from "../../src/performance/types";
import type { ScoreData } from "../../src/types";
import { loadCanonicalScore } from "./canonical-score";
import type {
  PianoAlignmentMetrics,
  ScoreInformedEvaluationReport,
} from "./automated-performance-validation";

interface PianoTranscriptionPayload {
  backend: string;
  notes: Array<{ onset_time: number; offset_time: number; midi_note: number; velocity: number }>;
  pedals: Array<{ onset_time: number; offset_time: number }>;
}

interface ScoreAlignmentReport {
  schemaVersion: "2.0.0";
  scoreId: string;
  audioSha256: string;
  algorithm: string;
  effectiveRangeSeconds: [number, number];
  timeMap: PerformanceTimeAnchor[];
  scoreAlignment: {
    featureRate: number;
    tuningOffsetCents: number;
    audioFrames: number;
    scoreFrames: number;
    warpingPathFrames: number;
    anchorCount: number;
    medianChromaSimilarity: number;
    p10ChromaSimilarity: number;
    p90ChromaSimilarity: number;
  };
  models: {
    pianoTranscriptionInference: {
      version: string;
      noteCount: number;
      pedalEventCount: number;
    };
  };
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function pianoNotes(payload: PianoTranscriptionPayload): TranscribedPerformanceNote[] {
  return payload.notes.map((note, index) => ({
    id: `piano-transcription:${index}`,
    pitch: note.midi_note,
    channel: 0,
    keyDownUs: Math.round(note.onset_time * 1_000_000),
    keyUpUs: Math.round(note.offset_time * 1_000_000),
    attackVelocity: note.velocity,
  }));
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.ceil(ordered.length * quantile) - 1);
  return ordered[Math.max(0, index)];
}

function sectionWindows(timeMap: PerformanceTimeAnchor[], score: ScoreData, section: AnalysisSection) {
  const playbackOrder = score.measurePlaybackOrder;
  if (!playbackOrder?.some((occurrence) => occurrence.playbackOccurrence > 0)) {
    const startTick = scorePositionToTimelineTick(score, section.range.start);
    const endTick = scorePositionToTimelineTick(score, section.range.end);
    const start = interpolatePerformanceTime(score, timeMap, startTick);
    const end = interpolatePerformanceTime(score, timeMap, endTick);
    if (!start || !end) throw new Error(`Missing score-informed time map for ${section.id}`);
    return [{ startUs: start.timeUs - 200_000, endUs: end.timeUs + 200_000 }];
  }

  const occurrenceGroups: typeof playbackOrder[] = [];
  let current: typeof playbackOrder = [];
  for (const occurrence of playbackOrder) {
    const included = occurrence.measureIndex >= section.range.start.measureIndex
      && occurrence.measureIndex < section.range.end.measureIndex;
    if (included) {
      current.push(occurrence);
    } else if (current.length > 0) {
      occurrenceGroups.push(current);
      current = [];
    }
  }
  if (current.length > 0) occurrenceGroups.push(current);
  if (occurrenceGroups.length === 0) throw new Error(`No playback occurrence for ${section.id}`);

  return occurrenceGroups.map((group) => {
    const first = group[0];
    const last = group.at(-1)!;
    const startTick = first.measureIndex === section.range.start.measureIndex
      ? scorePositionToTimelineTick(score, {
        ...section.range.start,
        playbackOccurrence: first.playbackOccurrence,
      })
      : first.timelineStartTick;
    const endTick = section.range.end.measureIndex === last.measureIndex
      ? scorePositionToTimelineTick(score, {
        ...section.range.end,
        playbackOccurrence: last.playbackOccurrence,
      })
      : last.timelineStartTick + last.durationTicks;
    const start = interpolatePerformanceTime(score, timeMap, startTick);
    const end = interpolatePerformanceTime(score, timeMap, endTick);
    if (!start || !end) throw new Error(`Missing score-informed time map for ${section.id}`);
    return { startUs: start.timeUs - 200_000, endUs: end.timeUs + 200_000 };
  });
}

function metricsForRange(
  score: ScoreData,
  range: ScoreRange,
  notes: TranscribedPerformanceNote[],
  timeMap: PerformanceTimeAnchor[],
): PianoAlignmentMetrics {
  const alignment = alignMidiToScore(score, range, ["left", "right"], notes, { timeMap });
  const residualsMs = alignment.mappings.flatMap((mapping) => {
    if (!mapping.scoreNote || !mapping.midiNote) return [];
    if (mapping.status !== "matched" && mapping.status !== "ornament-realized") return [];
    const predicted = interpolatePerformanceTime(score, timeMap, mapping.scoreNote.absoluteTick);
    return predicted ? [Math.abs(mapping.midiNote.keyDownUs - predicted.timeUs) / 1_000] : [];
  });
  return {
    matchedNotes: alignment.matchedNotes,
    substitutedNotes: alignment.substitutedNotes,
    ornamentNotes: alignment.ornamentNotes,
    omittedNotes: alignment.omittedNotes,
    extraNotes: alignment.extraNotes,
    uncertainNotes: alignment.uncertainNotes,
    scoreCoverage: Number(alignment.scoreCoverage.toFixed(4)),
    performanceCoverage: Number(alignment.performanceCoverage.toFixed(4)),
    confidence: Number(alignment.confidence.toFixed(4)),
    onsetResidualMs: {
      median: Number(percentile(residualsMs, 0.5).toFixed(2)),
      p90: Number(percentile(residualsMs, 0.9).toFixed(2)),
      p95: Number(percentile(residualsMs, 0.95).toFixed(2)),
    },
  };
}

async function main(): Promise<void> {
  const score = await loadCanonicalScore(argument("--score"));
  const analysis = JSON.parse(readFileSync(argument("--analysis"), "utf8")) as ScoreAnalysis;
  const alignment = JSON.parse(readFileSync(argument("--alignment"), "utf8")) as ScoreAlignmentReport;
  const transcription = JSON.parse(
    readFileSync(argument("--piano-transcription"), "utf8"),
  ) as PianoTranscriptionPayload;
  const notes = pianoNotes(transcription);

  const sections = Object.fromEntries(analysis.sections.map((section) => {
    const windows = sectionWindows(alignment.timeMap, score, section);
    const selected = notes.filter((note) => windows.some((window) =>
      note.keyDownUs >= window.startUs && note.keyDownUs < window.endUs));
    return [section.id, metricsForRange(score, section.range, selected, alignment.timeMap)];
  }));
  const fullRange: ScoreRange = {
    start: { measureIndex: 0, offsetQuarter: { numerator: 0, denominator: 1 } },
    end: {
      measureIndex: score.measureStarts.length,
      offsetQuarter: { numerator: 0, denominator: 1 },
    },
  };
  const effectiveNotes = notes.filter((note) =>
    note.keyDownUs >= alignment.effectiveRangeSeconds[0] * 1_000_000
    && note.keyDownUs <= alignment.effectiveRangeSeconds[1] * 1_000_000);
  const overall = metricsForRange(score, fullRange, effectiveNotes, alignment.timeMap);
  const orderedTicks = alignment.timeMap.map((anchor) => scorePositionToTimelineTick(score, anchor.scorePosition));
  if (orderedTicks.some((tick, index) => index > 0 && tick <= orderedTicks[index - 1])) {
    throw new Error("Score-informed anchors are not strictly ordered by score position");
  }
  if (alignment.timeMap.some((anchor, index) => index > 0 && anchor.timeUs <= alignment.timeMap[index - 1].timeUs)) {
    throw new Error("Score-informed anchors are not strictly ordered by performance time");
  }

  const output: ScoreInformedEvaluationReport = {
    ...alignment,
    pianoAlignment: { overall, sections },
    limitations: [
      "The global time map is derived from score chroma and onset features, while note release, velocity, and pedal remain estimates of the piano transcription model.",
      "Commercial recording mastering and sustained pedal resonance can bias acoustic velocity and release estimates.",
    ],
  };
  const outputPath = argument("--output");
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output: outputPath, overall, sections }, null, 2));
}

void main();
