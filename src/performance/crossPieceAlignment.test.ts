import { readFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { parseMusicXml } from "../lib/musicXml";
import { tickBoundsToScoreRange } from "../lib/scoreIdentity";
import type { ScoreData } from "../types";
import { TICKS_PER_QUARTER } from "../types";
import { alignMidiToScore, buildPerformanceScoreOnsets, buildScoreOnsets } from "./alignment";
import type { TranscribedPerformanceNote } from "./types";

async function loadScore(fileName: string): Promise<ScoreData> {
  const bytes = readFileSync(path.join(process.cwd(), "data", "scores", fileName));
  const zip = await JSZip.loadAsync(bytes);
  const container = await zip.file("META-INF/container.xml")!.async("string");
  const rootPath = /full-path="([^"]+)"/.exec(container)?.[1];
  if (!rootPath) throw new Error(`No rootfile in ${fileName}`);
  const xml = await zip.file(rootPath)!.async("string");
  return parseMusicXml(xml, fileName);
}

function syntheticPerformance(score: ScoreData, startTick: number, endTick: number): TranscribedPerformanceNote[] {
  const range = tickBoundsToScoreRange(score, startTick, endTick);
  return buildScoreOnsets(score, range, ["left", "right"]).flatMap((onset, onsetIndex) =>
    onset.notes.map((note, noteIndex) => {
      const keyDownUs = 1_000_000
        + Math.round((onset.tick - startTick) / TICKS_PER_QUARTER * 620_000)
        + noteIndex * 9_000;
      return {
        id: `synthetic:${onsetIndex}:${noteIndex}`,
        pitch: note.midi,
        channel: 0,
        keyDownUs,
        keyUpUs: keyDownUs + Math.max(90_000, note.durationTicks / TICKS_PER_QUARTER * 500_000),
        attackVelocity: 48 + (noteIndex % 4) * 12,
      };
    }));
}

async function expectRangeAlignment(fileName: string, startMeasure: number, endMeasure: number) {
  const score = await loadScore(fileName);
  const startTick = score.measureStarts[startMeasure] ?? 0;
  const endTick = endMeasure >= score.measureStarts.length ? score.totalTicks : score.measureStarts[endMeasure];
  const range = tickBoundsToScoreRange(score, startTick, endTick);
  const notes = syntheticPerformance(score, startTick, endTick);
  const result = alignMidiToScore(score, range, ["left", "right"], notes);
  const summary = JSON.stringify({
    matched: result.matchedNotes,
    substituted: result.substitutedNotes,
    omitted: result.omittedNotes,
    extra: result.extraNotes,
    scoreCoverage: result.scoreCoverage,
    performanceCoverage: result.performanceCoverage,
  });
  expect(result.scoreCoverage, summary).toBeGreaterThan(0.98);
  expect(result.performanceCoverage).toBeGreaterThan(0.98);
  expect(result.substitutedNotes + result.omittedNotes + result.extraNotes).toBeLessThanOrEqual(2);
  expect(result.timeMap.length).toBeGreaterThan(4);
}

describe("cross-piece performance alignment", () => {
  it("unfolds the real repeat structures in the waltz and Träumerei", async () => {
    const waltz = await loadScore("chopin-waltz-a-minor.mxl");
    const traumerei = await loadScore("schumann-traumerei-op15-no7.mxl");
    expect(waltz.measurePlaybackOrder?.length).toBe(waltz.measureStarts.length + 24);
    expect(traumerei.measurePlaybackOrder?.length).toBe(traumerei.measureStarts.length + 8);

    const range = tickBoundsToScoreRange(traumerei, 0, traumerei.totalTicks);
    const unfoldedOnsets = buildPerformanceScoreOnsets(traumerei, range, ["left", "right"]);
    const repeatedOccurrences = unfoldedOnsets.filter((onset) => onset.scorePosition.playbackOccurrence === 1);
    expect(repeatedOccurrences.length).toBeGreaterThan(4);
    const performance = unfoldedOnsets.flatMap((onset, onsetIndex) => onset.notes.map((note, noteIndex) => ({
      id: `repeat:${onsetIndex}:${noteIndex}`,
      pitch: note.midi,
      channel: 0,
      keyDownUs: 1_000_000 + onsetIndex * 400_000 + noteIndex * 5_000,
      keyUpUs: 1_200_000 + onsetIndex * 400_000 + noteIndex * 5_000,
      attackVelocity: 70,
    })));
    const aligned = alignMidiToScore(traumerei, range, ["left", "right"], performance);
    expect(aligned.scoreCoverage).toBeGreaterThan(0.98);
    expect(aligned.performanceCoverage).toBeGreaterThan(0.98);
    expect(aligned.mappings.some((mapping) => mapping.scoreNote?.scoreRef.playbackOccurrence === 1)).toBe(true);
  });

  it("handles the regular waltz texture", async () => {
    await expectRangeAlignment("chopin-waltz-a-minor.mxl", 1, 9);
  });

  it("handles the ornamented Op.9 No.2 return", async () => {
    await expectRangeAlignment("chopin-nocturne-op9-no2.mxl", 21, 25);
  });

  it("handles Träumerei polyphonic sustain without collapsing voices", async () => {
    await expectRangeAlignment("schumann-traumerei-op15-no7.mxl", 0, 8);
  });
});
