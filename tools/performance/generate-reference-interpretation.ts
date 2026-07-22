import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  alignMidiToScore,
  buildPerformanceScoreOnsets,
  MIDI_ALIGNMENT_ALGORITHM_VERSION,
} from "../../src/performance/alignment";
import { interpolatePerformanceTime } from "../../src/performance/interpretation";
import type {
  InterpretationCoverage,
  NoteExpression,
  PerformanceTimeAnchor,
  ReferenceInterpretationCatalogEntry,
  ScoreInterpretation,
  TranscribedPerformanceNote,
} from "../../src/performance/types";
import { scoreNoteRefId, scorePositionToTimelineTick, tickToScorePosition } from "../../src/lib/scoreIdentity";
import type { ScoreAnalysis, ScoreRange } from "../../src/analysis/types";
import type { ParsedNote, ScoreData } from "../../src/types";
import {
  deriveAutomatedPerformanceValidation,
  type ScoreInformedEvaluationReport,
} from "./automated-performance-validation";
import { loadCanonicalScore } from "./canonical-score";

interface PianoTranscriptionPayload {
  notes: Array<{ onset_time: number; offset_time: number; midi_note: number; velocity: number }>;
  pedals: Array<{ onset_time: number; offset_time: number }>;
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function pianoTranscriptionNotes(payload: PianoTranscriptionPayload): TranscribedPerformanceNote[] {
  return payload.notes.map((note, index) => ({
    id: `piano-transcription:${index}`,
    pitch: note.midi_note,
    channel: 0,
    keyDownUs: Math.round(note.onset_time * 1_000_000),
    keyUpUs: Math.round(note.offset_time * 1_000_000),
    attackVelocity: note.velocity,
  }));
}

function percentile(value: number, values: number[]): number {
  if (values.length <= 1) return 0.5;
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] < value) low = middle + 1;
    else high = middle;
  }
  return Math.min(values.length - 1, low) / (values.length - 1);
}

function gestureKind(scoreNote: ParsedNote): NonNullable<NoteExpression["realizationKind"]> | null {
  if (scoreNote.ornament && scoreNote.graceNotes?.length) return "mixed";
  if (scoreNote.ornament) return scoreNote.ornament.kind;
  if (scoreNote.graceNotes?.length) return "grace";
  return null;
}

function realizationFrom(note: TranscribedPerformanceNote, velocities: number[]) {
  return {
    pitch: note.pitch,
    onsetUs: note.keyDownUs,
    releaseUs: note.keyUpUs,
    intensity: percentile(note.attackVelocity, velocities),
    ...(note.channel === 0 ? {} : { channel: note.channel }),
  };
}

function gesturePitchSet(scoreNote: ParsedNote): Set<number> {
  const pitches = new Set<number>([
    scoreNote.midi,
    ...scoreNote.playbackEvents.flatMap((event) => event.midis),
    ...(scoreNote.ornament?.expectedPitches ?? []),
    ...(scoreNote.graceNotes?.map((grace) => grace.midi) ?? []),
  ]);
  if (scoreNote.ornament) {
    pitches.add(scoreNote.midi - 2);
    pitches.add(scoreNote.midi - 1);
    pitches.add(scoreNote.midi + 1);
    pitches.add(scoreNote.midi + 2);
  }
  return pitches;
}

function contiguousAround(
  notes: TranscribedPerformanceNote[],
  anchorUs: number,
  maximumGapUs: number,
): TranscribedPerformanceNote[] {
  if (notes.length === 0) return [];
  const ordered = [...notes].sort((left, right) => left.keyDownUs - right.keyDownUs || left.pitch - right.pitch);
  let anchorIndex = ordered.reduce((best, note, index) =>
    Math.abs(note.keyDownUs - anchorUs) < Math.abs(ordered[best].keyDownUs - anchorUs) ? index : best, 0);
  let startIndex = anchorIndex;
  let endIndex = anchorIndex;
  while (startIndex > 0 && ordered[startIndex].keyDownUs - ordered[startIndex - 1].keyDownUs <= maximumGapUs) {
    startIndex -= 1;
  }
  while (endIndex + 1 < ordered.length && ordered[endIndex + 1].keyDownUs - ordered[endIndex].keyDownUs <= maximumGapUs) {
    endIndex += 1;
  }
  anchorIndex = Math.max(startIndex, Math.min(endIndex, anchorIndex));
  return ordered.slice(startIndex, endIndex + 1);
}

function fixedGestureSelection(
  candidates: TranscribedPerformanceNote[],
  expectedPitches: number[],
  anchorUs: number,
): TranscribedPerformanceNote[] {
  const ordered = [...candidates].sort((left, right) => left.keyDownUs - right.keyDownUs || left.pitch - right.pitch);
  if (ordered.length <= expectedPitches.length) return ordered;
  const length = Math.min(ordered.length, Math.max(2, expectedPitches.length));
  let best = ordered.slice(0, length);
  let bestCost = Number.POSITIVE_INFINITY;
  for (let start = 0; start + length <= ordered.length; start += 1) {
    const slice = ordered.slice(start, start + length);
    const pitchCost = slice.reduce((sum, note, index) =>
      sum + Math.min(4, Math.abs(note.pitch - (expectedPitches[index] ?? expectedPitches.at(-1) ?? note.pitch))), 0);
    const centerUs = (slice[0].keyDownUs + slice.at(-1)!.keyDownUs) / 2;
    const cost = pitchCost * 100_000 + Math.abs(centerUs - anchorUs);
    if (cost < bestCost) {
      best = slice;
      bestCost = cost;
    }
  }
  return best;
}

function enrichNotatedRealizations(
  score: ScoreData,
  timeMap: PerformanceTimeAnchor[],
  pianoNotes: TranscribedPerformanceNote[],
  velocities: number[],
  expressions: Map<string, NoteExpression>,
  performanceScoreNotes: ParsedNote[],
): Set<string> {
  const assignedPianoEvents = new Set<string>();
  const scoreNotes = [...performanceScoreNotes]
    .sort((left, right) => {
      const gracePriority = Number(!left.graceNotes?.length) - Number(!right.graceNotes?.length);
      return gracePriority || left.absoluteTick - right.absoluteTick || left.midi - right.midi;
    });
  for (const scoreNote of scoreNotes) {
    const kind = gestureKind(scoreNote);
    if (!kind) continue;
    const id = scoreNoteRefId(scoreNote.scoreRef);
    const expression = expressions.get(id);
    const mappedStart = interpolatePerformanceTime(score, timeMap, scoreNote.absoluteTick)?.timeUs;
    const mappedEnd = interpolatePerformanceTime(
      score,
      timeMap,
      scoreNote.absoluteTick + scoreNote.durationTicks,
    )?.timeUs;
    const anchorUs = expression?.onsetUs ?? mappedStart;
    if (anchorUs == null) continue;
    const nextExpressionOnset = scoreNotes
      .filter((candidate) => candidate.absoluteTick >= scoreNote.absoluteTick + scoreNote.durationTicks)
      .sort((left, right) => left.absoluteTick - right.absoluteTick || left.midi - right.midi)
      .map((candidate) => expressions.get(scoreNoteRefId(candidate.scoreRef))?.onsetUs)
      .find((timeUs): timeUs is number => timeUs != null && timeUs > anchorUs);
    const isLongTrill = scoreNote.ornament?.kind === "trill" && scoreNote.ornament.hasWavyLine;
    const hasGrace = Boolean(scoreNote.graceNotes?.length);
    const windowStartUs = Math.min(anchorUs, mappedStart ?? anchorUs) - (hasGrace ? 900_000 : 350_000);
    const windowEndUs = Math.min(
      anchorUs + (isLongTrill ? 5_000_000 : hasGrace ? 800_000 : 1_500_000),
      Math.max(
        mappedEnd ?? anchorUs,
        expression?.releaseUs ?? anchorUs,
        nextExpressionOnset ?? anchorUs,
      ) + (isLongTrill ? 700_000 : 300_000),
    );
    const allowedPitches = gesturePitchSet(scoreNote);
    const candidates = pianoNotes.filter((note) =>
      !assignedPianoEvents.has(note.id)
      && note.keyDownUs >= windowStartUs
      && note.keyDownUs <= windowEndUs
      && allowedPitches.has(note.pitch));
    const expectedPitches = scoreNote.playbackEvents.flatMap((event) => event.midis);
    const selected = isLongTrill
      ? contiguousAround(candidates, anchorUs, 600_000)
      : fixedGestureSelection(candidates, expectedPitches, anchorUs);
    if (selected.length < 2 || new Set(selected.map((note) => note.pitch)).size < 2) continue;
    const centerUs = median(selected.map((note) => note.keyDownUs));
    const timingResidualUs = Math.abs(centerUs - anchorUs);
    const confidence = Math.max(0.72, Math.min(0.88, 0.88 - timingResidualUs / 2_000_000));
    expressions.set(id, {
      scoreNoteRef: scoreNote.scoreRef,
      kind: "ornament",
      realizationKind: kind,
      realizations: selected.map((note) => realizationFrom(note, velocities)),
      confidence,
    });
    selected.forEach((note) => assignedPianoEvents.add(note.id));
  }
  return assignedPianoEvents;
}

function median(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2
    : ordered[middle] ?? 0;
}

function buildDensePlaybackTimeMap(
  score: ScoreData,
  baseTimeMap: PerformanceTimeAnchor[],
  expressions: Map<string, NoteExpression>,
): PerformanceTimeAnchor[] {
  const observationsByTick = new Map<number, number[]>();
  for (const group of score.noteGroups) {
    const observed = group.notes.flatMap((note) => {
      const expression = expressions.get(scoreNoteRefId(note.scoreRef));
      return expression
        && expression.confidence >= 0.75
        && expression.onsetUs != null
        ? [expression.onsetUs]
        : [];
    });
    if (observed.length === 0) continue;
    const values = observationsByTick.get(group.absoluteTick) ?? [];
    values.push(...observed);
    observationsByTick.set(group.absoluteTick, values);
  }
  const observations = [...observationsByTick]
    .map(([tick, times]) => ({ tick, timeUs: Math.round(median(times)) }))
    .sort((left, right) => left.tick - right.tick);
  const fixed = baseTimeMap
    .map((anchor) => ({ anchor, tick: scorePositionToTimelineTick(score, anchor.scorePosition) }))
    .sort((left, right) => left.tick - right.tick);
  if (fixed.length < 2) return baseTimeMap;
  const result: PerformanceTimeAnchor[] = [];
  for (let index = 0; index < fixed.length - 1; index += 1) {
    const left = fixed[index];
    const right = fixed[index + 1];
    if (index === 0) result.push(left.anchor);
    let previousTimeUs = left.anchor.timeUs;
    for (const observation of observations) {
      if (observation.tick <= left.tick || observation.tick >= right.tick) continue;
      if (
        observation.timeUs <= previousTimeUs + 10_000
        || observation.timeUs >= right.anchor.timeUs - 10_000
      ) continue;
      result.push({
        scorePosition: tickToScorePosition(score, observation.tick),
        timeUs: observation.timeUs,
        confidence: 0.82,
      });
      previousTimeUs = observation.timeUs;
    }
    result.push(right.anchor);
  }
  return result;
}

async function main() {
  const analysis = JSON.parse(readFileSync(argument("--analysis"), "utf8")) as ScoreAnalysis;
  const referencesPath = argument("--references");
  const catalog = JSON.parse(readFileSync(referencesPath, "utf8")) as {
    schemaVersion: string;
    references: ReferenceInterpretationCatalogEntry[];
  };
  const interpretationId = argument("--interpretation-id");
  const reference = catalog.references.find((candidate) => candidate.interpretationId === interpretationId);
  if (!reference) throw new Error("Reference not found");
  if (reference.score.scoreId !== analysis.score.id || reference.score.sourceHash !== analysis.score.sourceHash) {
    throw new Error("Reference score identity mismatch");
  }
  catalog.schemaVersion = "2.1.0";
  const evaluationPath = argument("--evaluation");
  const evaluation = JSON.parse(readFileSync(evaluationPath, "utf8")) as ScoreInformedEvaluationReport;
  if (evaluation.scoreId !== reference.score.scoreId || evaluation.audioSha256 !== reference.audio.sha256) {
    throw new Error("Automatic evaluation identity mismatch");
  }
  if (evaluation.timeMap.length < 2) throw new Error("Score-informed time map is incomplete");
  const baseTimeMap = evaluation.timeMap;
  const score = await loadCanonicalScore(argument("--score"));
  const pianoPayload = JSON.parse(readFileSync(argument("--piano-transcription"), "utf8")) as PianoTranscriptionPayload;
  const pianoNotes = pianoTranscriptionNotes(pianoPayload);
  const velocities = pianoNotes.map((note) => note.attackVelocity).sort((left, right) => left - right);
  const expressions = new Map<string, NoteExpression>();
  const extraEventIds = new Set<string>();
  const fullRange: ScoreRange = {
    start: { measureIndex: 0, offsetQuarter: { numerator: 0, denominator: 1 } },
    end: { measureIndex: score.measureDurations.length, offsetQuarter: { numerator: 0, denominator: 1 } },
  };
  const performanceScoreNotes = buildPerformanceScoreOnsets(score, fullRange, ["left", "right"])
    .flatMap((onset) => onset.notes);
  const effectiveNotes = pianoNotes.filter((note) =>
    note.keyDownUs >= evaluation.effectiveRangeSeconds[0] * 1_000_000
    && note.keyDownUs <= evaluation.effectiveRangeSeconds[1] * 1_000_000);
  const pianoAlignment = alignMidiToScore(
    score,
    fullRange,
    ["left", "right"],
    effectiveNotes,
    { timeMap: baseTimeMap },
  );

  for (const mapping of pianoAlignment.mappings) {
    const scoreNote = mapping.scoreNote;
    if (!scoreNote) {
      if (mapping.status === "extra" && mapping.midiNote) extraEventIds.add(mapping.midiNote.id);
      continue;
    }
    const id = scoreNoteRefId(scoreNote.scoreRef);
    const pianoRealizations = mapping.status === "ornament-realized" ? mapping.midiNotes ?? [] : [];
    const kind = gestureKind(scoreNote);
    const realized = pianoRealizations.length >= 2 && kind != null;
    if (realized) {
      const predicted = interpolatePerformanceTime(score, baseTimeMap, scoreNote.absoluteTick)?.timeUs;
      const centerUs = median(pianoRealizations.map((note) => note.keyDownUs));
      const timingResidualUs = predicted == null ? 500_000 : Math.abs(centerUs - predicted);
      expressions.set(id, {
        scoreNoteRef: scoreNote.scoreRef,
        kind: "ornament",
        realizations: pianoRealizations.map((note) => realizationFrom(note, velocities)),
        realizationKind: kind,
        confidence: Math.max(
          0.68,
          Math.min(0.9, mapping.confidence * (0.95 - timingResidualUs / 2_000_000)),
        ),
      });
    } else if (mapping.status === "matched" && mapping.midiNote) {
      const predicted = interpolatePerformanceTime(score, baseTimeMap, scoreNote.absoluteTick)?.timeUs;
      const timingResidualUs = predicted == null
        ? 500_000
        : Math.abs(mapping.midiNote.keyDownUs - predicted);
      expressions.set(id, {
        scoreNoteRef: scoreNote.scoreRef,
        kind: "performed",
        onsetUs: mapping.midiNote.keyDownUs,
        releaseUs: mapping.midiNote.keyUpUs,
        intensity: percentile(mapping.midiNote.attackVelocity, velocities),
        confidence: Math.max(0.55, Math.min(0.94, 0.94 - timingResidualUs / 1_500_000)),
      });
    }
  }

  const assignedGestureEvents = enrichNotatedRealizations(
    score,
    baseTimeMap,
    pianoNotes,
    velocities,
    expressions,
    performanceScoreNotes,
  );
  assignedGestureEvents.forEach((eventId) => extraEventIds.delete(eventId));

  const scoreNoteCount = performanceScoreNotes.length;
  const notatedGestureCount = performanceScoreNotes
    .filter((note) => note.ornament || note.graceNotes?.length).length;
  const ornamentNoteCount = Array.from(expressions.values()).filter((expression) =>
    expression.kind === "ornament").length;
  const matchedNoteCount = Array.from(expressions.values()).filter((expression) =>
    expression.kind === "performed").length;
  const playbackTimeMap = buildDensePlaybackTimeMap(score, baseTimeMap, expressions);
  const pedals = {
    sustain: pianoPayload.pedals.flatMap((pedal) => {
      const onsetUs = Math.round(pedal.onset_time * 1_000_000);
      const offsetUs = Math.min(
        reference.audio.durationUs,
        Math.round(pedal.offset_time * 1_000_000),
      );
      return onsetUs < offsetUs
        ? [{ timeUs: onsetUs, value: 1 }, { timeUs: offsetUs, value: 0 }]
        : [];
    }).sort((left, right) => left.timeUs - right.timeUs),
  };
  const noteExpressions = Array.from(expressions.values());
  const coverage: InterpretationCoverage = {
    scoreNotes: scoreNoteCount,
    matchedNotes: matchedNoteCount,
    ornamentGestures: ornamentNoteCount,
    uncertainNotes: Math.max(0, scoreNoteCount - matchedNoteCount - ornamentNoteCount),
    extraEvents: extraEventIds.size,
    scoreCoverage: (matchedNoteCount + ornamentNoteCount) / scoreNoteCount,
    performanceCoverage: matchedNoteCount / Math.max(1, effectiveNotes.length),
  };
  const automaticValidation = deriveAutomatedPerformanceValidation({
    evaluation,
    coverage,
    noteExpressions,
    pedals,
    notatedGestureCount,
  });
  const evaluationSha256 = `sha256:${createHash("sha256")
    .update(readFileSync(evaluationPath))
    .digest("hex")
    .toUpperCase()}`;
  const output: ScoreInterpretation = {
    schemaVersion: "2.1.0",
    interpretationId: reference.interpretationId,
    score: reference.score,
    timeMap: playbackTimeMap,
    noteExpressions,
    pedals,
    generation: {
      status: automaticValidation.status,
      algorithmVersion: `${MIDI_ALIGNMENT_ALGORITHM_VERSION}+synctoolbox-mrmsdtw-1`,
      validationPolicyVersion: automaticValidation.policyVersion,
      models: ["piano-transcription-inference-0.0.6-note-pedal"],
      evaluationId: reference.interpretationId,
      evaluationSha256,
      dimensions: automaticValidation.dimensions,
      coverage,
    },
  };
  const outputPath = argument("--output");
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  if (!process.argv.includes("--skip-reference-write")) {
    const referencesOutputPath = process.argv.includes("--output-references")
      ? argument("--output-references")
      : referencesPath;
    const nextCatalog = {
      schemaVersion: "2.1.0",
      references: catalog.references.map((entry) => ({
        interpretationId: entry.interpretationId,
        score: entry.score,
        performerId: entry.performerId,
        performerName: entry.performerName,
        evidenceId: entry.evidenceId,
        source: entry.source,
        audio: entry.audio,
      })),
    };
    writeFileSync(referencesOutputPath, `${JSON.stringify(nextCatalog, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(output.generation, null, 2));
}

void main();
