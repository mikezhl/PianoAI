import path from "node:path";

export const projectRoot = process.cwd();
export const dataDirectory = path.join(projectRoot, "data");
export const scoreCatalogPath = path.join(dataDirectory, "catalog.json");
export const scoreDirectory = path.join(dataDirectory, "scores");
export const analysisDirectory = path.join(dataDirectory, "analyses");
export const performanceDirectory = path.join(dataDirectory, "performances");
export const performanceCatalogPath = path.join(performanceDirectory, "catalog.json");
export const interpretationDirectory = path.join(performanceDirectory, "interpretations");
export const evaluationDirectory = path.join(performanceDirectory, "evaluations");
export const schemaDirectory = path.join(projectRoot, "schemas");
export const referenceAudioDirectory = path.join(projectRoot, "assets", "reference-audio");
export const localDirectory = path.join(projectRoot, ".local");
export const cacheDirectory = path.join(projectRoot, ".cache");

export function scorePath(scoreId: string): string {
  return path.join(scoreDirectory, `${scoreId}.mxl`);
}

export function analysisPath(scoreId: string): string {
  return path.join(analysisDirectory, `${scoreId}.json`);
}

export function interpretationPath(interpretationId: string): string {
  return path.join(interpretationDirectory, `${interpretationId}.json`);
}

export function evaluationPath(evaluationId: string): string {
  return path.join(evaluationDirectory, `${evaluationId}.json`);
}
