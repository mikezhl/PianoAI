import { describe, expect, it } from "vitest";
import type { Hand, NoteGroup, ParsedNote, ScoreData } from "../types";
import {
  buildLoopSteps,
  getSelectedIds,
  selectBoxGroups,
  selectGroup,
  setSelectionBoundary,
  setSelectionHands,
} from "./practice";

function note(id: string, midi: number, hand: Hand, tick: number): ParsedNote {
  return {
    id,
    midi,
    name: `${midi}`,
    hand,
    staff: hand === "left" ? 2 : 1,
    measureIndex: 0,
    startTick: tick,
    absoluteTick: tick,
    durationTicks: 480,
    playbackEvents: [{ midis: [midi], offsetTicks: 0, durationTicks: 480 }],
  };
}

function group(id: string, hand: Hand, tick: number, midi: number): NoteGroup {
  const parsedNote = note(`n-${id}`, midi, hand, tick);
  return {
    id,
    hand,
    measureIndex: 0,
    startTick: tick,
    absoluteTick: tick,
    durationTicks: 480,
    notes: [parsedNote],
    playbackEvents: [...parsedNote.playbackEvents],
  };
}

const score: ScoreData = {
  title: "selection fixture",
  xml: "",
  noteGroups: [
    group("r0", "right", 0, 60),
    group("l0", "left", 0, 48),
    group("r1", "right", 480, 62),
    group("l1", "left", 480, 50),
    group("r2", "right", 960, 64),
  ],
  measureStarts: [0],
  measureDurations: [1920],
  totalTicks: 1920,
  canSeparateHands: true,
  hasLeftHand: true,
  hasRightHand: true,
};

describe("practice selection", () => {
  it("selects a single group as a one-tick, one-hand range", () => {
    const selection = selectGroup(score, { range: null, loopIndex: 0 }, "r1", false);

    expect(selection.range).toEqual({ startTick: 480, endTick: 480, hands: ["right"] });
    expect(getSelectedIds(score, selection)).toEqual(["r1"]);
  });

  it("expands an existing range to both hands without changing its time boundaries", () => {
    const rightRange = selectBoxGroups(score, ["r0", "r1"]);
    const bothHands = setSelectionHands(score, rightRange, ["right", "left"]);

    expect(bothHands.range).toEqual({ startTick: 0, endTick: 480, hands: ["right", "left"] });
    expect(getSelectedIds(score, bothHands)).toEqual(["r0", "l0", "r1", "l1"]);
  });

  it("resizes the selected time range while preserving valid hands", () => {
    const bothHands = setSelectionHands(score, selectBoxGroups(score, ["r0", "r2"]), ["right", "left"]);
    const trimmedStart = setSelectionBoundary(score, bothHands, "start", 480);
    const collapsedEnd = setSelectionBoundary(score, trimmedStart, "end", 0);

    expect(trimmedStart.range).toEqual({ startTick: 480, endTick: 960, hands: ["right", "left"] });
    expect(getSelectedIds(score, trimmedStart)).toEqual(["r1", "l1", "r2"]);
    expect(collapsedEnd.range).toEqual({ startTick: 480, endTick: 480, hands: ["right", "left"] });
    expect(getSelectedIds(score, collapsedEnd)).toEqual(["r1", "l1"]);
  });

  it("builds one loop step per tick and combines both hands at the same tick", () => {
    const selection = setSelectionHands(score, selectBoxGroups(score, ["r0", "r1"]), ["right", "left"]);
    const steps = buildLoopSteps(score, selection);

    expect(steps.map((step) => step.tick)).toEqual([0, 480]);
    expect(steps.map((step) => step.groups.map((group) => group.id))).toEqual([
      ["r0", "l0"],
      ["r1", "l1"],
    ]);
  });

  it("returns an empty selection for an empty box selection", () => {
    expect(selectBoxGroups(score, [])).toEqual({ range: null, loopIndex: 0 });
  });
});
