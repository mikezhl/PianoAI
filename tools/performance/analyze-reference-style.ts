import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ScoreAnalysis, ScoreRange } from "../../src/analysis/types";
import { buildReferencePerformanceSummary } from "../../src/performance/referenceAnalysis";
import {
  buildTempoProfile,
  interpretationPositionTick,
} from "../../src/performance/interpretation";
import type {
  PerformedNoteExpression,
  ReferenceInterpretation,
  ReferenceInterpretationCatalog,
  ScoreInterpretation,
} from "../../src/performance/types";
import type { ScoreData } from "../../src/types";
import { loadCanonicalScore } from "./canonical-score";
import {
  analysisPath,
  cacheDirectory,
  interpretationPath,
  performanceCatalogPath,
  scoreCatalogPath,
  scorePath,
} from "../project-paths";

const FEATURE_KEYS = [
  "tempoMedianBpm",
  "rubatoSpan",
  "tempoVolatility",
  "cadentialTempoRatio",
  "durationRatioMedian",
  "upperStaffBalance",
  "pedalDownRatio",
  "pedalChangesPerMinute",
  "handLagMs",
  "handAsynchronyMs",
  "dynamicIqr",
  "repeatTempoChangePct",
] as const;

type FeatureKey = typeof FEATURE_KEYS[number];
type FeatureValues = Partial<Record<FeatureKey, number>>;

interface PerformanceFeatures {
  interpretationId: string;
  scoreId: string;
  performerId: string;
  performerName: string;
  status: ScoreInterpretation["generation"]["status"];
  scoreCoverage: number;
  performanceCoverage: number;
  reliabilityWeight: number;
  values: FeatureValues;
  zScores: FeatureValues;
}

interface LoadedScore {
  score: ScoreData;
  analysis: ScoreAnalysis;
}

const catalog = JSON.parse(readFileSync(
  performanceCatalogPath,
  "utf8",
)) as ReferenceInterpretationCatalog;
const manifest = JSON.parse(readFileSync(
  scoreCatalogPath,
  "utf8",
)) as {
  items: Array<{ scoreId: string }>;
};

const FEATURE_LABELS: Record<FeatureKey, string> = {
  tempoMedianBpm: "中位四分音符 BPM",
  rubatoSpan: "速度伸缩 P90–P10",
  tempoVolatility: "相邻小节速度波动",
  cadentialTempoRatio: "段尾速度比",
  durationRatioMedian: "奏音时值比",
  upperStaffBalance: "右手力度优势",
  pedalDownRatio: "踏板覆盖率",
  pedalChangesPerMinute: "每分钟踏板变化",
  handLagMs: "右手相对左手时差",
  handAsynchronyMs: "双手错位绝对值",
  dynamicIqr: "归一化力度四分位距",
  repeatTempoChangePct: "反复段速度变化",
};

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2
    : ordered[middle];
}

function percentile(values: number[], quantile: number): number | undefined {
  if (values.length === 0) return undefined;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.round((ordered.length - 1) * quantile)));
  return ordered[index];
}

function mean(values: number[]): number | undefined {
  return values.length === 0 ? undefined : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  const average = mean(values) ?? 0;
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)) ?? 0);
}

function performedExpressions(reference: ReferenceInterpretation): PerformedNoteExpression[] {
  return reference.noteExpressions.filter((expression): expression is PerformedNoteExpression =>
    expression.kind === "performed" && expression.confidence >= 0.75);
}

function handTimingFeatures(score: ScoreData, reference: ReferenceInterpretation): Pick<
  FeatureValues,
  "handLagMs" | "handAsynchronyMs"
> {
  if (reference.generation.dimensions["note-onset"] == null) return {};
  const byTick = new Map<number, { upper: number[]; lower: number[] }>();
  for (const expression of performedExpressions(reference)) {
    const tick = interpretationPositionTick(score, reference, expression.scoreNoteRef);
    const group = byTick.get(tick) ?? { upper: [], lower: [] };
    if (expression.scoreNoteRef.staff === 1) group.upper.push(expression.onsetUs);
    if (expression.scoreNoteRef.staff === 2) group.lower.push(expression.onsetUs);
    byTick.set(tick, group);
  }
  const offsets = [...byTick.values()].flatMap((group) => {
    const upper = median(group.upper);
    const lower = median(group.lower);
    return upper == null || lower == null ? [] : [(upper - lower) / 1_000];
  });
  const lag = median(offsets);
  const absolute = median(offsets.map(Math.abs));
  return {
    ...(lag == null ? {} : { handLagMs: lag }),
    ...(absolute == null ? {} : { handAsynchronyMs: absolute }),
  };
}

function cadenceRatio(
  score: ScoreData,
  reference: ReferenceInterpretation,
  analysis: ScoreAnalysis,
  tempo: ReturnType<typeof buildTempoProfile>,
): number | undefined {
  const ratios: number[] = [];
  for (const section of analysis.sections) {
    const samples = tempo.filter((sample) =>
      sample.quarterBpm != null
      && sample.scorePosition.measureIndex >= section.range.start.measureIndex
      && sample.scorePosition.measureIndex < section.range.end.measureIndex);
    const byOccurrence = new Map<number, typeof samples>();
    for (const sample of samples) {
      const occurrence = sample.scorePosition.playbackOccurrence ?? 0;
      const group = byOccurrence.get(occurrence) ?? [];
      group.push(sample);
      byOccurrence.set(occurrence, group);
    }
    for (const group of byOccurrence.values()) {
      if (group.length < 2) continue;
      const sectionMedian = median(group.flatMap((sample) => sample.quarterBpm == null ? [] : [sample.quarterBpm]));
      const last = [...group].sort((left, right) =>
        interpretationPositionTick(score, reference, left.scorePosition)
        - interpretationPositionTick(score, reference, right.scorePosition)).at(-1);
      if (sectionMedian && last?.quarterBpm) ratios.push(last.quarterBpm / sectionMedian);
    }
  }
  return median(ratios);
}

function repeatTempoChange(tempo: ReturnType<typeof buildTempoProfile>): number | undefined {
  const byMeasure = new Map<number, Map<number, number>>();
  for (const sample of tempo) {
    if (sample.quarterBpm == null || sample.scorePosition.playbackOccurrence == null) continue;
    const occurrences = byMeasure.get(sample.scorePosition.measureIndex) ?? new Map<number, number>();
    occurrences.set(sample.scorePosition.playbackOccurrence, sample.quarterBpm);
    byMeasure.set(sample.scorePosition.measureIndex, occurrences);
  }
  const logRatios = [...byMeasure.values()].flatMap((occurrences) => {
    const first = occurrences.get(0);
    const second = occurrences.get(1);
    return first && second ? [Math.log(second / first) * 100] : [];
  });
  return logRatios.length >= 3 ? median(logRatios) : undefined;
}

function dynamicIqr(reference: ReferenceInterpretation): number | undefined {
  if (reference.generation.dimensions.dynamics == null) return undefined;
  const values = reference.noteExpressions.flatMap((expression) => expression.kind === "performed"
    ? [expression.intensity]
    : expression.realizations.map((realization) => realization.intensity));
  const lower = percentile(values, 0.25);
  const upper = percentile(values, 0.75);
  return lower == null || upper == null ? undefined : upper - lower;
}

function extractFeatures(
  loaded: LoadedScore,
  reference: ReferenceInterpretation,
): FeatureValues {
  const { score, analysis } = loaded;
  const fullRange: ScoreRange = {
    start: { measureIndex: 0, offsetQuarter: { numerator: 0, denominator: 1 } },
    end: { measureIndex: score.measureDurations.length, offsetQuarter: { numerator: 0, denominator: 1 } },
  };
  const tempo = buildTempoProfile(score, reference.timeMap, analysis);
  const quarterBpms = tempo.flatMap((sample) => sample.quarterBpm == null ? [] : [sample.quarterBpm]);
  const normalized = tempo.flatMap((sample) =>
    sample.normalizedTempoRatio == null ? [] : [sample.normalizedTempoRatio]);
  const p10 = percentile(normalized, 0.1);
  const p90 = percentile(normalized, 0.9);
  const volatility = median(normalized.slice(1).map((value, index) => Math.abs(value - normalized[index])));
  const summary = buildReferencePerformanceSummary(score, fullRange, reference);
  const firstTime = reference.timeMap[0]?.timeUs ?? 0;
  const lastTime = reference.timeMap.at(-1)?.timeUs ?? firstTime;
  const durationMinutes = Math.max(1 / 60, (lastTime - firstTime) / 60_000_000);
  const pedalChanges = reference.generation.dimensions.pedal == null
    ? undefined
    : reference.pedals.sustain.length / durationMinutes;
  const cadence = cadenceRatio(score, reference, analysis, tempo);
  const repeatChange = repeatTempoChange(tempo);
  const dynamics = dynamicIqr(reference);

  return {
    ...(median(quarterBpms) == null ? {} : { tempoMedianBpm: median(quarterBpms) }),
    ...(p10 == null || p90 == null ? {} : { rubatoSpan: p90 - p10 }),
    ...(volatility == null ? {} : { tempoVolatility: volatility }),
    ...(cadence == null ? {} : { cadentialTempoRatio: cadence }),
    ...(summary.durationRatioMedian == null ? {} : { durationRatioMedian: summary.durationRatioMedian }),
    ...(summary.upperStaffBalance == null ? {} : { upperStaffBalance: summary.upperStaffBalance }),
    ...(summary.pedalDownRatio == null ? {} : { pedalDownRatio: summary.pedalDownRatio }),
    ...(pedalChanges == null ? {} : { pedalChangesPerMinute: pedalChanges }),
    ...handTimingFeatures(score, reference),
    ...(dynamics == null ? {} : { dynamicIqr: dynamics }),
    ...(repeatChange == null ? {} : { repeatTempoChangePct: repeatChange }),
  };
}

function robustZScores(features: PerformanceFeatures[]): void {
  const byScore = new Map<string, PerformanceFeatures[]>();
  for (const feature of features) {
    const group = byScore.get(feature.scoreId) ?? [];
    group.push(feature);
    byScore.set(feature.scoreId, group);
  }
  for (const group of byScore.values()) {
    for (const key of FEATURE_KEYS) {
      const values = group.flatMap((feature) => feature.values[key] == null ? [] : [feature.values[key]]);
      if (values.length < 3) continue;
      const center = median(values) ?? 0;
      const deviations = values.map((value) => Math.abs(value - center));
      const mad = median(deviations) ?? 0;
      const fallback = standardDeviation(values);
      const scale = mad > 1e-9 ? mad * 1.4826 : fallback;
      if (scale <= 1e-9) continue;
      for (const feature of group) {
        const value = feature.values[key];
        if (value != null) {
          const z = (value - center) / scale;
          feature.zScores[key] = Math.max(-4, Math.min(4, z));
        }
      }
    }
  }
}

function centroid(items: PerformanceFeatures[]): FeatureValues {
  return Object.fromEntries(FEATURE_KEYS.flatMap((key) => {
    const weighted = items.flatMap((item) => item.zScores[key] == null
      ? []
      : [{ value: item.zScores[key], weight: item.reliabilityWeight }]);
    const weightTotal = weighted.reduce((sum, item) => sum + item.weight, 0);
    const value = weightTotal <= 0
      ? undefined
      : weighted.reduce((sum, item) => sum + item.value * item.weight, 0) / weightTotal;
    return value == null ? [] : [[key, value]];
  })) as FeatureValues;
}

function vectorDistance(left: FeatureValues, right: FeatureValues): { distance: number; dimensions: number } | null {
  const squared = FEATURE_KEYS.flatMap((key) =>
    left[key] == null || right[key] == null ? [] : [(left[key] - right[key]) ** 2]);
  return squared.length < 4
    ? null
    : { distance: Math.sqrt((mean(squared) ?? 0)), dimensions: squared.length };
}

function styleSummaries(features: PerformanceFeatures[]) {
  const byPerformer = new Map<string, PerformanceFeatures[]>();
  for (const feature of features) {
    const group = byPerformer.get(feature.performerId) ?? [];
    group.push(feature);
    byPerformer.set(feature.performerId, group);
  }
  return [...byPerformer.entries()].flatMap(([performerId, items]) => {
    const distinctScores = new Set(items.map((item) => item.scoreId));
    if (distinctScores.size < 3) return [];
    const signature = centroid(items);
    const distances = items.flatMap((item) => vectorDistance(item.zScores, signature)?.distance ?? []);
    const signatureValues = FEATURE_KEYS.flatMap((key) => signature[key] == null ? [] : [signature[key]]);
    const consistencyDistance = mean(distances) ?? 0;
    const distinctiveness = Math.sqrt(mean(signatureValues.map((value) => value ** 2)) ?? 0);
    const stableTraits = [...FEATURE_KEYS]
      .filter((key) => signature[key] != null)
      .sort((left, right) => Math.abs(signature[right] ?? 0) - Math.abs(signature[left] ?? 0))
      .slice(0, 4)
      .map((key) => ({ key, label: FEATURE_LABELS[key], z: signature[key]! }));
    return [{
      performerId,
      performerName: items[0].performerName,
      pieceCount: distinctScores.size,
      validatedCount: items.filter((item) => item.status === "automatically-validated").length,
      medianScoreCoverage: median(items.map((item) => item.scoreCoverage)) ?? 0,
      medianPerformanceCoverage: median(items.map((item) => item.performanceCoverage)) ?? 0,
      signature,
      stableTraits,
      consistencyDistance,
      distinctiveness,
      exploratoryStyleScore: distinctiveness / Math.max(0.35, consistencyDistance),
    }];
  }).sort((left, right) => right.exploratoryStyleScore - left.exploratoryStyleScore);
}

function leaveOnePieceOut(features: PerformanceFeatures[]) {
  const eligible = new Set(styleSummaries(features).map((summary) => summary.performerId));
  const trials = features.flatMap((heldOut) => {
    if (!eligible.has(heldOut.performerId)) return [];
    const candidates = [...eligible].flatMap((performerId) => {
      const training = features.filter((feature) =>
        feature.performerId === performerId && feature.scoreId !== heldOut.scoreId);
      if (new Set(training.map((item) => item.scoreId)).size < 2) return [];
      const distance = vectorDistance(heldOut.zScores, centroid(training));
      return distance ? [{ performerId, ...distance }] : [];
    }).sort((left, right) => left.distance - right.distance);
    if (candidates.length === 0) return [];
    return [{
      interpretationId: heldOut.interpretationId,
      scoreId: heldOut.scoreId,
      actualPerformerId: heldOut.performerId,
      predictedPerformerId: candidates[0].performerId,
      correct: candidates[0].performerId === heldOut.performerId,
      candidateCount: candidates.length,
      candidates: candidates.slice(0, 3),
    }];
  });
  return {
    eligiblePerformers: [...eligible],
    trials,
    top1Accuracy: trials.length === 0 ? null : trials.filter((trial) => trial.correct).length / trials.length,
    chanceBaseline: trials.length === 0
      ? null
      : mean(trials.map((trial) => 1 / trial.candidateCount)),
  };
}

function samePieceComparisons(features: PerformanceFeatures[]) {
  const byScore = new Map<string, PerformanceFeatures[]>();
  for (const feature of features) {
    const group = byScore.get(feature.scoreId) ?? [];
    group.push(feature);
    byScore.set(feature.scoreId, group);
  }
  return [...byScore.entries()].map(([scoreId, items]) => {
    const pairs = items.flatMap((left, leftIndex) => items.slice(leftIndex + 1).flatMap((right) => {
      const distance = vectorDistance(left.zScores, right.zScores);
      if (!distance) return [];
      const differences = FEATURE_KEYS.flatMap((key) =>
        left.zScores[key] == null || right.zScores[key] == null
          ? []
          : [{ key, label: FEATURE_LABELS[key], deltaZ: left.zScores[key] - right.zScores[key] }])
        .sort((a, b) => Math.abs(b.deltaZ) - Math.abs(a.deltaZ))
        .slice(0, 4);
      return [{
        leftId: left.interpretationId,
        leftPerformer: left.performerName,
        rightId: right.interpretationId,
        rightPerformer: right.performerName,
        ...distance,
        differences,
      }];
    })).sort((left, right) => right.distance - left.distance);
    return {
      scoreId,
      referenceCount: items.length,
      mostContrastingPair: pairs[0] ?? null,
      closestPair: pairs.at(-1) ?? null,
      performances: items.map((item) => ({
        interpretationId: item.interpretationId,
        performerName: item.performerName,
        status: item.status,
        scoreCoverage: item.scoreCoverage,
        values: item.values,
      })),
    };
  });
}

function formatNumber(value: number | undefined, digits = 2): string {
  return value == null ? "—" : value.toFixed(digits);
}

function markdownReport(
  features: PerformanceFeatures[],
  samePiece: ReturnType<typeof samePieceComparisons>,
  styles: ReturnType<typeof styleSummaries>,
  identification: ReturnType<typeof leaveOnePieceOut>,
): string {
  const lines = [
    "# 参考演奏比较与跨曲风格分析",
    "",
    `生成时间：${new Date().toISOString()}`,
    "",
    "## 数据覆盖",
    "",
    "| 曲目 ID | 演绎数 | 自动验证数 | 中位发布覆盖率 |",
    "|---|---:|---:|---:|",
  ];
  for (const comparison of samePiece) {
    const items = features.filter((item) => item.scoreId === comparison.scoreId);
    lines.push(`| ${comparison.scoreId} | ${items.length} | ${items.filter((item) => item.status === "automatically-validated").length} | ${formatNumber(median(items.map((item) => item.scoreCoverage)))} |`);
  }
  lines.push(
    "",
    "## 方法",
    "",
    "先以 MusicXML 展开反复并将每个录音对齐到稳定的乐谱位置；再提取速度、rubato、段尾减速、奏音长度、双手平衡、踏板、双手起音错位和归一化力度范围。跨曲分析先在每首曲子内部做稳健 z 标准化，以尽量剔除曲目本身的速度与织体差异。",
    "",
    "## 同曲不同演奏者",
    "",
  );
  for (const comparison of samePiece) {
    const pair = comparison.mostContrastingPair;
    lines.push(`### ${comparison.scoreId}`, "");
    if (!pair) {
      lines.push("有效特征不足，暂不能计算成对距离。", "");
      continue;
    }
    lines.push(
      `差异最大：${pair.leftPerformer} ↔ ${pair.rightPerformer}（标准化距离 ${formatNumber(pair.distance)}，${pair.dimensions} 个共同维度）。`,
      "",
      `主要差异：${pair.differences.map((item) => `${item.label} Δz=${formatNumber(item.deltaZ)}`).join("；")}。`,
      "",
    );
  }
  lines.push(
    "## 同一演奏者跨曲风格",
    "",
    "| 演奏者 | 曲目数 | 自动验证数 | 乐谱覆盖率 | 性能事件覆盖率 | 跨曲一致性距离↓ | 区分度 | 探索性风格分数 | 主要稳定偏向 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---|",
  );
  for (const style of styles) {
    const traits = style.stableTraits.map((trait) =>
      `${trait.label}${trait.z >= 0 ? "+" : ""}${formatNumber(trait.z)}`).join("；");
    lines.push(`| ${style.performerName} | ${style.pieceCount} | ${style.validatedCount} | ${formatNumber(style.medianScoreCoverage)} | ${formatNumber(style.medianPerformanceCoverage)} | ${formatNumber(style.consistencyDistance)} | ${formatNumber(style.distinctiveness)} | ${formatNumber(style.exploratoryStyleScore)} | ${traits} |`);
  }
  lines.push(
    "",
    "## 留一曲目识别实验",
    "",
    identification.top1Accuracy == null
      ? "有效样本不足。"
      : `只用其余曲目建立演奏者中心，再识别被留出的曲目：Top-1 ${identification.trials.filter((trial) => trial.correct).length}/${identification.trials.length}（${formatNumber(identification.top1Accuracy * 100, 1)}%）；按每次候选人数计算的随机基线为 ${formatNumber((identification.chanceBaseline ?? 0) * 100, 1)}%。`,
    "",
    "## 解释边界",
    "",
    `- 这是基于当前 ${new Set(features.map((item) => item.scoreId)).size} 首曲目和 ${features.length} 个录音的探索性结果，不等同于对钢琴家风格的最终音乐学判断。`,
    "- 速度和时序最可靠；踏板、离键与力度仍受转录模型、钢琴音色、录音年代、混响和母带处理影响。",
    "- 跨曲识别必须使用曲内标准化，并要求至少 3 首曲目；否则模型很容易把作品差异或录音工程误当成演奏者风格。",
    "- 下一阶段应增加同一钢琴家的更多作品、同一作品的多个录音年代，以及 MIDI/高质量近场录音作为校准集。",
    "",
  );
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const missingDetails = catalog.references.filter((entry) =>
    !existsSync(interpretationPath(entry.interpretationId)));
  if (missingDetails.length > 0 && !process.argv.includes("--allow-partial")) {
    throw new Error(`Missing ${missingDetails.length} interpretation detail file(s)`);
  }
  const scoreCache = new Map<string, LoadedScore>();
  const features: PerformanceFeatures[] = [];
  for (const entry of catalog.references) {
    const detailPath = interpretationPath(entry.interpretationId);
    if (!existsSync(detailPath)) continue;
    const detail = JSON.parse(readFileSync(detailPath, "utf8")) as ScoreInterpretation;
    let loaded = scoreCache.get(entry.score.scoreId);
    if (!loaded) {
      const item = manifest.items.find((candidate) => candidate.scoreId === entry.score.scoreId);
      if (!item) throw new Error(`Missing score manifest item: ${entry.score.scoreId}`);
      loaded = {
        score: await loadCanonicalScore(scorePath(item.scoreId)),
        analysis: JSON.parse(readFileSync(analysisPath(item.scoreId), "utf8")) as ScoreAnalysis,
      };
      scoreCache.set(entry.score.scoreId, loaded);
    }
    const reference = { ...entry, ...detail } as ReferenceInterpretation;
    features.push({
      interpretationId: entry.interpretationId,
      scoreId: entry.score.scoreId,
      performerId: entry.performerId,
      performerName: entry.performerName,
      status: detail.generation.status,
      scoreCoverage: detail.generation.coverage.scoreCoverage,
      performanceCoverage: detail.generation.coverage.performanceCoverage,
      reliabilityWeight: Math.sqrt(
        detail.generation.coverage.scoreCoverage * detail.generation.coverage.performanceCoverage,
      ),
      values: extractFeatures(loaded, reference),
      zScores: {},
    });
  }

  robustZScores(features);
  const samePiece = samePieceComparisons(features);
  const styles = styleSummaries(features);
  const identification = leaveOnePieceOut(features);
  const outputDirectory = path.join(cacheDirectory, "reports", "performance");
  mkdirSync(outputDirectory, { recursive: true });
  const report = {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    featureDefinitions: Object.fromEntries(FEATURE_KEYS.map((key) => [key, FEATURE_LABELS[key]])),
    features,
    samePiece,
    styles,
    identification,
  };
  writeFileSync(
    path.join(outputDirectory, "reference-style-analysis.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    path.join(outputDirectory, "reference-style-analysis.md"),
    markdownReport(features, samePiece, styles, identification),
    "utf8",
  );
  console.log(JSON.stringify({
    references: features.length,
    scores: samePiece.length,
    styleProfiles: styles.length,
    identificationTrials: identification.trials.length,
    top1Accuracy: identification.top1Accuracy,
  }, null, 2));
}

void main();
