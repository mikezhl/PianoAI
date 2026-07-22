import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { localDirectory, projectRoot } from "../project-paths";

const TORCH_VERSION = "2.10.0";
const CUDA_INDEX_URL = "https://download.pytorch.org/whl/cu128";
const CPU_INDEX_URL = "https://download.pytorch.org/whl/cpu";
const CHECKPOINT_URL = "https://zenodo.org/api/records/4034264/files/CRNN_note_F1%3D0.9677_pedal_F1%3D0.9186.pth/content";
const CHECKPOINT_MD5 = "22b961b77c1878239fec963362097045";
const CHECKPOINT_SIZE = 171_966_578;

const root = projectRoot;
const environment = path.join(localDirectory, "amt-piano-transcription");
const checkpoint = path.join(localDirectory, "amt-models", "piano-transcription-note-pedal.pth");
const python = process.env.PYTHON ?? "python";
const environmentPython = process.platform === "win32"
  ? path.join(environment, "Scripts", "python.exe")
  : path.join(environment, "bin", "python");

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function run(label: string, command: string, args: string[]): void {
  console.log(`\n[piano-transcription] ${label}`);
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
}

function hasNvidiaGpu(): boolean {
  return spawnSync("nvidia-smi", ["-L"], { stdio: "ignore", shell: false }).status === 0;
}

async function md5(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("md5");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function validCheckpoint(filePath: string): Promise<boolean> {
  return existsSync(filePath)
    && statSync(filePath).size === CHECKPOINT_SIZE
    && await md5(filePath) === CHECKPOINT_MD5;
}

async function installCheckpoint(): Promise<void> {
  if (await validCheckpoint(checkpoint)) {
    console.log(`\n[piano-transcription] checkpoint verified: ${checkpoint}`);
    return;
  }

  mkdirSync(path.dirname(checkpoint), { recursive: true });
  const temporary = `${checkpoint}.download`;
  console.log(`\n[piano-transcription] download checkpoint (${CHECKPOINT_SIZE} bytes)`);
  const response = await fetch(CHECKPOINT_URL);
  if (!response.ok) throw new Error(`Checkpoint download failed: HTTP ${response.status}`);
  writeFileSync(temporary, Buffer.from(await response.arrayBuffer()));
  if (!await validCheckpoint(temporary)) {
    unlinkSync(temporary);
    throw new Error("Checkpoint download failed integrity verification");
  }
  if (existsSync(checkpoint)) unlinkSync(checkpoint);
  renameSync(temporary, checkpoint);
  console.log(`[piano-transcription] checkpoint installed: ${checkpoint}`);
}

const requestedDevice = (argument("--device") ?? "auto").toLowerCase();
if (!["auto", "cuda", "cpu"].includes(requestedDevice)) {
  throw new Error("--device must be auto, cuda, or cpu");
}
const nvidiaAvailable = hasNvidiaGpu();
if (requestedDevice === "cuda" && !nvidiaAvailable) {
  throw new Error("CUDA was requested but nvidia-smi did not find an NVIDIA GPU");
}
const installCuda = requestedDevice === "cuda" || (requestedDevice === "auto" && nvidiaAvailable);
const targetDevice = installCuda ? "cuda" : "cpu";
console.log(`[piano-transcription] selected ${targetDevice} runtime (${requestedDevice} requested)`);

if (!existsSync(environmentPython)) {
  run("create Python environment", python, ["-m", "venv", environment]);
}
run("upgrade pip", environmentPython, ["-m", "pip", "install", "--upgrade", "pip"]);
const torchArgs = ["-m", "pip", "install", `torch==${TORCH_VERSION}`];
if (process.platform !== "darwin") {
  torchArgs.push("--index-url", installCuda ? CUDA_INDEX_URL : CPU_INDEX_URL);
}
run(`install PyTorch ${TORCH_VERSION} (${targetDevice})`, environmentPython, torchArgs);
run("install piano transcription dependencies", environmentPython, [
  "-m",
  "pip",
  "install",
  "-r",
  path.join(root, "tools", "performance", "requirements-piano-transcription.txt"),
]);
await installCheckpoint();
run("verify model runtime", process.execPath, [
  path.join(root, "node_modules", "tsx", "dist", "cli.mjs"),
  path.join(root, "tools", "performance", "check-performance-environment.ts"),
  "--transcription-only",
]);
