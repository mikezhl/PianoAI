import type { AnalysisViewItem } from "../../analysis/types";
import type { NoteGroup, ScoreData } from "../../types";

export function analysisPlaybackGroups(
  score: ScoreData,
  startTick: number,
  endTick: number,
  itemKind: AnalysisViewItem["kind"],
): NoteGroup[] {
  const leftHandOnly = itemKind === "chord" || itemKind === "texture";
  return score.noteGroups.filter((group) => (
    group.absoluteTick < endTick
    && group.absoluteTick + group.durationTicks > startTick
    && (!leftHandOnly || group.hand === "left")
  ));
}
