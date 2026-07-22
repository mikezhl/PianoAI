import { createHash } from "node:crypto";
import { readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import JSZip from "jszip";
import type { ScoreAnalysis } from "../../src/analysis/types";
import { buildLeftHandChordAnalysis } from "../../src/lib/analysis/chords";
import { parseMusicXml } from "../../src/lib/musicXml";

const ANALYSIS_DIR = "data/analyses";
const SCORE_DIR = "data/scores";

function analysisPaths(args: string[]): string[] {
  const requested = args.filter((argument) => !argument.startsWith("--"));
  if (requested.length > 0) {
    return requested.map((filePath) => path.resolve(filePath));
  }
  return readdirSync(ANALYSIS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.resolve(ANALYSIS_DIR, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

async function readScoreXml(sourcePath: string): Promise<string> {
  const source = readFileSync(sourcePath);
  if (path.extname(sourcePath).toLowerCase() !== ".mxl") {
    return source.toString("utf8");
  }

  const zip = await JSZip.loadAsync(source);
  const containerXml = await zip.file("META-INF/container.xml")?.async("text");
  if (!containerXml) {
    throw new Error(`${sourcePath}: MXL container.xml is missing`);
  }
  const container = new DOMParser().parseFromString(containerXml, "application/xml");
  const scorePath = container.querySelector("rootfile")?.getAttribute("full-path");
  if (!scorePath) {
    throw new Error(`${sourcePath}: MXL container does not define a score path`);
  }
  const scoreXml = await zip.file(scorePath)?.async("text");
  if (!scoreXml) {
    throw new Error(`${sourcePath}: score file ${scorePath} is missing from the archive`);
  }
  return scoreXml;
}

function sourceHash(sourcePath: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(sourcePath)).digest("hex").toUpperCase()}`;
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const temporaryPath = `${filePath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, filePath);
}

async function generate(
  analysisPath: string,
  check: boolean,
): Promise<{ occurrences: number; families: number; scoreId: string }> {
  const current = JSON.parse(readFileSync(analysisPath, "utf8")) as ScoreAnalysis;
  if (current.schemaVersion !== "2.1.0") {
    throw new Error(`${analysisPath}: unsupported schema ${current.schemaVersion}`);
  }

  const sourcePath = path.resolve(SCORE_DIR, current.score.sourceFile);
  const actualHash = sourceHash(sourcePath);
  if (actualHash !== current.score.sourceHash) {
    throw new Error(`${analysisPath}: source hash does not match ${current.score.sourceFile}`);
  }

  if (current.leftHandAnalysisMode === "polyphonic-texture") {
    if (current.leftHandChordGrouping !== null || current.leftHandChordFamilies.length > 0) {
      throw new Error(`${analysisPath}: polyphonic texture analysis must not contain chord grouping data`);
    }
    return {
      occurrences: current.leftHandTextureFamilies.reduce((total, family) => total + family.occurrences.length, 0),
      families: current.leftHandTextureFamilies.length,
      scoreId: current.score.id,
    };
  }

  const scoreXml = await readScoreXml(sourcePath);
  const score = parseMusicXml(scoreXml, current.score.sourceFile);
  const chordAnalysis = buildLeftHandChordAnalysis(score, current);
  if (check) {
    const stored = JSON.stringify(current.leftHandChordFamilies);
    const generated = JSON.stringify(chordAnalysis.families);
    if (stored !== generated) {
      throw new Error(`${analysisPath}: stored left-hand chord analysis is stale or does not match the source score`);
    }
    return {
      occurrences: chordAnalysis.occurrences.length,
      families: chordAnalysis.families.length,
      scoreId: current.score.id,
    };
  }
  const next: ScoreAnalysis = {
    ...current,
    leftHandChordFamilies: chordAnalysis.families,
  };
  writeJsonAtomic(analysisPath, next);
  return {
    occurrences: chordAnalysis.occurrences.length,
    families: chordAnalysis.families.length,
    scoreId: current.score.id,
  };
}

async function main() {
  const window = new JSDOM("").window;
  Object.assign(globalThis, { DOMParser: window.DOMParser });

  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const files = analysisPaths(args);
  if (files.length === 0) {
    throw new Error("No analysis JSON files found");
  }
  for (const filePath of files) {
    const result = await generate(filePath, check);
    const action = check ? "verified" : "generated";
    console.log(`${result.scoreId}: ${action} ${result.occurrences} left-hand occurrences in ${result.families} families`);
  }
}

await main();
