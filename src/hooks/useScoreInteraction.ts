import { useCallback, useEffect, useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ScoreRange } from "../analysis/types";
import { cancelScheduledPlayback, playGroups } from "../lib/audio";
import {
  getSelectedGroups,
  getSelectedIds,
  moveSelectedGroup,
  selectBoxGroups,
  selectGroup,
  setSelectionBoundary,
  setSelectionHands,
} from "../lib/practice";
import { scoreRangeToTickBounds } from "../lib/scoreIdentity";
import type { Hand, NoteGroup, ScoreData, SelectionState } from "../types";

interface UseScoreInteractionOptions {
  score: ScoreData | null;
  selection: SelectionState;
  setSelection: Dispatch<SetStateAction<SelectionState>>;
  navigationFallbackGroup: NoteGroup | null;
  playbackBpm: number;
  keyboardEnabled: boolean;
}

export default function useScoreInteraction({
  score,
  selection,
  setSelection,
  navigationFallbackGroup,
  playbackBpm,
  keyboardEnabled,
}: UseScoreInteractionOptions) {
  const selectedIds = useMemo(() => (score ? getSelectedIds(score, selection) : []), [score, selection]);
  const selectedGroups = useMemo(() => (score ? getSelectedGroups(score, selection) : []), [score, selection]);
  const hasMultiSelection = selectedIds.length > 1;

  const previewGroup = useCallback((group: NoteGroup | undefined) => {
    if (group) void playGroups([group], "4n", playbackBpm);
  }, [playbackBpm]);

  const handleGroupSelect = useCallback((groupId: string, extend: boolean) => {
    if (!score) return;
    if (!hasMultiSelection || extend) {
      setSelection((current) => selectGroup(score, current, groupId, extend));
    }
    previewGroup(score.noteGroups.find((group) => group.id === groupId));
  }, [hasMultiSelection, previewGroup, score, setSelection]);

  const handleClearSelection = useCallback(() => {
    if (!hasMultiSelection) {
      cancelScheduledPlayback();
      setSelection({ range: null, loopIndex: 0 });
    }
  }, [hasMultiSelection, setSelection]);

  const dismissSelection = useCallback(() => {
    cancelScheduledPlayback();
    setSelection({ range: null, loopIndex: 0 });
  }, [setSelection]);

  const handleBoxSelect = useCallback((groupIds: string[]) => {
    if (!score) return;
    cancelScheduledPlayback();
    setSelection(groupIds.length > 0 ? selectBoxGroups(score, groupIds) : { range: null, loopIndex: 0 });
  }, [score, setSelection]);

  const expandSelectionToBothHands = useCallback(() => {
    if (!score) return;
    cancelScheduledPlayback();
    setSelection((current) => setSelectionHands(score, current, ["right", "left"]));
  }, [score, setSelection]);

  const shrinkSelectionToHand = useCallback((hand: Hand) => {
    if (!score) return;
    cancelScheduledPlayback();
    setSelection((current) => setSelectionHands(score, current, [hand]));
  }, [score, setSelection]);

  const resizeSelectionBoundary = useCallback((edge: "start" | "end", tick: number) => {
    if (!score) return;
    cancelScheduledPlayback();
    setSelection((current) => setSelectionBoundary(score, current, edge, tick));
  }, [score, setSelection]);

  const selectScoreRange = useCallback((range: ScoreRange) => {
    if (!score) return;
    cancelScheduledPlayback();
    const { startTick, endTick } = scoreRangeToTickBounds(score, range);
    const hands: Hand[] = [
      ...(score.hasRightHand ? ["right" as const] : []),
      ...(score.hasLeftHand ? ["left" as const] : []),
    ];
    setSelection({ range: { startTick, endTick, hands }, loopIndex: 0 });
  }, [score, setSelection]);

  const moveSelection = useCallback((direction: -1 | 1) => {
    if (!score || score.noteGroups.length === 0) return;
    const fallbackGroup = navigationFallbackGroup ?? score.noteGroups[0];
    const nextSelection = moveSelectedGroup(score, selection, direction, fallbackGroup);
    const nextSelectedIds = getSelectedIds(score, nextSelection);
    const moved = nextSelectedIds.length !== selectedIds.length
      || nextSelectedIds.some((id, index) => id !== selectedIds[index]);
    setSelection(nextSelection);
    if (moved) previewGroup(score.noteGroups.find((group) => group.id === nextSelectedIds[0]));
  }, [navigationFallbackGroup, previewGroup, score, selectedIds, selection, setSelection]);

  useEffect(() => {
    if (!keyboardEnabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT") return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveSelection(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        moveSelection(1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [keyboardEnabled, moveSelection]);

  return {
    selectedIds,
    selectedGroups,
    hasMultiSelection,
    handleGroupSelect,
    handleClearSelection,
    dismissSelection,
    handleBoxSelect,
    expandSelectionToBothHands,
    shrinkSelectionToHand,
    resizeSelectionBoundary,
    selectScoreRange,
    moveSelection,
  };
}
