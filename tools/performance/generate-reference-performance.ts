import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  analysisPath as scoreAnalysisPath,
  cacheDirectory,
  evaluationPath,
  interpretationPath,
  localDirectory,
  performanceCatalogPath,
  projectRoot,
  referenceAudioDirectory,
  scoreCatalogPath,
  scorePath as canonicalScorePath,
} from "../project-paths";

interface AnalysisManifestItem {
  scoreId: string;
  sourceHash: string;
}

interface ReferenceEntry {
  interpretationId: string;
  score: { scoreId: string; sourceHash: string };
  audio: { fileName: string; sha256: string };
}

const root = projectRoot;
const referencesPath = performanceCatalogPath;
const analysisManifest = JSON.parse(
  readFileSync(scoreCatalogPath, "utf8"),
) as { items: AnalysisManifestItem[] };
const catalog = JSON.parse(readFileSync(referencesPath, "utf8")) as { references: ReferenceEntry[] };

function argumentsFor(name: string): string[] {
  return process.argv.flatMap((argument, index) => argument === name ? [process.argv[index + 1] ?? ""] : [])
    .filter(Boolean);
}

function executable(windowsPath: string, posixPath: string): string {
  const candidate = process.platform === "win32" ? windowsPath : posixPath;
  if (!existsSync(candidate)) throw new Error(`Missing AI model runtime: ${candidate}`);
  return candidate;
}

function run(label: string, command: string, args: string[]): void {
  console.log(`\n[performance] ${label}`);
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
}

function requireFile(filePath: string): void {
  if (!existsSync(filePath)) throw new Error(`Missing pipeline input: ${filePath}`);
}

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex").toUpperCase();
}

function localAudioPath(fileName: string): string {
  if (path.basename(fileName) !== fileName) throw new Error(`Invalid reference audio file name: ${fileName}`);
  return path.join(referenceAudioDirectory, fileName);
}

function selectedReferences(): ReferenceEntry[] {
  const requestedIds = argumentsFor("--reference");
  if (process.argv.includes("--all")) {
    if (requestedIds.length > 0) throw new Error("Use either --all or --reference, not both");
    return catalog.references;
  }
  if (requestedIds.length === 0) return catalog.references.slice(0, 1);
  const requested = new Set(requestedIds);
  const selected = catalog.references.filter((reference) => requested.has(reference.interpretationId));
  const missing = requestedIds.filter((id) => !selected.some((reference) => reference.interpretationId === id));
  if (missing.length > 0) throw new Error(`Unknown reference(s): ${missing.join(", ")}`);
  return selected;
}

const reuseTranscriptions = process.argv.includes("--reuse-transcriptions");
const skipValidation = process.argv.includes("--skip-validation");
const skipReferenceWrite = process.argv.includes("--skip-reference-write");
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const pianoPython = executable(
  path.join(localDirectory, "amt-piano-transcription", "Scripts", "python.exe"),
  path.join(localDirectory, "amt-piano-transcription", "bin", "python"),
);
const scoreAlignmentPython = executable(
  path.join(localDirectory, "score-alignment", "Scripts", "python.exe"),
  path.join(localDirectory, "score-alignment", "bin", "python"),
);

for (const reference of selectedReferences()) {
  console.log(`\n[performance] reference ${reference.interpretationId}`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(reference.interpretationId)) {
    throw new Error(`Invalid reference identifier: ${reference.interpretationId}`);
  }
  const manifestItem = analysisManifest.items.find((item) => item.scoreId === reference.score.scoreId);
  if (!manifestItem || manifestItem.sourceHash !== reference.score.sourceHash) {
    throw new Error(`Reference score identity mismatch: ${reference.interpretationId}`);
  }

  const cacheRoot = path.join(cacheDirectory, "performance-tests", reference.interpretationId);
  const audioPath = localAudioPath(reference.audio.fileName);
  const monoAudioPath = path.join(cacheRoot, "source-mono-22050.wav");
  const pianoDirectory = path.join(cacheRoot, "amt", "piano-transcription");
  const pianoMidi = path.join(pianoDirectory, "output.mid");
  const pianoEvents = path.join(pianoDirectory, "events.json");
  const scorePath = canonicalScorePath(manifestItem.scoreId);
  const analysisPath = scoreAnalysisPath(manifestItem.scoreId);
  const scoreEvents = path.join(cacheRoot, "score-events.json");
  const rawAlignment = path.join(cacheRoot, "score-informed-alignment.json");
  const targetInterpretationPath = interpretationPath(reference.interpretationId);
  const targetEvaluationPath = evaluationPath(reference.interpretationId);

  requireFile(audioPath);
  if (sha256(audioPath) !== reference.audio.sha256) {
    throw new Error(`Reference audio hash mismatch: ${reference.interpretationId}`);
  }

  if (!reuseTranscriptions) {
    mkdirSync(pianoDirectory, { recursive: true });
    run("normalize reference audio", "ffmpeg", [
      "-y",
      "-i",
      audioPath,
      "-ac",
      "1",
      "-ar",
      "22050",
      monoAudioPath,
    ]);
    run("run Piano Transcription Inference", pianoPython, [
      path.join(root, "tools", "performance", "run-piano-transcription.py"),
      monoAudioPath,
      path.join(localDirectory, "amt-models", "piano-transcription-note-pedal.pth"),
      pianoMidi,
      pianoEvents,
    ]);
  }
  requireFile(monoAudioPath);
  requireFile(pianoEvents);

  run("export canonical score events", process.execPath, [
    tsxCli,
    path.join(root, "tools", "performance", "export-score-alignment-events.ts"),
    "--score",
    scorePath,
    "--output",
    scoreEvents,
  ]);
  run("align canonical score to reference audio", scoreAlignmentPython, [
    path.join(root, "tools", "performance", "score-informed-align.py"),
    "--audio",
    monoAudioPath,
    "--score-events",
    scoreEvents,
    "--piano-transcription",
    pianoEvents,
    "--score-id",
    reference.score.scoreId,
    "--audio-sha256",
    reference.audio.sha256,
    "--output",
    rawAlignment,
  ]);
  run("evaluate score-informed transcription", process.execPath, [
    tsxCli,
    path.join(root, "tools", "performance", "evaluate-score-informed-transcription.ts"),
    "--score",
    scorePath,
    "--analysis",
    analysisPath,
    "--alignment",
    rawAlignment,
    "--piano-transcription",
    pianoEvents,
    "--output",
    targetEvaluationPath,
  ]);
  run("generate score-aligned interpretation", process.execPath, [
    tsxCli,
    path.join(root, "tools", "performance", "generate-reference-interpretation.ts"),
    "--score",
    scorePath,
    "--analysis",
    analysisPath,
    "--references",
    referencesPath,
    "--interpretation-id",
    reference.interpretationId,
    "--piano-transcription",
    pianoEvents,
    "--evaluation",
    targetEvaluationPath,
    "--output",
    targetInterpretationPath,
    ...(skipReferenceWrite ? ["--skip-reference-write"] : ["--output-references", referencesPath]),
  ]);
}

if (!skipValidation) {
  run("validate generated performances", process.execPath, [
    tsxCli,
    path.join(root, "tools", "performance", "validate-performance-references.ts"),
  ]);
}
