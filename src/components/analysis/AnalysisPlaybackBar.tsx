import { Pause, Play } from "lucide-react";

interface AnalysisPlaybackBarProps {
  rangeLabel: string;
  canUseRange: boolean;
  isPlaying: boolean;
  onTogglePlay: () => void;
}

export default function AnalysisPlaybackBar({
  rangeLabel,
  canUseRange,
  isPlaying,
  onTogglePlay,
}: AnalysisPlaybackBarProps) {
  return (
    <div className="analysis-playback-bar" aria-label="分析范围操作">
      <div className="analysis-playback-range">
        <span>当前范围</span>
        <strong>{rangeLabel || "未选择"}</strong>
      </div>
      <div className="analysis-playback-actions">
        <button type="button" className="analysis-icon-command" onClick={onTogglePlay} disabled={!canUseRange}>
          {isPlaying ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
          <span>{isPlaying ? "停止" : "播放"}</span>
        </button>
      </div>
    </div>
  );
}
