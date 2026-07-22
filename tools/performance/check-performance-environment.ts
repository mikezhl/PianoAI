import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { localDirectory, projectRoot } from "../project-paths";

const environment = path.join(localDirectory, "amt-piano-transcription");
const alignmentEnvironment = path.join(localDirectory, "score-alignment");
const transcriptionOnly = process.argv.includes("--transcription-only");
const python = process.platform === "win32"
  ? path.join(environment, "Scripts", "python.exe")
  : path.join(environment, "bin", "python");
if (!existsSync(python)) {
  throw new Error("Missing piano transcription environment. Run npm run performance:setup first.");
}
if (!transcriptionOnly) {
  const alignmentPython = process.platform === "win32"
    ? path.join(alignmentEnvironment, "Scripts", "python.exe")
    : path.join(alignmentEnvironment, "bin", "python");
  if (!existsSync(alignmentPython)) {
    throw new Error("Missing score alignment environment. Run npm run performance:setup first.");
  }

  const alignmentResult = spawnSync(alignmentPython, [
    "-c",
    "import synctoolbox, yt_dlp; print('Score alignment and reference collection dependencies are available.')",
  ], { cwd: projectRoot, stdio: "inherit", shell: false });
  if (alignmentResult.error) throw alignmentResult.error;
  if (alignmentResult.status !== 0) process.exit(alignmentResult.status ?? 1);
}

const result = spawnSync(python, [
  path.join(projectRoot, "tools", "performance", "check-performance-environment.py"),
  "--checkpoint",
  path.join(localDirectory, "amt-models", "piano-transcription-note-pedal.pth"),
], { cwd: projectRoot, stdio: "inherit", shell: false });
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
