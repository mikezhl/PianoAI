import type { ScoreAnalysis } from "../../analysis/types";

export interface ExpectedAnalysisIdentity {
  scoreId: string;
  sourceHash: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertAnalysisContract(value: unknown): asserts value is ScoreAnalysis {
  if (!isObject(value) || value.schemaVersion !== "2.1.0" || !isObject(value.score)) {
    throw new Error("分析文件格式不受支持");
  }

  const arrayKeys = [
    "sources",
    "crossValidation",
    "sections",
    "motifFamilies",
    "leftHandChordFamilies",
    "leftHandTextureFamilies",
  ];
  if (
    !isObject(value.form)
    || (value.leftHandAnalysisMode !== "chord-groups" && value.leftHandAnalysisMode !== "polyphonic-texture")
    || (value.leftHandChordGrouping !== null && !isObject(value.leftHandChordGrouping))
    || (isObject(value.leftHandChordGrouping) && !Array.isArray(value.leftHandChordGrouping.overrides))
    || arrayKeys.some((key) => !Array.isArray(value[key]))
  ) {
    throw new Error("分析文件缺少必要内容");
  }
}

export async function loadAnalysis(
  url: string,
  expected: ExpectedAnalysisIdentity,
  signal?: AbortSignal,
): Promise<ScoreAnalysis> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`分析文件加载失败（${response.status}）`);
  }

  const value: unknown = await response.json();
  assertAnalysisContract(value);
  if (value.score.id !== expected.scoreId || value.score.sourceHash !== expected.sourceHash) {
    throw new Error("分析结果与当前谱面不匹配");
  }

  return value;
}
