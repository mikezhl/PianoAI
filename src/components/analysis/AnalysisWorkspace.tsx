import { useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisTab, AnalysisViewItem, ScoreAnalysis } from "../../analysis/types";
import { buildAnalysisItems } from "../../analysis/viewModel";
import { cancelScheduledPlayback, playScoreRange } from "../../lib/audio";
import { formatScoreRange, scoreRangeToTickBounds } from "../../lib/analysis/coordinates";
import { analysisPlaybackGroups } from "../../lib/analysis/playback";
import { ticksToMilliseconds } from "../../lib/playbackTiming";
import type { ScoreData } from "../../types";
import AnalysisDetailPanel from "./AnalysisDetailPanel";
import AnalysisNavigator from "./AnalysisNavigator";
import AnalysisPlaybackBar from "./AnalysisPlaybackBar";
import AnalysisScoreViewer from "./AnalysisScoreViewer";

export type AnalysisLoadState = "idle" | "loading" | "ready" | "missing" | "error";

interface AnalysisWorkspaceProps {
  score: ScoreData | null;
  analysis: ScoreAnalysis | null;
  loadState: AnalysisLoadState;
  loadError: string | null;
  scoreZoom: number;
  playbackBpm: number;
}

export default function AnalysisWorkspace({
  score,
  analysis,
  loadState,
  loadError,
  scoreZoom,
  playbackBpm,
}: AnalysisWorkspaceProps) {
  const playbackFrameRef = useRef<number | null>(null);
  const playbackSessionRef = useRef(0);
  const [tab, setTab] = useState<AnalysisTab>("structure");
  const [selectedId, setSelectedId] = useState<string | null>(analysis?.sections[0]?.id ?? null);
  const [selectedRangeIndex, setSelectedRangeIndex] = useState(0);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingItemId, setPlayingItemId] = useState<string | null>(null);
  const [playbackTick, setPlaybackTick] = useState<number | null>(null);
  const items = useMemo(() => analysis ? buildAnalysisItems(analysis, tab) : [], [analysis, tab]);
  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) ?? items[0] ?? null,
    [items, selectedId],
  );
  const selectedRange = selectedItem?.ranges[selectedRangeIndex] ?? selectedItem?.ranges[0] ?? null;
  const overlayItems = useMemo<AnalysisViewItem[]>(() => {
    if (!analysis) {
      return [];
    }
    if (tab === "structure" || tab === "left-hand") {
      return items;
    }
    return selectedItem ? [selectedItem] : [];
  }, [analysis, items, selectedItem, tab]);
  const baseRangeLabel = analysis && selectedRange ? formatScoreRange(analysis.score, selectedRange) : "";
  const rangeLabel = selectedItem?.kind === "chord"
    ? `${baseRangeLabel} · 第 ${(selectedItem.entity.occurrences[selectedRangeIndex]?.beatIndex ?? 0) + 1} 组`
    : selectedItem?.kind === "texture"
      ? `${baseRangeLabel} · ${selectedItem.entity.occurrences[selectedRangeIndex]?.label ?? selectedItem.label}`
      : baseRangeLabel;

  function stopPlayback() {
    playbackSessionRef.current += 1;
    cancelScheduledPlayback();
    if (playbackFrameRef.current != null) {
      cancelAnimationFrame(playbackFrameRef.current);
      playbackFrameRef.current = null;
    }
    setIsPlaying(false);
    setPlayingItemId(null);
    setPlaybackTick(null);
  }

  useEffect(() => {
    setTab("structure");
    setSelectedId(analysis?.sections[0]?.id ?? null);
    setSelectedRangeIndex(0);
    setMobileDetailOpen(false);
    stopPlayback();
  }, [score, analysis?.score.id]);

  useEffect(() => () => stopPlayback(), []);

  function handleTabChange(nextTab: AnalysisTab) {
    const nextItems = analysis ? buildAnalysisItems(analysis, nextTab) : [];
    setTab(nextTab);
    setSelectedId(nextItems[0]?.id ?? null);
    setSelectedRangeIndex(0);
    stopPlayback();
  }

  function handleSelect(id: string, rangeIndex = 0) {
    setSelectedId(id);
    setSelectedRangeIndex(rangeIndex);
    stopPlayback();
  }

  function startPlayback(item: AnalysisViewItem, rangeIndex: number) {
    if (!score) {
      return;
    }
    const range = item.ranges[rangeIndex] ?? item.ranges[0];
    if (!range) {
      return;
    }

    const { startTick, endTick } = scoreRangeToTickBounds(score, range);
    const groups = analysisPlaybackGroups(score, startTick, endTick, item.kind);
    if (groups.length === 0) {
      return;
    }

    stopPlayback();
    const session = playbackSessionRef.current + 1;
    playbackSessionRef.current = session;
    const durationTicks = Math.max(1, endTick - startTick);
    const durationMs = ticksToMilliseconds(durationTicks, playbackBpm);
    setIsPlaying(true);
    setPlayingItemId(item.id);
    setPlaybackTick(startTick);

    void playScoreRange(groups, playbackBpm, startTick, endTick).then((started) => {
      if (!started || playbackSessionRef.current !== session) {
        if (playbackSessionRef.current === session) {
          setIsPlaying(false);
          setPlayingItemId(null);
          setPlaybackTick(null);
        }
        return;
      }

      const startedAt = performance.now();
      const advance = (now: number) => {
        if (playbackSessionRef.current !== session) {
          return;
        }
        const progress = Math.min(1, Math.max(0, (now - startedAt) / durationMs));
        setPlaybackTick(startTick + durationTicks * progress);
        if (progress >= 1) {
          playbackFrameRef.current = null;
          setIsPlaying(false);
          setPlayingItemId(null);
          setPlaybackTick(null);
          return;
        }
        playbackFrameRef.current = requestAnimationFrame(advance);
      };
      playbackFrameRef.current = requestAnimationFrame(advance);
    });
  }

  function handleTogglePlay() {
    if (!selectedItem) {
      return;
    }
    if (isPlaying) {
      stopPlayback();
      return;
    }
    startPlayback(selectedItem, selectedRangeIndex);
  }

  function handleToggleItemPlay(id: string) {
    const item = items.find((candidate) => candidate.id === id);
    if (!item) {
      return;
    }
    if (isPlaying && playingItemId === id) {
      stopPlayback();
      return;
    }
    const rangeIndex = selectedItem?.id === id ? selectedRangeIndex : 0;
    setSelectedId(id);
    setSelectedRangeIndex(rangeIndex);
    startPlayback(item, rangeIndex);
  }

  const statusMessage = loadState === "loading"
    ? "正在加载分析结果"
    : loadState === "missing" && score
      ? "此曲暂无分析结果"
      : loadState === "error"
        ? loadError ?? "分析结果加载失败"
        : null;

  return (
    <section className="analysis-workspace" aria-label="乐谱分析模式">
      <AnalysisNavigator
        analysis={analysis}
        tab={tab}
        items={items}
        selectedId={selectedItem?.id ?? null}
        metadata={analysis?.score ?? null}
        playingItemId={playingItemId}
        onTabChange={handleTabChange}
        onSelect={handleSelect}
        onTogglePlay={handleToggleItemPlay}
      />

      <div className="analysis-score-column">
        {statusMessage ? <div className={`analysis-status-banner ${loadState}`}>{statusMessage}</div> : null}
        <AnalysisScoreViewer
          score={score}
          scoreZoom={scoreZoom}
          overlayItems={overlayItems}
          selectedId={selectedItem?.id ?? null}
          selectedRangeIndex={selectedRangeIndex}
          playbackTick={playbackTick}
          onSelect={handleSelect}
        />
      </div>

      <AnalysisDetailPanel
        analysis={analysis}
        item={selectedItem}
        rangeIndex={selectedRangeIndex}
        metadata={analysis?.score ?? null}
        mobileOpen={mobileDetailOpen}
        onToggleMobile={() => setMobileDetailOpen((current) => !current)}
        onSelectRange={(rangeIndex) => {
          setSelectedRangeIndex(rangeIndex);
          stopPlayback();
        }}
      />

      <AnalysisPlaybackBar
        rangeLabel={rangeLabel}
        canUseRange={score != null && selectedRange != null}
        isPlaying={isPlaying}
        onTogglePlay={handleTogglePlay}
      />
    </section>
  );
}
