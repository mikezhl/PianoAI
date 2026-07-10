import { detect } from "@tonaljs/chord-detect";
import { chroma } from "@tonaljs/note";
import type {
  ChordOccurrenceRelation,
  LeftHandChordAnalysis,
  LeftHandChordFamily,
  LeftHandChordGrouping,
  LeftHandChordGroupingMode,
  LeftHandChordOccurrence,
  RationalNumber,
  ScoreAnalysis,
  ScoreRange,
} from "../../analysis/types";
import type { ParsedNote, ScoreData, TimeSignature } from "../../types";
import { TICKS_PER_QUARTER } from "../../types";

const SHARP_PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_PITCH_CLASSES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const SIMPLE_SUFFIX_SCORE: Record<string, number> = {
  "": 8,
  M: 8,
  m: 8,
  "7": 7,
  M7: 7,
  maj7: 7,
  m7: 7,
  m7b5: 6,
  "9": 5,
  M9: 5,
  maj9: 5,
  m9: 5,
  dim: 7,
  dim7: 7,
  aug: 6,
  "6": 6,
  m6: 6,
  sus2: 5,
  sus4: 5,
  "7sus4": 6,
};

interface ChordCandidateParts {
  root: string;
  suffix: string;
  bass: string | null;
}

function modulo12(value: number): number {
  return ((value % 12) + 12) % 12;
}

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a || 1;
}

function ticksToQuarterRational(ticks: number): RationalNumber {
  const divisor = gcd(ticks, TICKS_PER_QUARTER);
  return {
    numerator: ticks / divisor,
    denominator: TICKS_PER_QUARTER / divisor,
  };
}

function pitchClassName(midi: number, preferFlats: boolean): string {
  return (preferFlats ? FLAT_PITCH_CLASSES : SHARP_PITCH_CLASSES)[modulo12(midi)];
}

function noteName(midi: number, preferFlats: boolean): string {
  return `${pitchClassName(midi, preferFlats)}${Math.floor(midi / 12) - 1}`;
}

function displayAccidentals(value: string): string {
  return value.replaceAll("b", "♭").replaceAll("#", "♯");
}

function parseCandidate(symbol: string): ChordCandidateParts | null {
  const match = symbol.match(/^([A-G](?:b|#)?)(.*?)(?:\/([A-G](?:b|#)?))?$/);
  if (!match) {
    return null;
  }
  return { root: match[1], suffix: match[2], bass: match[3] ?? null };
}

function pitchClassIndex(name: string): number | null {
  const normalized = name.replace("♭", "b").replace("♯", "#");
  const value = chroma(normalized);
  return value == null ? null : value;
}

function candidateScore(symbol: string, bassPitchClass: number): number {
  const parts = parseCandidate(symbol);
  if (!parts) {
    return -100;
  }
  const rootIndex = pitchClassIndex(parts.root);
  const slashIndex = parts.bass ? pitchClassIndex(parts.bass) : null;
  const suffixScore = SIMPLE_SUFFIX_SCORE[parts.suffix];
  if (suffixScore == null) {
    return -100;
  }
  let score = suffixScore;
  if (rootIndex === bassPitchClass && !parts.bass) {
    score += 6;
  }
  if (slashIndex === bassPitchClass) {
    score += 4;
  } else if (parts.bass) {
    score -= 8;
  }
  if (/[#b](?:5|9|11|13)|add|no\d/.test(parts.suffix)) {
    score -= 4;
  }
  if (parts.suffix === "sus24" || parts.suffix === "4") {
    score -= 3;
  }
  return score;
}

function chooseCandidate(candidates: string[], bassMidi: number): string | null {
  const ranked = [...candidates].sort((left, right) => (
    candidateScore(right, modulo12(bassMidi)) - candidateScore(left, modulo12(bassMidi))
  ));
  const best = ranked[0] ?? null;
  return best && candidateScore(best, modulo12(bassMidi)) >= 5 ? best : null;
}

function formatSymbol(symbol: string): string {
  const parts = parseCandidate(symbol);
  if (!parts) {
    return displayAccidentals(symbol);
  }
  const suffix = parts.suffix === "M" ? "" : parts.suffix;
  return `${displayAccidentals(parts.root)}${suffix}${parts.bass ? `/${displayAccidentals(parts.bass)}` : ""}`;
}

function chordName(symbol: string | null, pitchClasses: string[], bass: string): { symbol: string; name: string } {
  if (!symbol) {
    const displayedPitchClasses = pitchClasses.map(displayAccidentals);
    if (pitchClasses.length === 1) {
      return { symbol: displayedPitchClasses[0], name: `${displayedPitchClasses[0]} 低音或八度支点` };
    }
    if (pitchClasses.length === 2) {
      return { symbol: displayedPitchClasses.join("–"), name: `${displayedPitchClasses.join("–")} 二音集合` };
    }
    return { symbol: displayedPitchClasses.join("–"), name: `${displayedPitchClasses.join("–")} 音高集合` };
  }

  const parts = parseCandidate(symbol);
  if (!parts) {
    const formatted = formatSymbol(symbol);
    return { symbol: formatted, name: formatted };
  }
  const qualityNames: Record<string, string> = {
    "": "大三和弦",
    M: "大三和弦",
    m: "小三和弦",
    "7": "属七和弦",
    M7: "大七和弦",
    maj7: "大七和弦",
    m7: "小七和弦",
    m7b5: "半减七和弦",
    "9": "属九和弦",
    M9: "大九和弦",
    maj9: "大九和弦",
    m9: "小九和弦",
    dim: "减三和弦",
    dim7: "减七和弦",
    aug: "增三和弦",
    "6": "六和弦",
    m6: "小六和弦",
    sus2: "挂二和弦",
    sus4: "挂四和弦",
  };
  const root = displayAccidentals(parts.root);
  const quality = qualityNames[parts.suffix] ?? parts.suffix;
  const formatted = formatSymbol(symbol);
  const inversion = parts.bass || pitchClassIndex(parts.root) !== pitchClassIndex(bass)
    ? `，${displayAccidentals(parts.bass ?? bass)} 低音`
    : "";
  return { symbol: formatted, name: `${root} ${quality}${inversion}` };
}

function writtenPitchClass(name: string): string {
  return name.replace(/-?\d+$/, "");
}

function familySpellingSignature(pitchClasses: string[]): string {
  return pitchClasses.join("-");
}

function familyId(pitchClassSignature: string, pitchClasses: string[]): string {
  const spelling = pitchClasses
    .map((pitchClass) => pitchClass
      .replaceAll("♭", "b")
      .replaceAll("♯", "s")
      .replace(/[^A-Za-z0-9]+/g, "")
      .toLowerCase())
    .join("-");
  return `chord-pc-${pitchClassSignature || "none"}-${spelling || "unnamed"}`;
}

function parseMeter(meter: string): TimeSignature {
  const match = meter.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match) {
    return { beats: 4, beatType: 4 };
  }
  return {
    beats: Number.parseInt(match[1], 10),
    beatType: Number.parseInt(match[2], 10),
  };
}

function groupingModeAtMeasure(grouping: LeftHandChordGrouping, measureIndex: number): LeftHandChordGroupingMode {
  return grouping.overrides.find((override) => (
    measureIndex >= override.startMeasureIndex && measureIndex < override.endMeasureIndex
  ))?.mode ?? grouping.defaultMode;
}

function groupingTicks(
  mode: LeftHandChordGroupingMode,
  timeSignature: TimeSignature,
  measureDuration: number,
): number {
  if (mode === "measure") {
    return Math.max(1, measureDuration);
  }
  const notatedBeatTicks = TICKS_PER_QUARTER * (4 / timeSignature.beatType);
  if (mode === "meter-beat" && timeSignature.beats > 3 && timeSignature.beats % 3 === 0) {
    return Math.max(1, Math.round(notatedBeatTicks * 3));
  }
  return Math.max(1, Math.round(notatedBeatTicks));
}

function rangeForGroup(score: ScoreData, measureIndex: number, startTick: number, endTick: number): ScoreRange {
  const duration = score.measureDurations[measureIndex] ?? endTick;
  const clampedEnd = Math.min(duration, endTick);
  const end = clampedEnd >= duration
    ? { measureIndex: measureIndex + 1, offsetQuarter: { numerator: 0, denominator: 1 } }
    : { measureIndex, offsetQuarter: ticksToQuarterRational(clampedEnd) };
  return {
    start: { measureIndex, offsetQuarter: ticksToQuarterRational(startTick) },
    end,
  };
}

function countValues(values: string[]): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts, ([value, count]) => ({ value, count })).sort((left, right) => (
    right.count - left.count || left.value.localeCompare(right.value)
  ));
}

function relationToRepresentative(
  occurrence: LeftHandChordOccurrence,
  representative: LeftHandChordOccurrence,
): ChordOccurrenceRelation {
  if (occurrence.id === representative.id) {
    return "representative";
  }
  if (occurrence.voicingSignature === representative.voicingSignature) {
    return "exact-voicing";
  }
  if (occurrence.bass !== representative.bass) {
    return "inversion";
  }
  return "voicing-variant";
}

function makeOccurrence(
  score: ScoreData,
  analysis: ScoreAnalysis,
  notes: ParsedNote[],
  measureIndex: number,
  groupIndex: number,
  groupTicks: number,
): LeftHandChordOccurrence {
  const preferFlats = analysis.score.key.toLowerCase().includes("flat") || analysis.score.key.includes("♭");
  const notesByMidi = new Map<number, ParsedNote>();
  for (const note of notes) {
    const existing = notesByMidi.get(note.midi);
    if (!existing || (!existing.writtenName && note.writtenName)) {
      notesByMidi.set(note.midi, note);
    }
  }
  const uniqueMidis = [...notesByMidi.keys()].sort((a, b) => a - b);
  const bassMidi = uniqueMidis[0];
  const pitchClassIndices = [...new Set(uniqueMidis.map(modulo12))].sort((a, b) => a - b);
  const sourceNoteNames = uniqueMidis.map((midi) => notesByMidi.get(midi)?.writtenName ?? noteName(midi, preferFlats));
  const writtenByPitchClass = new Map<number, string>();
  for (let index = 0; index < uniqueMidis.length; index += 1) {
    writtenByPitchClass.set(modulo12(uniqueMidis[index]), writtenPitchClass(sourceNoteNames[index]));
  }
  const pitchClasses = pitchClassIndices.map((pitchClass) => (
    writtenByPitchClass.get(pitchClass) ?? pitchClassName(pitchClass, preferFlats)
  ));
  const detected = pitchClasses.length >= 3 ? detect(sourceNoteNames) : [];
  const chosen = chooseCandidate(detected, bassMidi);
  const chosenScore = chosen ? candidateScore(chosen, modulo12(bassMidi)) : 0;
  const bass = writtenPitchClass(sourceNoteNames[0]);
  const named = chordName(chosen, pitchClasses, bass);
  const startTick = groupIndex * groupTicks;
  const endTick = startTick + groupTicks;
  const range = rangeForGroup(score, measureIndex, startTick, endTick);

  return {
    id: `left-chord-${measureIndex}-${groupIndex}`,
    range,
    measureIndex,
    beatIndex: groupIndex,
    absoluteStartTick: (score.measureStarts[measureIndex] ?? 0) + startTick,
    absoluteEndTick: (score.measureStarts[measureIndex] ?? 0) + Math.min(score.measureDurations[measureIndex] ?? endTick, endTick),
    symbol: named.symbol,
    name: named.name,
    alternatives: chosen
      ? detected
          .filter((candidate) => candidate !== chosen && candidateScore(candidate, modulo12(bassMidi)) >= chosenScore - 2)
          .slice(0, 3)
          .map(formatSymbol)
      : [],
    noteNames: sourceNoteNames.map(displayAccidentals),
    pitchClasses: pitchClasses.map(displayAccidentals),
    bass: displayAccidentals(bass),
    pitchClassSignature: pitchClassIndices.join("-"),
    voicingSignature: uniqueMidis.join("-"),
    relation: "representative",
  };
}

export function buildLeftHandChordAnalysis(score: ScoreData, analysis: ScoreAnalysis): LeftHandChordAnalysis {
  if (analysis.leftHandAnalysisMode !== "chord-groups" || !analysis.leftHandChordGrouping) {
    throw new Error("当前分析未配置左手和弦分组");
  }
  const grouping = analysis.leftHandChordGrouping;
  const fallbackTimeSignature = parseMeter(analysis.score.meter);
  const occurrenceDrafts: LeftHandChordOccurrence[] = [];
  const leftNotes = score.noteGroups
    .filter((group) => group.hand === "left")
    .flatMap((group) => group.notes);

  for (let measureIndex = 0; measureIndex < score.measureStarts.length; measureIndex += 1) {
    const measureStart = score.measureStarts[measureIndex] ?? 0;
    const measureDuration = score.measureDurations[measureIndex] ?? 0;
    const timeSignature = score.measureTimeSignatures[measureIndex] ?? fallbackTimeSignature;
    const mode = groupingModeAtMeasure(grouping, measureIndex);
    const groupTicks = groupingTicks(mode, timeSignature, measureDuration);
    const groupCount = Math.ceil(measureDuration / groupTicks);
    for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
      const groupStart = measureStart + groupIndex * groupTicks;
      const groupEnd = Math.min(measureStart + measureDuration, groupStart + groupTicks);
      const soundingNotes = leftNotes.filter((note) => (
        note.absoluteTick < groupEnd
        && note.absoluteTick + note.durationTicks > groupStart
      ));
      if (soundingNotes.length > 0) {
        occurrenceDrafts.push(makeOccurrence(score, analysis, soundingNotes, measureIndex, groupIndex, groupTicks));
      }
    }
  }

  const familyGroups = new Map<string, LeftHandChordOccurrence[]>();
  for (const occurrence of occurrenceDrafts) {
    const key = `${occurrence.pitchClassSignature}:${familySpellingSignature(occurrence.pitchClasses)}`;
    familyGroups.set(key, [...(familyGroups.get(key) ?? []), occurrence]);
  }

  const families: LeftHandChordFamily[] = Array.from(familyGroups, ([, occurrences]) => {
    const voicingCounts = countValues(occurrences.map((occurrence) => occurrence.voicingSignature));
    const representativeVoicing = voicingCounts[0]?.value;
    const representative = occurrences.find((occurrence) => occurrence.voicingSignature === representativeVoicing) ?? occurrences[0];
    const symbolCounts = countValues(occurrences.map((occurrence) => occurrence.symbol));
    const commonSymbol = symbolCounts[0]?.value ?? representative.symbol;
    const label = representative.pitchClasses.length === 1
      ? `${representative.pitchClasses[0]} 低音`
      : representative.pitchClasses.length === 2
        ? `${representative.pitchClasses.join("–")} 二音`
        : commonSymbol;
    for (const occurrence of occurrences) {
      occurrence.relation = relationToRepresentative(occurrence, representative);
    }
    const bassVariants = countValues(occurrences.map((occurrence) => occurrence.bass))
      .map(({ value, count }) => ({ bass: value, count }));
    return {
      id: familyId(representative.pitchClassSignature, representative.pitchClasses),
      label,
      summary: `${occurrences.length} 次 · ${bassVariants.length} 种低音 · ${voicingCounts.length} 种排列`,
      pitchClasses: representative.pitchClasses,
      occurrenceCount: occurrences.length,
      voicingVariantCount: voicingCounts.length,
      bassVariants,
      occurrences,
    };
  }).sort((left, right) => (
    right.occurrenceCount - left.occurrenceCount
    || left.occurrences[0].absoluteStartTick - right.occurrences[0].absoluteStartTick
  ));

  return { families, occurrences: occurrenceDrafts };
}
