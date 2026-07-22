import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ScoreRange } from "../../src/analysis/types";
import { scoreNoteRefId } from "../../src/lib/scoreIdentity";
import { buildPerformanceScoreOnsets } from "../../src/performance/alignment";
import { TICKS_PER_QUARTER } from "../../src/types";
import { loadCanonicalScore } from "./canonical-score";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function main(): Promise<void> {
  const score = await loadCanonicalScore(argument("--score"));
  const range: ScoreRange = {
    start: {
      measureIndex: 0,
      offsetQuarter: { numerator: 0, denominator: 1 },
    },
    end: {
      measureIndex: score.measureStarts.length,
      offsetQuarter: { numerator: 0, denominator: 1 },
    },
  };
  const onsets = buildPerformanceScoreOnsets(score, range, ["left", "right"]);
  const eventByKey = new Map<string, {
    startTick: number;
    durationTicks: number;
    pitch: number;
    scoreNoteIds: string[];
  }>();

  for (const onset of onsets) {
    for (const note of onset.notes) {
      const playbackEvents = note.playbackEvents.length > 0
        ? note.playbackEvents
        : [{ offsetTicks: 0, durationTicks: note.durationTicks, midis: [note.midi] }];
      for (const playbackEvent of playbackEvents) {
        for (const pitch of playbackEvent.midis) {
          const startTick = onset.tick + playbackEvent.offsetTicks;
          const durationTicks = Math.max(1, playbackEvent.durationTicks);
          const key = `${startTick}:${durationTicks}:${pitch}`;
          const existing = eventByKey.get(key);
          if (existing) {
            existing.scoreNoteIds.push(scoreNoteRefId(note.scoreRef));
          } else {
            eventByKey.set(key, {
              startTick,
              durationTicks,
              pitch,
              scoreNoteIds: [scoreNoteRefId(note.scoreRef)],
            });
          }
        }
      }
    }
  }

  const events = [...eventByKey.values()].sort((left, right) =>
    left.startTick - right.startTick
    || left.pitch - right.pitch
    || left.durationTicks - right.durationTicks);
  const totalTicks = Math.max(
    ...events.map((event) => event.startTick + event.durationTicks),
    onsets.at(-1)?.tick ?? score.totalTicks,
  );
  const payload = {
    schemaVersion: "1.0.0",
    ticksPerQuarter: TICKS_PER_QUARTER,
    totalTicks,
    onsets: onsets.map((onset) => ({
      tick: onset.tick,
      scorePosition: onset.scorePosition,
      pitches: onset.notes.map((note) => note.midi),
      scoreNoteIds: onset.notes.map((note) => scoreNoteRefId(note.scoreRef)),
    })),
    events,
  };
  const output = argument("--output");
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    output,
    onsets: payload.onsets.length,
    events: payload.events.length,
    totalTicks,
  }, null, 2));
}

void main();

