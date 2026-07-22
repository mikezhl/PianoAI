import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  ReferenceInterpretationCatalog,
  ScoreInterpretation,
} from "../../src/performance/types";
import {
  cacheDirectory,
  interpretationPath,
  performanceCatalogPath,
} from "../project-paths";

const catalog = JSON.parse(readFileSync(
  performanceCatalogPath,
  "utf8",
)) as ReferenceInterpretationCatalog;

const SCORE_ORDER = [...new Set(catalog.references.map((reference) => reference.score.scoreId))];

const SCORE_LABELS: Record<string, string> = {
  "chopin-nocturne-op9-no1": "Chopin Nocturne Op. 9 No. 1",
  "chopin-nocturne-op9-no2": "Chopin Nocturne Op. 9 No. 2",
  "chopin-waltz-a-minor": "Chopin Waltz in A minor, B. 150",
  "chopin-waltz-c-sharp-minor": "Chopin Waltz in C-sharp minor, Op. 64 No. 2",
  "schumann-traumerei-op15-no7": "Schumann Träumerei, Op. 15 No. 7",
  "chopin-ballade-op23-no1": "Chopin Ballade No. 1 in G minor, Op. 23",
  "chopin-ballade-op52-no4": "Chopin Ballade No. 4 in F minor, Op. 52",
};

function scoreLabel(scoreId: string): string {
  return SCORE_LABELS[scoreId] ?? scoreId;
}

function duration(valueUs: number): string {
  const seconds = Math.round(valueUs / 1_000_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function detailFor(interpretationId: string): ScoreInterpretation | null {
  const detailPath = interpretationPath(interpretationId);
  return existsSync(detailPath)
    ? JSON.parse(readFileSync(detailPath, "utf8")) as ScoreInterpretation
    : null;
}

const scoreCounts = SCORE_ORDER.map((scoreId) => ({
  scoreId,
  count: catalog.references.filter((reference) => reference.score.scoreId === scoreId).length,
}));
const maximumScoreCount = Math.max(...scoreCounts.map((item) => item.count));
const coverageSummary = scoreCounts.every((item) => item.count === maximumScoreCount)
  ? `每首曲目 ${maximumScoreCount} 个`
  : `${scoreCounts.filter((item) => item.count !== maximumScoreCount)
    .map((item) => `${scoreLabel(item.scoreId)} ${item.count} 个`)
    .join("、")}，其余曲目各 ${maximumScoreCount} 个`;

const lines = [
  "# 网络参考演奏来源索引",
  "",
  `生成时间：${new Date().toISOString()}`,
  "",
  `目录共 ${catalog.references.length} 个来源；${coverageSummary}。链接用于研究核验；原始录音只保存在本机 \`assets/reference-audio/\` 与 Cloudflare R2，不进入版本库或在线应用包。`,
  "",
];

for (const scoreId of SCORE_ORDER) {
  const references = catalog.references.filter((reference) => reference.score.scoreId === scoreId);
  lines.push(
    `## ${scoreLabel(scoreId)}`,
    "",
    "| 钢琴家 | 来源 | 时长 | 采样率/声道 | 识别状态 | 发布覆盖率 |",
    "|---|---|---:|---|---|---:|",
  );
  for (const reference of references) {
    const detail = detailFor(reference.interpretationId);
    lines.push(`| ${reference.performerName} | [${reference.source.title}](${reference.source.url}) | ${duration(reference.audio.durationUs)} | ${reference.audio.sampleRate} Hz / ${reference.audio.channels} ch | ${detail?.generation.status ?? "待识别"} | ${detail ? `${(detail.generation.coverage.scoreCoverage * 100).toFixed(2)}%` : "—"} |`);
  }
  lines.push("");
}

const performers = [...new Map(catalog.references.map((reference) => [
  reference.performerId,
  reference.performerName,
] as const)).entries()]
  .map(([performerId, performerName]) => ({ performerId, performerName }))
  .sort((left, right) => {
    const leftCount = catalog.references.filter((item) => item.performerId === left.performerId).length;
    const rightCount = catalog.references.filter((item) => item.performerId === right.performerId).length;
    return rightCount - leftCount || left.performerName.localeCompare(right.performerName, "zh-CN");
  });

lines.push(
  "## 演奏者跨曲覆盖矩阵",
  "",
  `| 钢琴家 | ${SCORE_ORDER.map(scoreLabel).join(" | ")} | 总数 |`,
  `|---|${SCORE_ORDER.map(() => "---:").join("|")}|---:|`,
);
for (const performer of performers) {
  const cells = SCORE_ORDER.map((scoreId) => catalog.references.some((reference) =>
    reference.performerId === performer.performerId && reference.score.scoreId === scoreId) ? "✓" : "—");
  lines.push(`| ${performer.performerName} | ${cells.join(" | ")} | ${cells.filter((cell) => cell === "✓").length} |`);
}
lines.push("");

const outputDirectory = path.join(cacheDirectory, "reports", "performance");
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(
  path.join(outputDirectory, "reference-source-index.md"),
  `${lines.join("\n")}\n`,
  "utf8",
);
console.log(`Wrote source index for ${catalog.references.length} reference(s)`);
