import { ListTree, Music2, Pause, Play, Repeat2 } from "lucide-react";
import type {
  AnalysisTab,
  AnalysisViewItem,
  ScoreAnalysis,
  ScoreAnalysisMetadata,
} from "../../analysis/types";
import { formatScoreRange } from "../../lib/analysis/coordinates";

interface AnalysisNavigatorProps {
  analysis: ScoreAnalysis | null;
  tab: AnalysisTab;
  items: AnalysisViewItem[];
  selectedId: string | null;
  metadata: ScoreAnalysisMetadata | null;
  playingItemId: string | null;
  onTabChange: (tab: AnalysisTab) => void;
  onSelect: (id: string, rangeIndex?: number) => void;
  onTogglePlay: (id: string) => void;
}

interface TabDefinition {
  id: AnalysisTab;
  label: string;
  icon: typeof ListTree;
}

const TABS: TabDefinition[] = [
  { id: "structure", label: "结构", icon: ListTree },
  { id: "motif", label: "动机", icon: Repeat2 },
  { id: "left-hand", label: "左手", icon: Music2 },
];

function itemBadge(item: AnalysisViewItem): string {
  if (item.kind === "motif") {
    return `${item.entity.occurrences.length} 次`;
  }
  if (item.kind === "chord") {
    return `${item.entity.occurrenceCount} 次`;
  }
  if (item.kind === "texture") {
    return `${item.entity.occurrences.length} 次`;
  }
  return "";
}

function itemPreview(item: AnalysisViewItem): string {
  if (item.kind === "section") {
    return item.entity.tonality;
  }
  if (item.kind === "motif") {
    return item.entity.recognitionBasis.slice(0, 2).join(" · ");
  }
  if (item.kind === "chord") {
    return item.entity.pitchClasses.join(" · ");
  }
  if (item.kind === "texture") {
    return item.entity.recognitionBasis.slice(0, 2).join(" · ");
  }
  return "";
}

export default function AnalysisNavigator({
  analysis,
  tab,
  items,
  selectedId,
  metadata,
  playingItemId,
  onTabChange,
  onSelect,
  onTogglePlay,
}: AnalysisNavigatorProps) {
  return (
    <nav className="analysis-navigator" aria-label="分析分类">
      <div className="analysis-tabs" role="tablist" aria-label="分析分类">
        {TABS.map((definition) => {
          const Icon = definition.icon;
          return (
            <button
              type="button"
              key={definition.id}
              className={tab === definition.id ? "active" : ""}
              onClick={() => onTabChange(definition.id)}
              role="tab"
              aria-selected={tab === definition.id}
              title={definition.label}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{definition.label}</span>
            </button>
          );
        })}
      </div>

      <div className="analysis-item-list">
        {!analysis ? <div className="analysis-empty-copy">暂无分析结果</div> : null}
        {analysis && tab === "structure" ? (
          <div className="analysis-form-context">
            <strong>{analysis.form.label}</strong>
            <span>{analysis.form.summary}</span>
          </div>
        ) : null}
        {items.map((item) => {
          const badge = itemBadge(item);
          const preview = itemPreview(item);
          const rangeLabel = metadata && item.ranges[0] ? formatScoreRange(metadata, item.ranges[0]) : "";
          const canPlay = item.kind === "section" || item.kind === "chord" || item.kind === "texture";
          const isPlaying = playingItemId === item.id;
          return (
            <div
              key={item.id}
              className={`analysis-list-item ${selectedId === item.id ? "active" : ""} ${canPlay ? "has-play" : ""}`}
              data-analysis-id={item.id}
              aria-current={selectedId === item.id ? "true" : undefined}
            >
              <button
                type="button"
                className="analysis-list-item-select"
                onClick={() => onSelect(item.id)}
              >
                <span className="analysis-list-item-topline">
                  <strong>{item.label}</strong>
                  {badge ? <span className="analysis-list-badge">{badge}</span> : null}
                </span>
                {rangeLabel ? <span className="analysis-list-range">{rangeLabel}</span> : null}
                {preview ? <span className="analysis-list-summary">{preview}</span> : null}
              </button>
              {canPlay ? (
                <button
                  type="button"
                  className={`analysis-list-play ${isPlaying ? "playing" : ""}`}
                  onClick={() => onTogglePlay(item.id)}
                  aria-label={`${isPlaying ? "停止" : "播放"}${item.label}`}
                  title={item.kind === "section" ? "播放段落" : "仅播放左手"}
                >
                  {isPlaying ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
