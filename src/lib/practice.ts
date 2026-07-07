import type { Hand, NoteGroup, ScoreData, SelectionRange, SelectionState } from "../types";

export const HANDS: Hand[] = ["right", "left"];

export interface LoopStep {
  tick: number;
  groups: NoteGroup[];
}

export function getGroupMidis(groups: NoteGroup[]): number[] {
  return [...new Set(groups.flatMap((group) => group.notes.map((note) => note.midi)))].sort((a, b) => a - b);
}

export function handEnabled(group: NoteGroup, followLeft: boolean, followRight: boolean): boolean {
  return group.hand === "left" ? followLeft : followRight;
}

export function sortGroupsByScore(score: ScoreData, ids: string[]): NoteGroup[] {
  const idSet = new Set(ids);
  return score.noteGroups.filter((group) => idSet.has(group.id));
}

function orderHands(hands: Hand[]): Hand[] {
  const requested = new Set(hands);
  return HANDS.filter((hand) => requested.has(hand));
}

function hasGroupsInRange(score: ScoreData, range: SelectionRange, hand: Hand): boolean {
  return score.noteGroups.some(
    (group) => group.hand === hand && group.absoluteTick >= range.startTick && group.absoluteTick <= range.endTick,
  );
}

function normalizeRange(score: ScoreData, range: SelectionRange): SelectionRange | null {
  const startTick = Math.min(range.startTick, range.endTick);
  const endTick = Math.max(range.startTick, range.endTick);
  const normalizedRange = { ...range, startTick, endTick };
  const hands = orderHands(range.hands).filter((hand) => hasGroupsInRange(score, normalizedRange, hand));

  if (hands.length === 0) {
    return null;
  }

  return {
    startTick,
    endTick,
    hands,
  };
}

function selectionFromRange(score: ScoreData, range: SelectionRange, loopIndex = 0): SelectionState {
  return {
    range: normalizeRange(score, range),
    loopIndex,
  };
}

export function getSelectedGroups(score: ScoreData, selection: SelectionState): NoteGroup[] {
  const range = selection.range;
  if (!range) {
    return [];
  }

  const hands = new Set(range.hands);
  return score.noteGroups.filter(
    (group) => hands.has(group.hand) && group.absoluteTick >= range.startTick && group.absoluteTick <= range.endTick,
  );
}

export function getSelectedIds(score: ScoreData, selection: SelectionState): string[] {
  return getSelectedGroups(score, selection).map((group) => group.id);
}

export function selectGroups(score: ScoreData, groupIds: string[]): SelectionState {
  const groups = sortGroupsByScore(score, groupIds);
  if (groups.length === 0) {
    return { range: null, loopIndex: 0 };
  }

  return selectionFromRange(score, {
    startTick: Math.min(...groups.map((group) => group.absoluteTick)),
    endTick: Math.max(...groups.map((group) => group.absoluteTick)),
    hands: orderHands(groups.map((group) => group.hand)),
  });
}

export function selectGroup(
  score: ScoreData,
  current: SelectionState,
  groupId: string,
  extend: boolean,
): SelectionState {
  const target = score.noteGroups.find((group) => group.id === groupId);
  if (!target) {
    return current;
  }

  if (!extend || !current.range) {
    return selectionFromRange(score, {
      startTick: target.absoluteTick,
      endTick: target.absoluteTick,
      hands: [target.hand],
    });
  }

  return selectionFromRange(score, {
    startTick: Math.min(current.range.startTick, target.absoluteTick),
    endTick: Math.max(current.range.endTick, target.absoluteTick),
    hands: orderHands([...current.range.hands, target.hand]),
  });
}

export function selectBoxGroups(score: ScoreData, groupIds: string[]): SelectionState {
  return selectGroups(score, groupIds);
}

export function setSelectionHands(score: ScoreData, current: SelectionState, hands: Hand[]): SelectionState {
  if (!current.range) {
    return current;
  }

  return selectionFromRange(score, { ...current.range, hands });
}

export function setSelectionBoundary(
  score: ScoreData,
  current: SelectionState,
  edge: "start" | "end",
  tick: number,
): SelectionState {
  if (!current.range) {
    return current;
  }

  return selectionFromRange(score, {
    ...current.range,
    startTick: edge === "start" ? Math.min(tick, current.range.endTick) : current.range.startTick,
    endTick: edge === "end" ? Math.max(tick, current.range.startTick) : current.range.endTick,
  });
}

export function moveSelectedGroup(
  score: ScoreData,
  current: SelectionState,
  direction: -1 | 1,
  fallbackGroup: NoteGroup,
): SelectionState {
  const selected = getSelectedGroups(score, current);
  if (selected.length === 0) {
    return selectionFromRange(score, {
      startTick: fallbackGroup.absoluteTick,
      endTick: fallbackGroup.absoluteTick,
      hands: [fallbackGroup.hand],
    });
  }

  const anchor = direction > 0 ? selected[selected.length - 1] : selected[0];
  const ordered = score.noteGroups.filter((group) => group.hand === anchor.hand);
  const anchorIndex = ordered.findIndex((group) => group.id === anchor.id);
  const nextIndex = Math.max(0, Math.min(ordered.length - 1, anchorIndex + direction));
  const next = ordered[nextIndex] ?? fallbackGroup;

  return selectionFromRange(score, {
    startTick: next.absoluteTick,
    endTick: next.absoluteTick,
    hands: [next.hand],
  });
}

export function buildLoopSteps(score: ScoreData, selection: SelectionState): LoopStep[] {
  const groupsByTick = new Map<number, NoteGroup[]>();

  for (const group of getSelectedGroups(score, selection)) {
    groupsByTick.set(group.absoluteTick, [...(groupsByTick.get(group.absoluteTick) ?? []), group]);
  }

  return Array.from(groupsByTick.entries())
    .sort(([a], [b]) => a - b)
    .map(([tick, groups]) => ({ tick, groups }));
}
