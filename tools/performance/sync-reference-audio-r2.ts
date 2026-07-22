import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ReferenceInterpretationCatalog } from "../../src/performance/types";
import {
  performanceCatalogPath,
  projectRoot,
  referenceAudioDirectory,
} from "../project-paths";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex").toUpperCase();
}

const bucket = argument("--bucket") ?? process.env.R2_BUCKET;
if (!bucket || !/^[a-z0-9][a-z0-9-]*$/.test(bucket)) {
  throw new Error("请通过 R2_BUCKET 或 --bucket 指定 Cloudflare R2 bucket 名称");
}

const catalog = JSON.parse(readFileSync(performanceCatalogPath, "utf8")) as ReferenceInterpretationCatalog;
if (catalog.schemaVersion !== "2.1.0") throw new Error("演绎 catalog 版本不受支持");

const assets = [...new Map(catalog.references.map((reference) => {
  const { fileName, objectKey, sha256: expectedHash, format } = reference.audio;
  const expectedObjectKey = `reference-audio/${expectedHash.toLowerCase()}${path.extname(fileName).toLowerCase()}`;
  if (
    path.basename(fileName) !== fileName
    || objectKey !== expectedObjectKey
    || objectKey.includes("..")
    || objectKey.startsWith("/")
  ) {
    throw new Error(`不安全的参考录音身份：${reference.interpretationId}`);
  }
  const sourcePath = path.join(referenceAudioDirectory, fileName);
  if (!existsSync(sourcePath)) throw new Error(`本地参考录音不存在：${fileName}`);
  if (sha256(sourcePath) !== expectedHash) throw new Error(`本地参考录音哈希不匹配：${fileName}`);
  return [objectKey, { fileName, objectKey, sourcePath, format }] as const;
})).values()].sort((left, right) => left.objectKey.localeCompare(right.objectKey));

if (process.argv.includes("--dry-run")) {
  console.log(`[r2] ${bucket}: ${assets.length} 个对象已通过本地哈希校验`);
  process.exit(0);
}

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error("请通过 npm run performance:r2:sync 执行 R2 同步");
}

for (const [index, asset] of assets.entries()) {
  console.log(`[r2] ${index + 1}/${assets.length} ${asset.fileName} -> ${asset.objectKey}`);
  const result = spawnSync(process.execPath, [
    npmCli,
    "exec",
    "--yes",
    "--",
    "wrangler",
    "r2",
    "object",
    "put",
    `${bucket}/${asset.objectKey}`,
    "--file",
    asset.sourcePath,
    "--content-type",
    asset.format,
    "--cache-control",
    "public, max-age=31536000, immutable",
    "--remote",
  ], {
    cwd: projectRoot,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`R2 上传失败：${asset.fileName}（退出码 ${result.status ?? "unknown"}）`);
  }
}

console.log(`[r2] 已同步 ${assets.length} 个内容寻址对象到 ${bucket}`);
