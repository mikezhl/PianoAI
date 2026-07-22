import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { localDirectory, projectRoot } from "../project-paths";

const root = projectRoot;
const environment = path.join(localDirectory, "score-alignment");
const python = process.env.PYTHON ?? "python";
const environmentPython = process.platform === "win32"
  ? path.join(environment, "Scripts", "python.exe")
  : path.join(environment, "bin", "python");

function run(label: string, command: string, args: string[]): void {
  console.log(`\n[score-alignment] ${label}`);
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
}

if (!existsSync(environmentPython)) {
  run("create Python environment", python, ["-m", "venv", environment]);
}
run("upgrade pip", environmentPython, ["-m", "pip", "install", "--upgrade", "pip"]);
run("install pinned synchronization dependencies", environmentPython, [
  "-m",
  "pip",
  "install",
  "-r",
  path.join(root, "tools", "performance", "requirements-score-alignment.txt"),
]);
run("install pinned reference collection dependencies", environmentPython, [
  "-m",
  "pip",
  "install",
  "-r",
  path.join(root, "tools", "performance", "requirements-reference-collection.txt"),
]);
