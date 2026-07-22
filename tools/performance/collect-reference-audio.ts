import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  localDirectory,
  performanceCatalogPath,
  projectRoot,
  referenceAudioDirectory,
  scoreCatalogPath,
} from "../project-paths";

interface SourcePlanItem {
  interpretationId: string;
  scoreId: string;
  performerId: string;
  performerName: string;
  audioFile: string;
  source: { title: string; url: string };
}

interface CatalogEntry {
  interpretationId: string;
  score: {
    scoreId: string;
    sourceHash: string;
    identitySource: "library-source";
  };
  performerId: string;
  performerName: string;
  evidenceId: string;
  source: { title: string; url: string; kind: "original-recording" };
  audio: {
    fileName: string;
    objectKey: string;
    sha256: string;
    durationUs: number;
    format: string;
    sampleRate: number;
    channels: number;
    storage: "cloudflare-r2";
  };
}

interface ProbeResult {
  format?: { duration?: string };
  streams?: Array<{
    codec_type?: string;
    sample_rate?: string;
    channels?: number;
  }>;
}

const root = projectRoot;
const planPath = path.join(root, "tools", "performance", "config", "reference-sources.json");
const catalogPath = performanceCatalogPath;
const manifestPath = scoreCatalogPath;
const audioDirectory = referenceAudioDirectory;
const collectionPython = process.platform === "win32"
  ? path.join(localDirectory, "score-alignment", "Scripts", "python.exe")
  : path.join(localDirectory, "score-alignment", "bin", "python");

const plan = JSON.parse(readFileSync(planPath, "utf8")) as {
  schemaVersion: string;
  sources: SourcePlanItem[];
};
const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as {
  schemaVersion: "2.1.0";
  references: CatalogEntry[];
};
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  items: Array<{ scoreId: string; sourceHash: string }>;
};

if (plan.schemaVersion !== "1.0.0") throw new Error("Unsupported reference source plan");
if (process.argv.includes("--help")) {
  console.log("Usage: tsx tools/performance/collect-reference-audio.ts [--all | --reference <interpretation-id>]");
  process.exit(0);
}
if (!existsSync(collectionPython)) {
  throw new Error("Missing reference collection environment. Run npm run performance:setup first.");
}

function argumentsFor(name: string): string[] {
  return process.argv.flatMap((argument, index) =>
    argument === name ? [process.argv[index + 1] ?? ""] : []).filter(Boolean);
}

function selectedSources(): SourcePlanItem[] {
  const requestedIds = argumentsFor("--reference");
  if (process.argv.includes("--all")) {
    if (requestedIds.length > 0) throw new Error("Use either --all or --reference, not both");
    return plan.sources;
  }
  if (requestedIds.length === 0) return plan.sources.slice(0, 1);
  const requested = new Set(requestedIds);
  const selected = plan.sources.filter((source) => requested.has(source.interpretationId));
  const missing = requestedIds.filter((id) => !selected.some((source) => source.interpretationId === id));
  if (missing.length > 0) throw new Error(`Unknown source(s): ${missing.join(", ")}`);
  return selected;
}

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status ?? "unknown"}`);
  return result.stdout;
}

function safeAudioPath(fileName: string): string {
  if (path.basename(fileName) !== fileName || !fileName.endsWith(".m4a")) {
    throw new Error(`Invalid audio file name: ${fileName}`);
  }
  return path.join(audioDirectory, fileName);
}

function download(source: SourcePlanItem, audioPath: string): void {
  if (existsSync(audioPath)) return;
  const baseName = path.basename(source.audioFile, ".m4a");
  const outputTemplate = path.join(audioDirectory, `${baseName}.%(ext)s`);
  console.log(`[collect] ${source.interpretationId}`);
  run(collectionPython, [
    "-m", "yt_dlp",
    "--no-playlist",
    "--extract-audio",
    "--audio-format", "m4a",
    "--audio-quality", "0",
    "--output", outputTemplate,
    source.source.url,
  ]);
  if (!existsSync(audioPath)) throw new Error(`Download did not produce ${audioPath}`);
}

function probe(audioPath: string): CatalogEntry["audio"] {
  const payload = JSON.parse(run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type,sample_rate,channels",
    "-of", "json",
    audioPath,
  ])) as ProbeResult;
  const stream = payload.streams?.find((candidate) => candidate.codec_type === "audio");
  const durationSeconds = Number(payload.format?.duration);
  const sampleRate = Number(stream?.sample_rate);
  const channels = stream?.channels ?? 0;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || sampleRate <= 0 || channels <= 0) {
    throw new Error(`Invalid audio metadata: ${audioPath}`);
  }
  const sha256 = createHash("sha256").update(readFileSync(audioPath)).digest("hex").toUpperCase();
  return {
    fileName: path.basename(audioPath),
    objectKey: `reference-audio/${sha256.toLowerCase()}${path.extname(audioPath).toLowerCase()}`,
    sha256,
    durationUs: Math.round(durationSeconds * 1_000_000),
    format: "audio/mp4",
    sampleRate,
    channels,
    storage: "cloudflare-r2",
  };
}

mkdirSync(audioDirectory, { recursive: true });
const additions = selectedSources().map((source): CatalogEntry => {
  const score = manifest.items.find((item) => item.scoreId === source.scoreId);
  if (!score) throw new Error(`Unknown score: ${source.scoreId}`);
  const audioPath = safeAudioPath(source.audioFile);
  download(source, audioPath);
  return {
    interpretationId: source.interpretationId,
    score: {
      scoreId: source.scoreId,
      sourceHash: score.sourceHash,
      identitySource: "library-source",
    },
    performerId: source.performerId,
    performerName: source.performerName,
    evidenceId: `youtube-${new URL(source.source.url).searchParams.get("v")?.toLowerCase()}-audio`,
    source: { ...source.source, kind: "original-recording" },
    audio: probe(audioPath),
  };
});

const additionsById = new Map(additions.map((entry) => [entry.interpretationId, entry]));
const replacementKeys = new Set(additions.map((entry) => `${entry.score.scoreId}:${entry.performerId}`));
const references = catalog.references
  .filter((entry) => {
    const replacementKey = `${entry.score.scoreId}:${entry.performerId}`;
    return !replacementKeys.has(replacementKey) || additionsById.has(entry.interpretationId);
  })
  .map((entry) => additionsById.get(entry.interpretationId) ?? entry);
const existingIds = new Set(references.map((entry) => entry.interpretationId));
for (const source of plan.sources) {
  const addition = additionsById.get(source.interpretationId);
  if (addition && !existingIds.has(addition.interpretationId)) {
    references.push(addition);
    existingIds.add(addition.interpretationId);
  }
}

if (process.argv.includes("--all")) {
  const missingPlanned = plan.sources.filter((source) =>
    !references.some((entry) => entry.interpretationId === source.interpretationId));
  if (missingPlanned.length > 0) {
    throw new Error(`Catalog is missing planned source(s): ${missingPlanned.map((item) => item.interpretationId).join(", ")}`);
  }
  for (const score of manifest.items) {
    const scoreReferences = references.filter((entry) => entry.score.scoreId === score.scoreId);
    const performerIds = new Set(scoreReferences.map((entry) => entry.performerId));
    if (performerIds.size !== scoreReferences.length) {
      throw new Error(`${score.scoreId} contains duplicate performers`);
    }
  }
}

writeFileSync(catalogPath, `${JSON.stringify({ schemaVersion: "2.1.0", references }, null, 2)}\n`, "utf8");
console.log(`[collect] catalog contains ${references.length} reference(s)`);
