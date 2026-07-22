import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import {
  cacheDirectory,
  evaluationPath,
  interpretationPath,
  projectRoot,
} from "../project-paths";

interface SourcePlanItem {
  interpretationId: string;
  audioFile: string;
}

interface BatchItemStatus {
  interpretationId: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
}

const root = projectRoot;
const plan = JSON.parse(readFileSync(
  path.join(root, "tools", "performance", "config", "reference-sources.json"),
  "utf8",
)) as { sources: SourcePlanItem[] };
const statusPath = path.join(cacheDirectory, "performance-batch-status.json");
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const generator = path.join(root, "tools", "performance", "generate-reference-performance.ts");
const force = process.argv.includes("--all");
const workersArgument = process.argv.indexOf("--workers");
const workerCount = Math.max(1, Math.min(4, Number(
  workersArgument >= 0 ? process.argv[workersArgument + 1] : 1,
) || 1));

const items: BatchItemStatus[] = plan.sources.map((source) => ({
  interpretationId: source.interpretationId,
  status: "pending",
}));

function writeStatus(): void {
  mkdirSync(path.dirname(statusPath), { recursive: true });
  writeFileSync(statusPath, `${JSON.stringify({
    schemaVersion: "1.0.0",
    updatedAt: new Date().toISOString(),
    items,
  }, null, 2)}\n`, "utf8");
}

async function generate(index: number): Promise<void> {
  const source = plan.sources[index];
  const status = items[index];
  const targetInterpretationPath = interpretationPath(source.interpretationId);
  const targetEvaluationPath = evaluationPath(source.interpretationId);
  if (!force && existsSync(targetInterpretationPath) && existsSync(targetEvaluationPath)) {
    status.status = "skipped";
    status.finishedAt = new Date().toISOString();
    writeStatus();
    return;
  }

  const transcriptionPath = path.join(
    root,
    ".cache",
    "performance-tests",
    source.interpretationId,
    "amt",
    "piano-transcription",
    "events.json",
  );
  status.status = "running";
  status.startedAt = new Date().toISOString();
  writeStatus();
  console.log(`[batch] ${index + 1}/${plan.sources.length} ${source.interpretationId}`);
  const args = [
    tsxCli,
    generator,
    "--reference",
    source.interpretationId,
    "--skip-validation",
    "--skip-reference-write",
    ...(existsSync(transcriptionPath) ? ["--reuse-transcriptions"] : []),
  ];
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      stdio: "inherit",
      shell: false,
      env: {
        ...process.env,
        OMP_NUM_THREADS: "6",
        MKL_NUM_THREADS: "6",
      },
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  status.finishedAt = new Date().toISOString();
  status.exitCode = exitCode;
  status.status = exitCode === 0 ? "completed" : "failed";
  writeStatus();
}

writeStatus();
let nextIndex = 0;
async function worker(): Promise<void> {
  while (nextIndex < plan.sources.length) {
    const index = nextIndex;
    nextIndex += 1;
    await generate(index);
  }
}

await Promise.all(Array.from({ length: workerCount }, () => worker()));

const failures = items.filter((item) => item.status === "failed");
console.log(`[batch] completed with ${failures.length} failure(s)`);
if (failures.length > 0) process.exitCode = 1;
