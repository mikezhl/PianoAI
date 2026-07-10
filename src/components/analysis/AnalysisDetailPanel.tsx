import { ChevronDown, ChevronUp } from "lucide-react";
import type { ReactNode } from "react";
import type {
  AnalysisViewItem,
  ScoreAnalysis,
  ScoreAnalysisMetadata,
} from "../../analysis/types";
import { formatScoreRange } from "../../lib/analysis/coordinates";

interface AnalysisDetailPanelProps {
  analysis: ScoreAnalysis | null;
  item: AnalysisViewItem | null;
  rangeIndex: number;
  metadata: ScoreAnalysisMetadata | null;
  mobileOpen: boolean;
  onToggleMobile: () => void;
  onSelectRange: (rangeIndex: number) => void;
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="analysis-detail-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function TextList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return null;
  }
  return <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>;
}

function RangeButtons({
  ranges,
  labels,
  selectedIndex,
  metadata,
  onSelect,
}: {
  ranges: AnalysisViewItem["ranges"];
  labels?: string[];
  selectedIndex: number;
  metadata: ScoreAnalysisMetadata;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="analysis-range-buttons">
      {ranges.map((range, index) => (
        <button
          type="button"
          key={`${range.start.measureIndex}-${range.end.measureIndex}-${index}`}
          data-range-index={index}
          className={selectedIndex === index ? "active" : ""}
          onClick={() => onSelect(index)}
        >
          <strong>{labels?.[index] ?? `位置 ${index + 1}`}</strong>
          <span>{formatScoreRange(metadata, range)}</span>
        </button>
      ))}
    </div>
  );
}

function confidenceLabel(item: AnalysisViewItem): string | null {
  if (item.kind === "section") {
    return item.entity.confidence === "high" ? "高置信度" : item.entity.confidence === "medium" ? "中置信度" : "低置信度";
  }
  if (item.kind === "motif") {
    const confidences = new Set(item.entity.occurrences.map((occurrence) => occurrence.confidence));
    return confidences.size === 1 && confidences.has("high") ? "高置信度" : "含需辨析位置";
  }
  if (item.kind === "chord") {
    return "左手音高识别";
  }
  if (item.kind === "texture") {
    return "左手织体分析";
  }
  return null;
}

function chordRelationLabel(relation: string): string {
  if (relation === "representative") {
    return "该家族的代表排列。";
  }
  if (relation === "exact-voicing") {
    return "与代表位置的实际音高和音域完全相同。";
  }
  if (relation === "inversion") {
    return "音高集合相同，但低音改变，形成不同转位或低音配置。";
  }
  return "音高集合和低音相同，但音域或声部排列不同。";
}

function textureRelationLabel(relation: string): string {
  if (relation === "representative") {
    return "该织体家族的代表位置。";
  }
  if (relation === "exact") {
    return "与代表位置的左手音符、节奏和声部走向相同。";
  }
  if (relation === "near-exact") {
    return "保留主要音型与声部走向，仅有局部音符或出口变化。";
  }
  return "承担相同织体作用，但音高、音程或延续方式发生变化。";
}

export default function AnalysisDetailPanel({
  analysis,
  item,
  rangeIndex,
  metadata,
  mobileOpen,
  onToggleMobile,
  onSelectRange,
}: AnalysisDetailPanelProps) {
  const range = item?.ranges[rangeIndex] ?? item?.ranges[0] ?? null;
  const rangeLabel = metadata && range ? formatScoreRange(metadata, range) : "";
  const confidence = item ? confidenceLabel(item) : null;
  const chordOccurrence = item?.kind === "chord"
    ? item.entity.occurrences[rangeIndex] ?? item.entity.occurrences[0]
    : null;
  const textureOccurrence = item?.kind === "texture"
    ? item.entity.occurrences[rangeIndex] ?? item.entity.occurrences[0]
    : null;

  return (
    <aside className={`analysis-detail ${mobileOpen ? "mobile-open" : ""}`} aria-label="分析详情">
      <button type="button" className="analysis-detail-mobile-toggle" onClick={onToggleMobile}>
        <span>{item?.label ?? "分析详情"}</span>
        {mobileOpen ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronUp size={18} aria-hidden="true" />}
      </button>

      <div className="analysis-detail-scroll">
        {!analysis ? <div className="analysis-empty-copy">当前曲目暂无分析结果</div> : null}
        {analysis && item ? (
          <>
            <header className="analysis-detail-header">
              <div className="analysis-detail-meta">
                {rangeLabel ? <span>{rangeLabel}</span> : null}
                {confidence ? <span>{confidence}</span> : null}
              </div>
              <h2>{item.label}</h2>
              <p>{item.summary}</p>
            </header>

            {item.kind === "section" ? (
              <>
                <DetailSection title="段落作用">
                  <div className="analysis-key-value"><span>区域</span><strong>{item.entity.tonality}</strong></div>
                  <p>{item.entity.understanding}</p>
                </DetailSection>
                {item.entity.details?.length ? <DetailSection title="谱面依据"><TextList items={item.entity.details} /></DetailSection> : null}
              </>
            ) : null}

            {item.kind === "motif" && metadata ? (
              <>
                <DetailSection title="识别依据">
                  <TextList items={item.entity.recognitionBasis} />
                </DetailSection>
                <DetailSection title="出现与变奏">
                  <RangeButtons
                    ranges={item.ranges}
                    labels={item.entity.occurrences.map((occurrence) => occurrence.label)}
                    selectedIndex={rangeIndex}
                    metadata={metadata}
                    onSelect={onSelectRange}
                  />
                  {item.entity.occurrences[rangeIndex] ? (
                    <div className="analysis-occurrence-detail">
                      <p>{item.entity.occurrences[rangeIndex].summary}</p>
                      <TextList items={item.entity.occurrences[rangeIndex].differences} />
                    </div>
                  ) : null}
                </DetailSection>
                <DetailSection title="理解">
                  <p>{item.entity.understanding}</p>
                </DetailSection>
              </>
            ) : null}

            {item.kind === "chord" && metadata && chordOccurrence ? (
              <>
                <DetailSection title="当前左手和弦">
                  <div className="analysis-chord-name">{chordOccurrence.name}</div>
                  <div className="analysis-chord-grid">
                    <div><span>和弦标记</span><strong>{chordOccurrence.symbol}</strong></div>
                    <div><span>低音</span><strong>{chordOccurrence.bass}</strong></div>
                    <div><span>构成音</span><strong>{chordOccurrence.pitchClasses.join(" · ")}</strong></div>
                    <div><span>实际音高</span><strong>{chordOccurrence.noteNames.join(" · ")}</strong></div>
                  </div>
                  {chordOccurrence.alternatives.length > 0 ? (
                    <p className="analysis-muted-copy">其他音高集合候选：{chordOccurrence.alternatives.join("、")}</p>
                  ) : null}
                </DetailSection>
                <DetailSection title="重复与变化">
                  <div className="analysis-stat-grid">
                    <div><strong>{item.entity.occurrenceCount}</strong><span>全曲出现</span></div>
                    <div><strong>{item.entity.voicingVariantCount}</strong><span>实际排列</span></div>
                    <div><strong>{item.entity.bassVariants.length}</strong><span>低音配置</span></div>
                  </div>
                  <p>{chordRelationLabel(chordOccurrence.relation)}</p>
                  <div className="analysis-chip-row">
                    {item.entity.bassVariants.map((variant) => (
                      <span key={variant.bass}>{variant.bass} 低音 × {variant.count}</span>
                    ))}
                  </div>
                </DetailSection>
                <DetailSection title="出现位置">
                  <RangeButtons
                    ranges={item.ranges}
                    labels={item.entity.occurrences.map((occurrence) => (
                      `第 ${occurrence.beatIndex + 1} 组 · ${occurrence.symbol}`
                    ))}
                    selectedIndex={rangeIndex}
                    metadata={metadata}
                    onSelect={onSelectRange}
                  />
                </DetailSection>
              </>
            ) : null}

            {item.kind === "texture" && metadata && textureOccurrence ? (
              <>
                <DetailSection title="当前左手织体">
                  <div className="analysis-chord-name">{textureOccurrence.label}</div>
                  <p>{textureOccurrence.summary}</p>
                  {textureOccurrence.noteNames.length > 0 ? (
                    <div className="analysis-key-value">
                      <span>关键音高</span>
                      <strong>{textureOccurrence.noteNames.join(" · ")}</strong>
                    </div>
                  ) : null}
                  <p>{textureRelationLabel(textureOccurrence.relation)}</p>
                  <TextList items={textureOccurrence.differences} />
                </DetailSection>
                <DetailSection title="识别依据">
                  <TextList items={item.entity.recognitionBasis} />
                </DetailSection>
                <DetailSection title="理解与练习">
                  <p>{item.entity.understanding}</p>
                </DetailSection>
                <DetailSection title="出现位置">
                  <RangeButtons
                    ranges={item.ranges}
                    labels={item.entity.occurrences.map((occurrence) => occurrence.label)}
                    selectedIndex={rangeIndex}
                    metadata={metadata}
                    onSelect={onSelectRange}
                  />
                </DetailSection>
              </>
            ) : null}

          </>
        ) : null}
      </div>
    </aside>
  );
}
