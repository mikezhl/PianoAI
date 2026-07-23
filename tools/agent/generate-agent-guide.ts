import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface ScoreCatalogItem {
  scoreId: string;
  title: string;
  sourceHash: string;
}

interface ScoreCatalog {
  schemaVersion: string;
  items: ScoreCatalogItem[];
}

interface ScoreAnalysis {
  score?: {
    id?: string;
    title?: string;
    composer?: string;
    key?: string;
  };
}

interface ReferenceCatalogItem {
  interpretationId: string;
  score: {
    scoreId: string;
  };
  performerId: string;
  performerName: string;
}

interface ReferenceCatalog {
  schemaVersion: string;
  references: ReferenceCatalogItem[];
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function requireFile(filePath: string, label: string): void {
  if (!existsSync(filePath)) {
    throw new Error(`${label} does not exist: ${filePath}`);
  }
}

export function buildAgentGuide(root: string): string {
  const dataDirectory = path.join(root, "data");
  const scoreCatalogPath = path.join(dataDirectory, "catalog.json");
  const referenceCatalogPath = path.join(dataDirectory, "performances", "catalog.json");
  const scoreCatalog = readJson<ScoreCatalog>(scoreCatalogPath);
  const referenceCatalog = readJson<ReferenceCatalog>(referenceCatalogPath);

  if (scoreCatalog.schemaVersion !== "2.1.0" || !Array.isArray(scoreCatalog.items)) {
    throw new Error("Unsupported score catalog schema");
  }
  if (referenceCatalog.schemaVersion !== "2.1.0" || !Array.isArray(referenceCatalog.references)) {
    throw new Error("Unsupported reference catalog schema");
  }

  const scoreIds = new Set(scoreCatalog.items.map((item) => item.scoreId));
  const referencesByScore = new Map<string, ReferenceCatalogItem[]>();
  for (const reference of referenceCatalog.references) {
    if (!scoreIds.has(reference.score.scoreId)) {
      throw new Error(
        `Reference ${reference.interpretationId} uses unknown score ${reference.score.scoreId}`,
      );
    }
    const interpretationPath = path.join(
      dataDirectory,
      "performances",
      "interpretations",
      `${reference.interpretationId}.json`,
    );
    requireFile(interpretationPath, "Interpretation file");
    const scoreReferences = referencesByScore.get(reference.score.scoreId) ?? [];
    scoreReferences.push(reference);
    referencesByScore.set(reference.score.scoreId, scoreReferences);
  }

  const lines = [
    "# PianoAI Agent 数据指南",
    "",
    "## 用途",
    "",
    "PianoAI 公开曲谱、静态曲谱分析和参考演绎测量，供 Agent 按需读取并回答音乐问题。",
    "",
    "本指南只说明 PianoAI 能提供什么数据以及如何读取，不限制 Agent 使用其他来源。使用其他来源或自行推断时，应与 PianoAI 数据明确区分，不得将其表述为 PianoAI 提供的结论。",
    "",
    "默认使用中文回答。PianoAI 数据不足以支持某个结论时，应明确说明证据范围和不足之处。",
    "",
    "## 路径",
    "",
    "从本指南完整 URL 中移除 `data/agent-guide.txt`，得到应用根地址。以下路径均相对于该根地址。",
    "",
    "## 当前数据索引",
    "",
    `本索引已展开当前部署的 ${scoreCatalog.items.length} 首曲目、分析可用性和 ${referenceCatalog.references.length} 条参考演绎。常规检索无需再次读取 \`data/catalog.json\` 或 \`data/performances/catalog.json\`；直接使用下列精确路径。未列出的曲目或演绎不在当前 PianoAI 数据中。`,
    "",
  ];

  for (const item of scoreCatalog.items) {
    const scoreRelativePath = `data/scores/${item.scoreId}.mxl`;
    const analysisRelativePath = `data/analyses/${item.scoreId}.json`;
    const scorePath = path.join(root, scoreRelativePath);
    const analysisPath = path.join(root, analysisRelativePath);
    requireFile(scorePath, "Score file");

    const hasAnalysis = existsSync(analysisPath);
    const analysis = hasAnalysis ? readJson<ScoreAnalysis>(analysisPath) : null;
    if (analysis?.score?.id && analysis.score.id !== item.scoreId) {
      throw new Error(`Analysis identity mismatch for ${item.scoreId}`);
    }
    const references = referencesByScore.get(item.scoreId) ?? [];
    const composer = analysis?.score?.composer;
    const heading = composer ? `${composer} — ${item.title}` : item.title;

    lines.push(
      `### ${heading}`,
      "",
      `- \`scoreId\`：\`${item.scoreId}\``,
      `- \`sourceHash\`：\`${item.sourceHash}\``,
      `- 曲谱：\`${scoreRelativePath}\``,
      `- 静态分析：${hasAnalysis ? `有 — \`${analysisRelativePath}\`` : "无"}`,
    );

    if (references.length === 0) {
      lines.push("- 参考演绎：无", "");
      continue;
    }

    lines.push(`- 参考演绎：${references.length} 条`);
    for (const reference of references) {
      lines.push(
        `  - ${reference.performerName}（\`${reference.performerId}\`）：`
        + `\`data/performances/interpretations/${reference.interpretationId}.json\``,
      );
    }
    lines.push("");
  }

  lines.push(
    "## 文件内容",
    "",
    "### 原始曲谱",
    "",
    "MXL 文件是记谱事实和曲谱身份的权威来源。只有问题需要分析文件中未直接给出的记谱细节，并且 Agent 能可靠解析 MXL 时，才需要读取。",
    "",
    "### 静态曲谱分析",
    "",
    "主要字段：",
    "",
    "- `score`：曲谱身份、标题、作曲家、调性、拍号和小节映射。",
    "- `form`：经审阅的曲式标签和概述。",
    "- `sections`：按顺序排列的结构段落、曲谱范围、调性、说明和置信度。",
    "- `motifFamilies`：主题或动机家族、识别依据及其在曲谱中的位置。",
    "- `leftHandAnalysisMode`：左手材料采用和弦分组还是复调织体分析。",
    "- `leftHandChordFamilies`：适用于和弦分组曲目的左手和弦家族。",
    "- `leftHandTextureFamilies`：适用于复调织体曲目的低音、持续音程、声部进行或收束手势。",
    "- `sources`：PianoAI 已记录的分析来源。",
    "- `crossValidation`：已确认、有限确认和被否定的分析主张。",
    "",
    "内部位置使用从零开始的 `measureIndex` 和有理数四分音符偏移。回答时不要在没有依据的情况下替换为其他小节编号。",
    "",
    "### 参考演绎测量",
    "",
    "主要字段：",
    "",
    "- `score`：对齐时使用的曲谱身份和 `sourceHash`。",
    "- `timeMap`：曲谱位置到演奏时间的映射及置信度。",
    "- `noteExpressions`：对齐后的音符或装饰音测量及置信度。",
    "- `pedals.sustain`：估计的延音踏板变化。",
    "- `generation.status`：记录是自动候选还是已通过自动验证。",
    "- `generation.dimensions`：各测量维度的验证结果。",
    "- `generation.coverage`：曲谱与演奏覆盖率、不确定音符和额外事件。",
    "",
    "这些记录是速度、力度、时值、踏板和装饰音等测量，不是完整的艺术评价。解释时应保留置信度、验证状态和覆盖范围。",
    "",
    "参考演绎目录含来源和录音身份元数据，但本数据入口不提供录音文件。`source.url` 只用于来源说明，不是 PianoAI 数据读取流程的一部分。",
    "",
    "## 检索流程",
    "",
    "1. 直接在“当前数据索引”中定位曲目、分析文件和需要的演绎文件，不再为数据发现读取 catalog。",
    "2. 每个 URL 只请求一次，在当前对话中保留并复用已读取的响应；不要为了查看不同字段而重复下载同一文件。",
    "3. 回答曲式、段落、动机或左手材料问题时，只读取索引列出的对应静态分析 JSON。",
    "4. 只有确需精确记谱事实且能够解析时，才读取对应 MXL。",
    "5. 回答某位演奏家在某首作品中的演绎问题时，只读取该曲目下列出的对应演绎 JSON。",
    "6. 比较演奏时，优先比较同一曲目的记录。范围不明确时先向用户确认。",
    "7. 只读取回答当前问题所需的文件，不要批量获取全部演绎记录。",
    "",
    "## 回答要求",
    "",
    "- 默认使用中文，除非用户指定其他语言。",
    "- 先直接回答用户问题，再用少量最相关、最容易理解的音乐证据支持结论。",
    "- 不向用户汇报检索步骤、内部数据结构或计算过程，除非用户明确询问。",
    "- 原始数值只在有助于解释结论时使用；不要用覆盖率、百分位和置信度堆满正文。",
    "- 列出回答实际使用的 PianoAI 数据 URL。",
    "- 区分记谱事实、静态分析、演绎测量、Agent 推断和其他来源。",
    "- 保留数据中的 `confidence`、`generation.status`、覆盖范围和交叉验证限制。",
    "- 证据限制只在影响结论时简要说明，避免让方法声明压过答案本身。",
    "- 不把少量 PianoAI 演绎记录概括成演奏家的整体风格。",
    "- 不把数据未支持的主观判断表述为 PianoAI 结论。",
    "- PianoAI 数据或解析能力不足时，明确说明具体缺口。",
    "",
  );

  return lines.join("\n");
}

export function writeAgentGuide(root: string): void {
  const guidePath = path.join(root, "data", "agent-guide.txt");
  writeFileSync(guidePath, buildAgentGuide(root), "utf8");
}

function run(): void {
  const root = process.cwd();
  const guidePath = path.join(root, "data", "agent-guide.txt");
  const expected = buildAgentGuide(root);
  if (process.argv.includes("--check")) {
    const actual = existsSync(guidePath) ? readFileSync(guidePath, "utf8") : "";
    if (actual !== expected) {
      throw new Error("data/agent-guide.txt is stale; run npm run agent:guide");
    }
    console.log("Agent guide is current");
    return;
  }
  writeFileSync(guidePath, expected, "utf8");
  console.log(`Generated ${path.relative(root, guidePath)}`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  run();
}
